import { randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull, like, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { recordAudit } from "../audit/record-audit";
import db from "../database";
import {
  fileFolderTable,
  storedFileTable,
  userStorageTable,
  userTable,
  workspaceStorageTable,
  workspaceUserTable,
} from "../database/schema";
import {
  type BucketConfig,
  deleteBlob,
  getUserBucket,
  storeBlob,
  testBucket,
  workspaceOwnerId,
} from "../storage/workspace-storage";
import { sealSecret } from "../utils/secret-box";

/** "Design/Logos/" style paths: trimmed, no empty or dot segments. */
export function normalizeFolder(folder: string | undefined) {
  const parts = (folder ?? "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p.length > 80)) {
    throw new HTTPException(400, { message: "That folder name isn't allowed" });
  }
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

// ---------------------------------------------------------------- storage

type StorageInput = {
  endpoint: string;
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey?: string;
  keyPrefix?: string;
};

const notConnected = {
  connected: false as const,
  endpoint: null,
  bucket: null,
  region: null,
  accessKeyId: null,
  keyPrefix: null,
  updatedAt: null,
};

/** A person's own bucket, as shown on their Account settings. */
export async function accountStorageStatus(userId: string) {
  const [row] = await db
    .select({
      endpoint: userStorageTable.endpoint,
      bucket: userStorageTable.bucket,
      region: userStorageTable.region,
      accessKeyId: userStorageTable.accessKeyId,
      keyPrefix: userStorageTable.keyPrefix,
      updatedAt: userStorageTable.updatedAt,
    })
    .from(userStorageTable)
    .where(eq(userStorageTable.userId, userId));
  return row ? { connected: true as const, ...row } : notConnected;
}

/**
 * Where a workspace's files go now: a leftover workspace bucket, else the
 * owner's account bucket, else Postgres. The owner's access key is theirs,
 * so only the bucket is shown to other admins.
 */
export async function storageStatus(workspaceId: string) {
  const [legacy] = await db
    .select({
      endpoint: workspaceStorageTable.endpoint,
      bucket: workspaceStorageTable.bucket,
      region: workspaceStorageTable.region,
      accessKeyId: workspaceStorageTable.accessKeyId,
      keyPrefix: workspaceStorageTable.keyPrefix,
      updatedAt: workspaceStorageTable.updatedAt,
    })
    .from(workspaceStorageTable)
    .where(eq(workspaceStorageTable.workspaceId, workspaceId));
  if (legacy) {
    return {
      ...legacy,
      connected: true as const,
      source: "workspace" as const,
      ownerName: null,
    };
  }

  const ownerId = await workspaceOwnerId(workspaceId);
  const [owner] = ownerId
    ? await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, ownerId))
    : [];
  const account = ownerId ? await accountStorageStatus(ownerId) : notConnected;
  return account.connected
    ? {
        ...account,
        accessKeyId: null,
        source: "account" as const,
        ownerName: owner?.name ?? null,
      }
    : { ...notConnected, source: null, ownerName: owner?.name ?? null };
}

async function filesInUserBucket(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(storedFileTable)
    .where(
      and(
        eq(storedFileTable.storageOwnerId, userId),
        eq(storedFileTable.storage, "s3"),
      ),
    );
  return row?.n ?? 0;
}

async function ownedWorkspaceIds(userId: string) {
  const rows = await db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.role, "owner"),
      ),
    );
  return rows.map((row) => row.workspaceId);
}

// Account storage applies to every workspace the person owns, so each of
// those workspaces' audit logs records the change.
async function auditOwned(
  userId: string,
  action: string,
  data?: Record<string, unknown>,
) {
  for (const workspaceId of await ownedWorkspaceIds(userId)) {
    await recordAudit({
      workspaceId,
      actorId: userId,
      action,
      targetType: "workspace",
      targetId: workspaceId,
      data,
    });
  }
}

