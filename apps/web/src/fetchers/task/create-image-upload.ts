import { client } from "@kaneo/libs";

async function createImageUpload({
  taskId,
  filename,
  contentType,
  size,
  surface,
}: {
  taskId: string;
  filename: string;
  contentType: string;
  size: number;
  surface: "description" | "comment";
}) {
  const response = await client.task["image-upload"][":id"].$put({
    param: { id: taskId },
    json: {
      filename,
      contentType,
      size,
      surface,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export async function finalizeImageUpload({
  taskId,
  key,
  filename,
  contentType,
  size,
  surface,
}: {
  taskId: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  surface: "description" | "comment";
}) {
  const response = await client.task["image-upload"][":id"].finalize.$post({
    param: { id: taskId },
    json: {
      key,
      filename,
      contentType,
      size,
      surface,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default createImageUpload;

/**
 * Sends the file through the API, which stores it where the workspace's
 * files go (the owner's R2 when connected), so buckets need no CORS rules.
 */
export async function uploadImageDirect({
  taskId,
  file,
  contentType,
  surface,
}: {
  taskId: string;
  file: File;
  contentType: string;
  surface: "description" | "comment";
}) {
  const response = await client.task["image-upload"][":id"].direct.$put(
    {
      param: { id: taskId },
      query: { filename: file.name || "image", surface },
    },
    { init: { body: file, headers: { "Content-Type": contentType } } },
  );

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    throw new Error(message);
  }

  return response.json();
}
