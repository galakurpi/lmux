import { create } from "zustand";

export type AgentStatus = "working" | "waiting" | "done" | "idle";

export interface PaneMetadata {
  lastLogLine?: string;
  lastNotificationTitle?: string;
  lastNotificationBody?: string;
  notificationCount?: number;
  lastNotificationAt?: number;
  lastAgentStatusAt?: number;
  lastFinishedAt?: number;
  cwd?: string;
  gitBranch?: string;
  processTitle?: string;
  agentStatus?: AgentStatus;
}

export interface PaneMetadataState {
  metadata: Record<string, PaneMetadata>;
  flashingPaneIds: Set<string>;
  setMetadata: (sessionId: string, data: Partial<PaneMetadata>) => void;
  incrementNotification: (sessionId: string) => void;
  addNotification: (sessionId: string, title: string, body?: string) => void;
  setAgentStatus: (sessionId: string, status: AgentStatus, lastLogLine?: string) => void;
  clearNotification: (sessionId: string) => void;
  triggerFlash: (sessionId: string) => void;
}

export const usePaneMetadataStore = create<PaneMetadataState>((set) => ({
  metadata: {},
  flashingPaneIds: new Set(),
  
  setMetadata: (sessionId, data) => set((state) => {
    const start = performance.now();
    const prev = state.metadata[sessionId];
    // Skip update if nothing actually changed
    if (prev) {
      const keys = Object.keys(data) as (keyof PaneMetadata)[];
      const changed = keys.some((k) => prev[k] !== data[k]);
      if (!changed) {
        console.log(`[PERF] setMetadata skipped (no changes) - ${(performance.now() - start).toFixed(2)}ms`);
        return state;
      }
    }
    const result = {
      metadata: {
        ...state.metadata,
        [sessionId]: { ...prev, ...data },
      },
    };
    console.log(`[PERF] setMetadata completed - ${(performance.now() - start).toFixed(2)}ms`);
    return result;
  }),
  
  incrementNotification: (sessionId) => set((state) => {
    const start = performance.now();
    const prev = state.metadata[sessionId];
    const oldCount = prev?.notificationCount || 0;
    const result = {
      metadata: {
        ...state.metadata,
        [sessionId]: { ...prev, notificationCount: oldCount + 1, lastNotificationAt: Date.now() },
      },
    };
    console.log(`[PERF] incrementNotification (${oldCount} -> ${oldCount + 1}) - ${(performance.now() - start).toFixed(2)}ms`);
    return result;
  }),

  addNotification: (sessionId, title, body) => set((state) => {
    const prev = state.metadata[sessionId];
    const oldCount = prev?.notificationCount || 0;
    const cleanTitle = title.trim() || "Notification";
    const cleanBody = body?.trim() || "";
    return {
      metadata: {
        ...state.metadata,
        [sessionId]: {
          ...prev,
          notificationCount: oldCount + 1,
          lastNotificationAt: Date.now(),
          lastNotificationTitle: cleanTitle,
          lastNotificationBody: cleanBody,
          lastLogLine: cleanBody || cleanTitle,
        },
      },
    };
  }),

  setAgentStatus: (sessionId, status, lastLogLine) => set((state) => {
    const prev = state.metadata[sessionId];
    const now = Date.now();
    return {
      metadata: {
        ...state.metadata,
        [sessionId]: {
          ...prev,
          agentStatus: status,
          lastAgentStatusAt: now,
          ...(status === "done" ? { lastFinishedAt: now } : {}),
          ...(lastLogLine ? { lastLogLine } : {}),
        },
      },
    };
  }),
  
  clearNotification: (sessionId) => set((state) => ({
    metadata: {
      ...state.metadata,
      [sessionId]: {
        ...state.metadata[sessionId],
        notificationCount: 0
      }
    }
  })),
  
  triggerFlash: (sessionId) => {
    set((state) => {
      const next = new Set(state.flashingPaneIds);
      next.add(sessionId);
      return { flashingPaneIds: next };
    });
    setTimeout(() => {
      set((state) => {
        const next = new Set(state.flashingPaneIds);
        next.delete(sessionId);
        return { flashingPaneIds: next };
      });
    }, 900);
  },
}));
