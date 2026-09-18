import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadTaskImage } from "./upload-task-image";

const mocks = vi.hoisted(() => ({
  uploadImageDirect: vi.fn(),
}));

vi.mock("@/fetchers/task/create-image-upload", () => ({
  uploadImageDirect: mocks.uploadImageDirect,
}));

describe("uploadTaskImage", () => {
  beforeEach(() => {
    mocks.uploadImageDirect.mockResolvedValue({
      id: "asset-1",
      url: "https://app.example/api/asset/asset-1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses a generic content type when the browser cannot detect one", async () => {
    const file = new File(["server config"], "server.conf");

    const asset = await uploadTaskImage({
      taskId: "task-1",
      surface: "comment",
      file,
    });

    expect(file.type).toBe("");
    // One request through the API; the server picks the storage.
    expect(mocks.uploadImageDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "application/octet-stream",
        file,
      }),
    );
    expect(asset.mimeType).toBe("application/octet-stream");
    expect(asset.kind).toBe("attachment");
  });

  it("preserves a browser-provided content type", async () => {
    const file = new File(["image"], "image.png", { type: "image/png" });

    const asset = await uploadTaskImage({
      taskId: "task-1",
      surface: "description",
      file,
    });

    // One request through the API; the server picks the storage.
    expect(mocks.uploadImageDirect).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/png", file }),
    );
    expect(asset.mimeType).toBe("image/png");
    expect(asset.kind).toBe("image");
  });
});