export async function connectAccountStorage(
  userId: string,
  input: StorageInput,
) {
  // Keeping the saved secret lets someone change the bucket settings without
  // retyping a key they may no longer have.
  const existing = await getUserBucket(userId);
  const secret = input.secretAccessKey || existing?.secretAccessKey;
  if (!secret) {
    throw new HTTPException(400, {
      message: "The secret access key is required",
    });
  }
  const config: BucketConfig = {
    endpoint: input.endpoint.replace(/\/+$/, ""),
    bucket: input.bucket,
    region: input.region || "auto",
    accessKeyId: input.accessKeyId,
    secretAccessKey: secret,
    keyPrefix: input.keyPrefix ?? "",
  };
  // Files already in the bucket are found by its endpoint, name and prefix;
  // pointing those somewhere else would leave every one of them unreachable.
  if (
    existing &&
    (existing.endpoint !== config.endpoint ||
      existing.bucket !== config.bucket ||
      existing.keyPrefix !== config.keyPrefix)
  ) {
    const inBucket = await filesInUserBucket(userId);
    if (inBucket > 0) {
      throw new HTTPException(409, {
        message: `${inBucket} files live in the current bucket. Delete them before switching buckets; the keys can still be updated.`,
      });
    }
  }
  await testBucket(config);
  const values = {
    endpoint: config.endpoint,
    bucket: config.bucket,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: sealSecret(secret),
    keyPrefix: config.keyPrefix,
  };
  await db
    .insert(userStorageTable)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userStorageTable.userId, set: values });
  // Never the keys themselves.
  await auditOwned(userId, "storage.connected", {
    endpoint: config.endpoint,
    bucket: config.bucket,
  });
  return accountStorageStatus(userId);
}

export async function disconnectAccountStorage(userId: string) {
  const inBucket = await filesInUserBucket(userId);
  if (inBucket > 0) {
    throw new HTTPException(409, {
      message: `${inBucket} files live in this bucket. Delete them first, or keep the bucket connected.`,
    });
  }
  await db.delete(userStorageTable).where(eq(userStorageTable.userId, userId));
  await auditOwned(userId, "storage.disconnected");
  return accountStorageStatus(userId);
}

/** Drops a leftover workspace bucket once nothing is stored in it. */
export async function disconnectStorage(workspaceId: string, actorId: string) {
  const [inBucket] = await db
    .select({ n: count() })
    .from(storedFileTable)
    .where(
      and(
        eq(storedFileTable.workspaceId, workspaceId),
        eq(storedFileTable.storage, "s3"),
        isNull(storedFileTable.storageOwnerId),
      ),
    );
  if ((inBucket?.n ?? 0) > 0) {
    throw new HTTPException(409, {
      message: `${inBucket?.n} files live in this bucket. Delete them first, or keep the bucket connected.`,
    });
  }
  await db
    .delete(workspaceStorageTable)
    .where(eq(workspaceStorageTable.workspaceId, workspaceId));
  await recordAudit({
    workspaceId,
    actorId,
    action: "storage.disconnected",
    targetType: "workspace",
    targetId: workspaceId,
  });
  return storageStatus(workspaceId);
}

// ------------------------------------------------------------------ files

const fileColumns = {
  id: storedFileTable.id,
  filename: storedFileTable.filename,
  mimeType: storedFileTable.mimeType,
  size: storedFileTable.size,
  folder: storedFileTable.folder,
  storage: storedFileTable.storage,
  shared: storedFileTable.shareToken,
  uploadedBy: storedFileTable.uploadedBy,
  uploadedByName: userTable.name,
  createdAt: storedFileTable.createdAt,
};

type FileRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  folder: string;
  storage: string;
  shared: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  createdAt: Date;
};

export function presentFile(row: FileRow, publicBase: string) {
  const { shared, ...rest } = row;
  return {
    ...rest,
    publicUrl: shared ? `${publicBase}/files/public/${shared}` : null,
  };
}

/** A single folder name: what goes between two slashes. */
export function folderName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes("/")) {
    throw new HTTPException(400, { message: "That folder name isn't allowed" });
  }
  return normalizeFolder(trimmed);
}

const escapeLike = (value: string) => value.replace(/[%_\\]/g, "\\$&");

const filesUnder = (workspaceId: string, folder: string) =>
  and(
    eq(storedFileTable.workspaceId, workspaceId),
    eq(storedFileTable.kind, "file"),
    folder ? like(storedFileTable.folder, `${escapeLike(folder)}%`) : undefined,
  );

const foldersUnder = (workspaceId: string, folder: string) =>
  and(
    eq(fileFolderTable.workspaceId, workspaceId),
    folder ? like(fileFolderTable.path, `${escapeLike(folder)}%`) : undefined,
  );

