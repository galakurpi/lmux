import { sendDesktopNotification } from "./ipc";
import { usePaneMetadataStore } from "../stores/workspaceStore";

export interface TerminalNotification {
  title: string;
  subtitle?: string;
  body?: string;
}

export interface OscNotificationState {
  kittyChunks: Record<string, Partial<TerminalNotification>>;
}

export function createOscNotificationState(): OscNotificationState {
  return { kittyChunks: {} };
}

export function parseNotificationPayload(payload: string): TerminalNotification {
  const parts = payload.trim().split("|");
  const title = (parts[0] ?? "").trim() || "Notification";
  if (parts.length >= 3) {
    return { title, subtitle: parts[1].trim(), body: parts.slice(2).join("|").trim() };
  }
  return { title, body: (parts[1] ?? "").trim() };
}

export function parseOscNotification(
  ident: 9 | 99 | 777,
  data: string,
  state: OscNotificationState,
): TerminalNotification | null {
  if (ident === 9) {
    const body = data.replace(/^;+/, "").trim();
    return body ? { title: "Terminal", body } : null;
  }

  if (ident === 777) {
    const parts = data.split(";");
    if (parts[0] !== "notify") return null;
    const title = (parts[1] ?? "").trim() || "Notification";
    const body = parts.slice(2).join(";").trim();
    return { title, body };
  }

  return parseKittyNotification(data, state);
}

function parseKittyNotification(data: string, state: OscNotificationState): TerminalNotification | null {
  const separator = data.indexOf(";");
  if (separator === -1) {
    const title = data.trim();
    return title ? { title } : null;
  }

  const rawOptions = data.slice(0, separator);
  const text = data.slice(separator + 1).trim();

  // OSC 99;;message is the common simple kitty notification form.
  if (!rawOptions.trim()) {
    return text ? { title: text } : null;
  }

  const options = parseKittyOptions(rawOptions);
  const chunkId = options.i || "default";
  const chunkType = options.p || "body";
  const isContinued = options.d === "0";
  const existing = state.kittyChunks[chunkId] ?? {};
  const next = {
    ...existing,
    ...(chunkType === "title" ? { title: text } : { body: text }),
  };

  if (isContinued) {
    state.kittyChunks[chunkId] = next;
    return null;
  }

  delete state.kittyChunks[chunkId];
  return {
    title: next.title?.trim() || next.body?.trim() || "Notification",
    body: next.body?.trim() || "",
  };
}

function parseKittyOptions(rawOptions: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of rawOptions.split(":")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    result[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return result;
}

export function addPaneNotification(
  sessionId: string,
  notification: TerminalNotification,
  options: { desktop?: boolean; sound?: boolean } = {},
): void {
  const title = notification.title || "Notification";
  const body = [notification.subtitle, notification.body].filter(Boolean).join(" - ");
  const store = usePaneMetadataStore.getState();
  store.addNotification(sessionId, title, body);
  store.triggerFlash(sessionId);

  if (options.desktop ?? true) {
    void sendDesktopNotification(title, body, options.sound ?? true).catch((err) => {
      console.error("Failed to send desktop notification:", err);
    });
  }
}
