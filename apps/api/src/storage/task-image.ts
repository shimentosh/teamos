import { eq } from "drizzle-orm";
import db from "../database";
import { assetTable, storedFileTable } from "../database/schema";
import {
  applyKeyPrefix,
  buildObjectKey,
  isImageContentType,
  isInstanceStorageConfigured,
  putPrivateObject,
} from "./s3";
import {
  bucketForWrite,
  deleteBlob,
  openBlob,
  storeBlob,
} from "./workspace-storage";

// An asset whose bytes live with the workspace's other files (the owner's R2,
// or Postgres) rather than in the instance bucket. Its object key points at
// the stored file.
const STORED_PREFIX = "stored:";

export function storedFileIdOf(objectKey: string) {
  return objectKey.startsWith(STORED_PREFIX)
    ? objectKey.slice(STORED_PREFIX.length)
    : null;
}

type TaskImageInput = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  surface: "description" | "comment";
  filename: string;
  mimeType: string;
  bytes: Buffer;
  userId: string;
};

/**
 * Stores an image or file pasted into a task. It goes where the workspace's
 * files go: the owner's R2 when connected. Without one, an instance bucket
 * configured through S3_* still takes it, and Postgres is the last resort.
 */
export async function storeTaskImage(input: TaskImageInput) {
  let objectKey: string;
  const workspaceBucket = await bucketForWrite(input.workspaceId);
  if (workspaceBucket || !isInstanceStorageConfigured()) {
    const file = await storeBlob({
      workspaceId: input.workspaceId,
      uploadedBy: input.userId,
      filename: input.filename,
      mimeType: input.mimeType,
      bytes: input.bytes,
      kind: "asset",
    });
    objectKey = `${STORED_PREFIX}${file.id}`;
  } else {
    objectKey = await putPrivateObject(
      (prefix) =>
        applyKeyPrefix(
          prefix,
          buildObjectKey({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            taskId: input.taskId,
            surface: input.surface,
            filename: input.filename,
            contentType: input.mimeType,
          }),
        ),
      input.bytes,
      input.mimeType,
    );
  }

  const [asset] = await db
    .insert(assetTable)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      objectKey,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.bytes.length,
      kind: isImageContentType(input.mimeType) ? "image" : "attachment",
      surface: input.surface,
      createdBy: input.userId,
    })
    .returning({ id: assetTable.id });
  if (!asset) throw new Error("Failed to save asset");
  return asset;
}

async function storedFile(id: string) {
  const [file] = await db
    .select()
    .from(storedFileTable)
    .where(eq(storedFileTable.id, id))
    .limit(1);
  return file ?? null;
}

/** Where to read a stored-file asset from, or null when it's gone. */
export async function openStoredAsset(fileId: string) {
  const file = await storedFile(fileId);
  return file ? { file, blob: await openBlob(file) } : null;
}

export async function deleteStoredAsset(fileId: string) {
  const file = await storedFile(fileId);
  if (!file) return;
  await deleteBlob(file);
}