/** Files directly in `folder`, plus the folders just below it. */
export async function listFiles(workspaceId: string, folder: string) {
  const [rows, created] = await Promise.all([
    db
      .select(fileColumns)
      .from(storedFileTable)
      .leftJoin(userTable, eq(userTable.id, storedFileTable.uploadedBy))
      .where(filesUnder(workspaceId, folder))
      .orderBy(desc(storedFileTable.createdAt)),
    db
      .select({ path: fileFolderTable.path })
      .from(fileFolderTable)
      .where(foldersUnder(workspaceId, folder)),
  ]);

  const below = new Map<string, number>();
  const childOf = (path: string) =>
    path === folder ? "" : (path.slice(folder.length).split("/")[0] ?? "");
  for (const { path } of created) {
    const name = childOf(path);
    if (name && !below.has(name)) below.set(name, 0);
  }
  for (const row of rows) {
    const name = childOf(row.folder);
    if (name) below.set(name, (below.get(name) ?? 0) + 1);
  }

  return {
    folder,
    folders: [...below.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, fileCount]) => ({
        name,
        path: `${folder}${name}/`,
        fileCount,
      })),
    files: rows.filter((r) => r.folder === folder),
  };
}

/** Every folder in the workspace, for "Move to". */
export async function listAllFolders(workspaceId: string) {
  const [fromFiles, created] = await Promise.all([
    db
      .selectDistinct({ path: storedFileTable.folder })
      .from(storedFileTable)
      .where(filesUnder(workspaceId, "")),
    db
      .select({ path: fileFolderTable.path })
      .from(fileFolderTable)
      .where(eq(fileFolderTable.workspaceId, workspaceId)),
  ]);
  const all = new Set<string>();
  for (const { path } of [...fromFiles, ...created]) {
    // "a/b/c/" implies "a/" and "a/b/" too.
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      all.add(`${parts.slice(0, i).join("/")}/`);
    }
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}

async function folderExists(workspaceId: string, path: string) {
  const [file] = await db
    .select({ id: storedFileTable.id })
    .from(storedFileTable)
    .where(filesUnder(workspaceId, path))
    .limit(1);
  if (file) return true;
  const [folder] = await db
    .select({ id: fileFolderTable.id })
    .from(fileFolderTable)
    .where(foldersUnder(workspaceId, path))
    .limit(1);
  return Boolean(folder);
}

export async function createFolder(
  workspaceId: string,
  userId: string,
  parent: string,
  name: string,
) {
  const path = `${parent}${folderName(name)}`;
  if (await folderExists(workspaceId, path)) {
    throw new HTTPException(409, {
      message: "A folder with that name already exists here",
    });
  }
  await db
    .insert(fileFolderTable)
    .values({ workspaceId, path, createdBy: userId })
    .onConflictDoNothing();
  return { path };
}

/**
 * Someone may rename, move or delete a folder when everything inside is
 * theirs; otherwise it takes file:manage, like changing a single file.
 */
export async function folderIsOwnedBy(
  workspaceId: string,
  path: string,
  userId: string,
) {
  const [otherFile] = await db
    .select({ id: storedFileTable.id })
    .from(storedFileTable)
    .where(
      and(
        filesUnder(workspaceId, path),
        or(
          isNull(storedFileTable.uploadedBy),
          ne(storedFileTable.uploadedBy, userId),
        ),
      ),
    )
    .limit(1);
  if (otherFile) return false;
  const [otherFolder] = await db
    .select({ id: fileFolderTable.id })
    .from(fileFolderTable)
    .where(
      and(
        foldersUnder(workspaceId, path),
        or(
          isNull(fileFolderTable.createdBy),
          ne(fileFolderTable.createdBy, userId),
        ),
      ),
    )
    .limit(1);
  return !otherFolder;
}

