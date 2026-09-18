import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTimerNoteStore } from "@/store/timer-note";
import { syncTimerAfterStatusChange } from "./timer-sync";

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast }));
vi.mock("i18next", () => ({
  default: {
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(" ")}` : key,
  },
}));

const key = ["time-entries", "running", "w1"];
const entry = (id: string, taskTitle: string, minutesAgo = 0) => ({
  id,
  taskTitle,
  startTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

beforeEach(() => {
  toast.success.mockReset();
  toast.info.mockReset();
  useTimerNoteStore.getState().close();
});

describe("syncTimerAfterStatusChange", () => {
  it("says so when a status change started the timer", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, null);
    // Simulate the refetch the helper triggers.
    const refetch = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(async () => {
        queryClient.setQueryData(key, entry("t1", "Schedule newsletter"));
      });
    await syncTimerAfterStatusChange(queryClient);
    expect(refetch).toHaveBeenCalledWith({ queryKey: ["time-entries"] });
    expect(toast.success).toHaveBeenCalledWith(
      "time:auto.started Schedule newsletter",
      expect.anything(),
    );
  });

  it("asks what was done when it stopped", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, entry("t1", "Schedule newsletter", 25));
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async () => {
      queryClient.setQueryData(key, null);
    });
    await syncTimerAfterStatusChange(queryClient);
    expect(useTimerNoteStore.getState().stopped).toMatchObject({
      entryId: "t1",
      taskTitle: "Schedule newsletter",
      seconds: expect.any(Number),
    });
    expect(
      useTimerNoteStore.getState().stopped?.seconds,
    ).toBeGreaterThanOrEqual(25 * 60);
  });

  it("stays quiet when nothing changed", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, entry("t1", "Same"));
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    await syncTimerAfterStatusChange(queryClient);
    expect(toast.success).not.toHaveBeenCalled();
    expect(useTimerNoteStore.getState().stopped).toBeNull();
  });
});
