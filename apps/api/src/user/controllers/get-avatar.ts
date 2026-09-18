import { eq } from "drizzle-orm";
import db from "../../database";
import { storedFileTable, userAvatarTable } from "../../database/schema";
import { readBlobBytes } from "../../storage/workspace-storage";

export async function getAvatar(id: string) {
  const [avatar] = await db
    .select({
      id: userAvatarTable.id,
      mimeType: userAvatarTable.mimeType,
      size: userAvatarTable.size,
      data: userAvatarTable.data,
      storedFileId: userAvatarTable.storedFileId,
      updatedAt: userAvatarTable.updatedAt,
    })
    .from(userAvatarTable)
    .where(eq(userAvatarTable.id, id))
    .limit(1);
  if (!avatar) return null;

  let data = avatar.data;
  if (!data && avatar.storedFileId) {
    const [file] = await db
      .select()
      .from(storedFileTable)
      .where(eq(storedFileTable.id, avatar.storedFileId))
      .limit(1);
    // Proxied rather than redirected: the avatar URL is cached as immutable,
    // and a signed bucket URL would expire.
    data = file ? await readBlobBytes(file).catch(() => null) : null;
  }
  return data ? { ...avatar, data, size: data.length } : null;
}

export default getAvatar;
