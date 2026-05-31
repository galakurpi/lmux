import { create } from "zustand";

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 40;

function clampFontSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
}

interface PaneFontState {
  fontSizes: Record<string, number>;
  setFontSize: (sessionId: string, size: number) => void;
  getFontSize: (sessionId: string) => number | undefined;
  copyFontSize: (fromSessionId: string, toSessionId: string) => void;
  removeFontSize: (sessionId: string) => void;
}

export const usePaneFontStore = create<PaneFontState>((set, get) => ({
  fontSizes: {},

  setFontSize: (sessionId, size) => {
    set((state) => ({
      fontSizes: {
        ...state.fontSizes,
        [sessionId]: clampFontSize(size),
      },
    }));
  },

  getFontSize: (sessionId) => get().fontSizes[sessionId],

  copyFontSize: (fromSessionId, toSessionId) => {
    const size = get().fontSizes[fromSessionId];
    if (typeof size !== "number") return;
    set((state) => ({
      fontSizes: {
        ...state.fontSizes,
        [toSessionId]: size,
      },
    }));
  },

  removeFontSize: (sessionId) => {
    set((state) => {
      const next = { ...state.fontSizes };
      delete next[sessionId];
      return { fontSizes: next };
    });
  },
}));
