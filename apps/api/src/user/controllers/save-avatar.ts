import { createId } from "@paralleldrive/cuid2";
import { asc, eq } from "drizzle-orm";
import db from "../../database";
import {
  storedFileTable,
  userAvatarTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  bucketForWrite,
  deleteBlob,
  storeBlob,
} from "../../storage/workspace-storage";
import { buildAvatarUrl, decodeAvatarUpload } from "../avatar";

/**
 * A person isn't tied to one workspace, so their picture goes where the
 * first workspace they joined keeps its files: its owner's R2. In a
 * single-company install that is always the admin's bucket.
 */
async function avatarWorkspace(userId: string) {
  const [membership] = await db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId))
    .orderBy(asc(workspaceUserTable.joinedAt))
    .limit(1);
  return membership?.workspaceId ?? null;
}

/** Removes the stored file behind a person's current picture, if any. */
export async function releaseAvatarFile(userId: string) {
  const [current] = await db
    .select({ storedFileId: userAvatarTable.storedFileId })
    .from(userAvatarTable)
    .where(eq(userAvatarTable.userId, userId))
    .limit(1);
  if (!current?.storedFileId) return;
  const [file] = await db
    .select()
    .from(storedFileTable)
    .where(eq(storedFileTable.id, current.storedFileId))
    .limit(1);
  if (file) await deleteBlob(file).catch(() => undefined);
}

export async function saveAvatar({
  userId,
  contentType,
  data,
}: {
  userId: string;
  contentType: string;
  data: string;
}) {
  const { mimeType, bytes } = decodeAvatarUpload({ contentType, data });

  const workspaceId = await avatarWorkspace(userId);
  let storedFileId: string | null = null;
  if (workspaceId && (await bucketForWrite(workspaceId))) {
    const extension = mimeType.split("/")[1] ?? "img";
    const file = await storeBlob({
      workspaceId,
      uploadedBy: userId,
      filename: `avatar.${extension}`,
      mimeType,
      bytes,
      kind: "avatar",
    });
    storedFileId = file.id;
  }

  await releaseAvatarFile(userId);

  const values = {
    mimeType,
    size: bytes.length,
    data: storedFileId ? null : bytes,
    storedFileId,
  };
  const [saved] = await db
    .insert(userAvatarTable)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: userAvatarTable.userId,
      set: { id: createId(), ...values, updatedAt: new Date() },
    })
    .returning({ id: userAvatarTable.id });

  if (!saved) {
    throw new Error("Failed to store avatar");
  }

  return { id: saved.id, url: buildAvatarUrl(saved.id), size: bytes.length };
}

export default saveAvatar;
