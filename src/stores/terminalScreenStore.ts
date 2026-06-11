import { create } from "zustand";

export interface TerminalScreenSnapshot {
  text: string;
  rows: number;
  cols: number;
  updatedAt: number;
}

interface TerminalScreenState {
  screens: Record<string, TerminalScreenSnapshot>;
  setScreen: (
    sessionId: string,
    data: Omit<TerminalScreenSnapshot, "updatedAt">
  ) => void;
  clearScreen: (sessionId: string) => void;
}

export const useTerminalScreenStore = create<TerminalScreenState>((set) => ({
  screens: {},

  setScreen: (sessionId, data) => set((state) => ({
    screens: {
      ...state.screens,
      [sessionId]: {
        ...data,
        updatedAt: Date.now(),
      },
    },
  })),

  clearScreen: (sessionId) => set((state) => {
    const next = { ...state.screens };
    delete next[sessionId];
    return { screens: next };
  }),
}));
