import { create } from "zustand";

export type StoppedTimer = {
  entryId: string;
  taskTitle: string;
  seconds: number;
};

// A status change stopped someone's timer on the server; the note dialog
// (mounted once in the layout) asks what they did.
type TimerNoteStore = {
  stopped: StoppedTimer | null;
  ask: (stopped: StoppedTimer) => void;
  close: () => void;
};

export const useTimerNoteStore = create<TimerNoteStore>()((set) => ({
  stopped: null,
  ask: (stopped) => set({ stopped }),
  close: () => set({ stopped: null }),
}));