export async function moveFolder(
  workspaceId: string,
  actorId: string,
  from: string,
  to: string,
) {
  if (!from) {
    throw new HTTPException(400, { message: "Pick a folder to move" });
  }
  if (from === to) return { path: to };
  if (to.startsWith(from)) {
    throw new HTTPException(400, {
      message: "A folder can't be moved inside itself",
    });
  }
  if (!(await folderExists(workspaceId, from))) {
    throw new HTTPException(404, { message: "Folder not found" });
  }
  if (await folderExists(workspaceId, to)) {
    throw new HTTPException(409, {
      message: "A folder with that name already exists there",
    });
  }

  // Swap the leading `from` for `to` on every path below it.
  const rebase = (column: AnyPgColumn) =>
    sql`${to} || substr(${column}, ${from.length + 1})`;
  await db.transaction(async (tx) => {
    await tx
      .update(storedFileTable)
      .set({ folder: rebase(storedFileTable.folder) })
      .where(filesUnder(workspaceId, from));
    await tx
      .update(fileFolderTable)
      .set({ path: rebase(fileFolderTable.path) })
      .where(foldersUnder(workspaceId, from));
    // Keep the folder itself even when it only held other folders.
    await tx
      .insert(fileFolderTable)
      .values({ workspaceId, path: to, createdBy: actorId })
      .onConflictDoNothing();
  });
  return { path: to };
}

export async function deleteFolder(workspaceId: string, path: string) {
  const [file] = await db
    .select({ id: storedFileTable.id })
    .from(storedFileTable)
    .where(filesUnder(workspaceId, path))
    .limit(1);
  if (file) {
    throw new HTTPException(409, {
      message: "Move or delete the files inside first",
    });
  }
  await db.delete(fileFolderTable).where(foldersUnder(workspaceId, path));
  return { path };
}

export async function updateFile(
  id: string,
  input: { filename?: string; folder?: string },
) {
  if (input.filename === undefined && input.folder === undefined) {
    return fileRow(id);
  }
  await db
    .update(storedFileTable)
    .set({
      ...(input.filename !== undefined && { filename: input.filename }),
      ...(input.folder !== undefined && { folder: input.folder }),
    })
    .where(eq(storedFileTable.id, id));
  return fileRow(id);
}

export async function uploadFile(input: {
  workspaceId: string;
  userId: string;
  filename: string;
  mimeType: string;
  folder: string;
  bytes: Buffer;
}) {
  if (input.bytes.length === 0) {
    throw new HTTPException(400, { message: "The file is empty" });
  }
  const stored = await storeBlob({
    workspaceId: input.workspaceId,
    uploadedBy: input.userId,
    filename: input.filename,
    mimeType: input.mimeType || "application/octet-stream",
    bytes: input.bytes,
    kind: "file",
    folder: input.folder,
  });
  return stored.id;
}

export async function findFile(workspaceId: string, id: string) {
  const [file] = await db
    .select()
    .from(storedFileTable)
    .where(
      and(
        eq(storedFileTable.id, id),
        eq(storedFileTable.workspaceId, workspaceId),
        eq(storedFileTable.kind, "file"),
      ),
    );
  if (!file) throw new HTTPException(404, { message: "File not found" });
  return file;
}

export async function fileRow(id: string) {
  const [row] = await db
    .select(fileColumns)
    .from(storedFileTable)
    .leftJoin(userTable, eq(userTable.id, storedFileTable.uploadedBy))
    .where(eq(storedFileTable.id, id));
  if (!row) throw new HTTPException(404, { message: "File not found" });
  return row;
}

export async function shareFile(id: string) {
  // 24 random bytes: unguessable, and the link stops working when cleared.
  const token = randomBytes(24).toString("base64url");
  await db
    .update(storedFileTable)
    .set({ shareToken: token })
    .where(eq(storedFileTable.id, id));
  return fileRow(id);
}

export async function unshareFile(id: string) {
  await db
    .update(storedFileTable)
    .set({ shareToken: null })
    .where(eq(storedFileTable.id, id));
  return fileRow(id);
}

export async function removeFile(
  workspaceId: string,
  actorId: string,
  file: typeof storedFileTable.$inferSelect,
) {
  await deleteBlob(file);
  if (file.uploadedBy !== actorId) {
    await recordAudit({
      workspaceId,
      actorId,
      action: "file.deleted",
      targetType: "file",
      targetId: file.id,
      data: { filename: file.filename, uploadedBy: file.uploadedBy },
    });
  }
}

export async function findShared(token: string) {
  const [file] = await db
    .select()
    .from(storedFileTable)
    .where(
      and(
        eq(storedFileTable.shareToken, token),
        eq(storedFileTable.kind, "file"),
      ),
    );
  return file ?? null;
}
