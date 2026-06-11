import { memo, useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { open } from "@tauri-apps/plugin-shell";
import {
  createSession,
  writeToSession,
  resizeSession,
  copyTextToClipboard,
  onPtyExit,
  getTerminalConfig,
} from "../../lib/ipc";
import { usePaneMetadataStore } from "../../stores/workspaceStore";
import { useTerminalScreenStore } from "../../stores/terminalScreenStore";
import { useKeybindingStore } from "../../stores/keybindingStore";
import { usePaneFontStore } from "../../stores/paneFontStore";
import { useThemeStore } from "../../stores/themeStore";
import {
  addPaneNotification,
  createOscNotificationState,
  parseOscNotification,
} from "../../lib/notifications";
import {
  recordTerminalInput,
  recordTerminalOutputChunk,
  recordTerminalOutputFlush,
  recordTerminalQueuedOutputBytes,
  recordTerminalScreenCapture,
  recordTerminalWriteDuration,
} from "../../lib/perfTelemetry";
import {
  registerTerminalInputWriter,
  registerTerminalOutputFlusher,
} from "../../lib/terminalInputRegistry";
import type { ITheme } from "@xterm/xterm";

interface XTermWrapperProps {
  sessionId: string;
  workspaceId?: string;
  command: string;
  args?: string[];
  onExit?: () => void;
  theme?: ITheme;
  fontSize?: number;
  fontFamily?: string;
  suppressNotifications?: boolean;
  isVisible?: boolean;
  isFocused?: boolean;
  onZoomToggle?: () => void;
  onUrlClick?: (url: string) => void;
  cwd?: string;
}

const ANSI_KEYS: (keyof ITheme)[] = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

function buildThemeFromConfig(cfg: { background: string; foreground: string; ansi: string[] }): ITheme {
  const theme: ITheme = {
    background: cfg.background,
    foreground: cfg.foreground,
    cursor: cfg.foreground,
    selectionBackground: "#063b16",
  };
  for (let i = 0; i < ANSI_KEYS.length && i < cfg.ansi.length; i++) {
    (theme as Record<string, string>)[ANSI_KEYS[i] as string] = cfg.ansi[i];
  }
  return theme;
}

function withTerminalBackground(theme: ITheme, background: string): ITheme {
  return {
    ...theme,
    background,
  };
}

const DEFAULT_THEME: ITheme = {
  background: "#101010",
  foreground: "#d7ffe1",
  cursor: "#00ff41",
  selectionBackground: "#063b16",
  black: "#101010",
  red: "#ff3158",
  green: "#00c853",
  yellow: "#d7ff00",
  blue: "#00a3ff",
  magenta: "#39ff14",
  cyan: "#00ffaa",
  white: "#d7ffe1",
  brightBlack: "#007a24",
  brightRed: "#ff5f7a",
  brightGreen: "#00ff41",
  brightYellow: "#eeff55",
  brightBlue: "#5fd7ff",
  brightMagenta: "#8cff8c",
  brightCyan: "#76ffd6",
  brightWhite: "#ffffff",
};

function isPaneZoomKey(e: KeyboardEvent): 1 | -1 | 0 {
  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return 0;
  if (
    e.key === "+" ||
    e.key === "=" ||
    e.key === "*" ||
    e.code === "Equal" ||
    e.code === "BracketRight" ||
    e.code === "NumpadAdd" ||
    e.code === "NumpadMultiply"
  ) return 1;
  if (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract") return -1;
  return 0;
}

function readRecentTerminalText(term: Terminal, maxLines = 200): string {
  const buf = term.buffer.active;
  const end = Math.min(buf.length - 1, buf.baseY + buf.cursorY);
  const start = Math.max(0, end - maxLines + 1);
  const lines: string[] = [];

  for (let i = start; i <= end; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }

  return lines.join("\n").trimEnd();
}

function takeQueuedTerminalOutput(queue: Uint8Array[], maxBytes: number): Uint8Array | null {
  if (queue.length === 0) return null;

  let byteLength = 0;
  let chunkCount = 0;
  while (chunkCount < queue.length) {
    const nextLength = queue[chunkCount].byteLength;
    if (chunkCount > 0 && byteLength + nextLength > maxBytes) break;
    byteLength += nextLength;
    chunkCount++;
  }

  const chunks = queue.splice(0, chunkCount);
  if (chunks.length === 1) return chunks[0];

  const merged = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

async function copySelectionToClipboard(text: string): Promise<void> {
  try {
    await copyTextToClipboard(text);
    return;
  } catch {
    // Fall through to the WebView clipboard API when native helpers are unavailable.
  }

  await navigator.clipboard?.writeText(text).catch(() => {
    // Clipboard access can be unavailable in some webview contexts; selection still works.
  });
}

// Cache terminal config globally — fetched once, reused across all panes
let cachedConfig: { theme: ITheme; fontSize: number; fontFamily: string } | null = null;
let configPromise: Promise<void> | null = null;
const MAX_TERMINAL_WRITE_BATCH_BYTES = 256 * 1024;
const HIDDEN_TERMINAL_WRITE_BATCH_BYTES = 64 * 1024;
const HIDDEN_TERMINAL_OUTPUT_QUEUE_HIGH_WATER_BYTES = 8 * 1024 * 1024;
const HIDDEN_TERMINAL_OUTPUT_QUEUE_TARGET_BYTES = 4 * 1024 * 1024;
const HIDDEN_TERMINAL_OUTPUT_DRAIN_DELAY_MS = 100;
const HIGH_OUTPUT_SCREEN_CAPTURE_THRESHOLD_BYTES = 64 * 1024;
const SCREEN_CAPTURE_LINES = 80;
const SCREEN_CAPTURE_MIN_INTERVAL_MS = 1000;
const MAX_METADATA_LOG_LINE_CHARS = 240;
const TERMINAL_INPUT_FLUSH_DELAY_MS = 4;
const MAX_TERMINAL_INPUT_BATCH_CHARS = 4096;
const MAX_TERMINAL_OUTPUT_FLUSHES_PER_FRAME = 4;
const pendingTerminalOutputFlushes = new Set<() => void>();
let terminalOutputFlushFrame: number | null = null;

function scheduleTerminalOutputFlush(flush: () => void) {
  pendingTerminalOutputFlushes.add(flush);
  if (terminalOutputFlushFrame !== null) return;

  terminalOutputFlushFrame = window.requestAnimationFrame(runTerminalOutputFlushes);
}

function cancelTerminalOutputFlush(flush: () => void) {
  pendingTerminalOutputFlushes.delete(flush);
}

function runTerminalOutputFlushes() {
  terminalOutputFlushFrame = null;
  let flushed = 0;

  for (const flush of pendingTerminalOutputFlushes) {
    pendingTerminalOutputFlushes.delete(flush);
    flush();
    flushed++;
    if (flushed >= MAX_TERMINAL_OUTPUT_FLUSHES_PER_FRAME) break;
  }

  if (pendingTerminalOutputFlushes.size > 0) {
    terminalOutputFlushFrame = window.requestAnimationFrame(runTerminalOutputFlushes);
  }
}

function truncateMetadataLogLine(line: string): string {
  return line.length <= MAX_METADATA_LOG_LINE_CHARS
    ? line
    : `${line.slice(0, MAX_METADATA_LOG_LINE_CHARS - 3)}...`;
}

function shouldFlushTerminalInputImmediately(data: string): boolean {
  return /[\x00-\x1f\x7f]/.test(data);
}

function ensureConfigLoaded(): Promise<void> {
  if (cachedConfig) return Promise.resolve();
  if (configPromise) return configPromise;
  configPromise = getTerminalConfig()
    .then((cfg) => {
      // Ghostty/native terminals use physical pixels; xterm.js in a webview uses CSS pixels.
      // Scale up: values below 12 are physical-pixel sizes (e.g. Ghostty font-size = 9)
      // and need to be multiplied to look correct in the webview.
      const rawSize = cfg.font_size;
      const scaled = rawSize < 12 ? Math.round(rawSize * 1.6) : rawSize;
      const fontSize = Math.max(14, scaled);
      cachedConfig = {
        theme: buildThemeFromConfig(cfg),
        fontSize,
        fontFamily: `'${cfg.font_family}', monospace`,
      };
    })
    .catch(() => {
      cachedConfig = null;
      configPromise = null;
    });
  return configPromise;
}

export default memo(function XTermWrapper({
  sessionId,
  workspaceId,
  command,
  args = [],
  onExit,
  theme,
  fontSize,
  fontFamily,
  suppressNotifications = false,
  isVisible = true,
  isFocused = true,
  onZoomToggle,
  onUrlClick,
  cwd,
}: XTermWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const paneFontSizeRef = useRef<number | null>(null);
  const isVisibleRef = useRef(isVisible);
  const requestVisibleOutputFlushRef = useRef<() => void>(() => {});
  
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const storeTheme = useThemeStore((s) => s.theme);
  const storeFontSize = useThemeStore((s) => s.fontSize);

  useEffect(() => {
    isVisibleRef.current = isVisible;
    if (!isVisible) return;
    requestVisibleOutputFlushRef.current();
    setTimeout(() => fitAddonRef.current?.fit(), 0);
  }, [isVisible]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.cursorBlink = isVisible && isFocused;
    }
  }, [isFocused, isVisible]);

  const zoomPaneFont = useCallback((delta: 1 | -1) => {
    const term = termRef.current;
    if (!term) return;
    const current = paneFontSizeRef.current ?? term.options.fontSize ?? storeFontSize;
    const next = Math.max(8, Math.min(40, current + delta));
    paneFontSizeRef.current = next;
    term.options.fontSize = next;
    usePaneFontStore.getState().setFontSize(sessionId, next);
    setTimeout(() => fitAddonRef.current?.fit(), 10);
  }, [sessionId, storeFontSize]);

  useEffect(() => {
    const onPaneZoom = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; delta: 1 | -1 }>).detail;
      if (detail?.sessionId === sessionId) zoomPaneFont(detail.delta);
    };
    window.addEventListener("lmux-pane-font-zoom", onPaneZoom);
    return () => window.removeEventListener("lmux-pane-font-zoom", onPaneZoom);
  }, [sessionId, zoomPaneFont]);

  // Dynamically update terminal theme and font size
  useEffect(() => {
    if (termRef.current) {
      const nextFontSize = fontSize ?? storeFontSize;
      termRef.current.options.theme = storeTheme.terminal;
      termRef.current.options.fontSize = nextFontSize;
      paneFontSizeRef.current = nextFontSize;
      setTimeout(() => fitAddonRef.current?.fit(), 10);
    }
  }, [fontSize, storeTheme, storeFontSize]);

  useEffect(() => {
    const mountStart = performance.now();
    console.log(`[PERF] XTermWrapper mounting for session ${sessionId}`);
    
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let unlistenExit: (() => void) | null = null;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimeout: ReturnType<typeof setTimeout>;
    let logThrottle: ReturnType<typeof setTimeout> | null = null;
    let logThrottlePending = false;
    let selectionCopyTimeout: ReturnType<typeof setTimeout> | null = null;
    let selectionChangeDisposable: { dispose: () => void } | null = null;
    let unregisterInputWriter: (() => void) | null = null;
    let unregisterOutputFlusher: (() => void) | null = null;
    let lastCopiedSelection = "";
    let outputFlushQueued = false;
    let outputWriteInProgress = false;
    let outputWriteIdleResolvers: Array<() => void> = [];
    let queuedOutputBytes = 0;
    let outputBytesSinceScreenCapture = 0;
    let lastScreenCaptureAt = 0;
    const outputQueue: Uint8Array[] = [];
    let hiddenOutputDrainTimeout: ReturnType<typeof setTimeout> | null = null;
    let inputQueue = "";
    let inputFlushTimeout: ReturnType<typeof setTimeout> | null = null;
    let inputWriteInProgress = false;

    const runScheduledOutputFlush = () => {
      outputFlushQueued = false;
      flushOutput();
    };

    const scheduleOutputFlush = () => {
      if (outputFlushQueued) return;
      outputFlushQueued = true;
      scheduleTerminalOutputFlush(runScheduledOutputFlush);
    };

    requestVisibleOutputFlushRef.current = scheduleOutputFlush;

    const notifyOutputWriteIdle = () => {
      const resolvers = outputWriteIdleResolvers;
      outputWriteIdleResolvers = [];
      resolvers.forEach((resolve) => resolve());
    };

    const waitForOutputWriteIdle = () => {
      if (!outputWriteInProgress) return Promise.resolve();
      return new Promise<void>((resolve) => {
        outputWriteIdleResolvers.push(resolve);
      });
    };

    const flushOutput = (visibility: "visible" | "hidden" = isVisibleRef.current ? "visible" : "hidden") => {
      if (disposed || !term) {
        outputQueue.length = 0;
        queuedOutputBytes = 0;
        return;
      }
      if (outputWriteInProgress) return;

      const batchBytes = visibility === "hidden"
        ? HIDDEN_TERMINAL_WRITE_BATCH_BYTES
        : MAX_TERMINAL_WRITE_BATCH_BYTES;
      const nextChunk = takeQueuedTerminalOutput(outputQueue, batchBytes);
      if (!nextChunk) return;
      queuedOutputBytes -= nextChunk.byteLength;
      outputWriteInProgress = true;
      const writeStart = performance.now();
      term.write(nextChunk, () => {
        recordTerminalOutputFlush(performance.now() - writeStart, nextChunk.byteLength, visibility);
        outputWriteInProgress = false;
        notifyOutputWriteIdle();
        if (outputQueue.length > 0 && isVisibleRef.current) scheduleOutputFlush();
        if (queuedOutputBytes > HIDDEN_TERMINAL_OUTPUT_QUEUE_TARGET_BYTES) scheduleHiddenOutputDrain();
      });
    };

    function scheduleHiddenOutputDrain() {
      if (
        hiddenOutputDrainTimeout !== null ||
        isVisibleRef.current ||
        queuedOutputBytes <= HIDDEN_TERMINAL_OUTPUT_QUEUE_TARGET_BYTES
      ) return;

      hiddenOutputDrainTimeout = window.setTimeout(() => {
        hiddenOutputDrainTimeout = null;
        if (disposed || !term || isVisibleRef.current) return;
        flushOutput("hidden");
        if (queuedOutputBytes > HIDDEN_TERMINAL_OUTPUT_QUEUE_TARGET_BYTES) {
          scheduleHiddenOutputDrain();
        }
      }, HIDDEN_TERMINAL_OUTPUT_DRAIN_DELAY_MS);
    }

    const forceFlushOutput = async () => {
      while (!disposed && term) {
        await waitForOutputWriteIdle();
        if (outputQueue.length === 0) break;
        flushOutput();
      }
      await waitForOutputWriteIdle();
      if (!disposed && term) {
        const screenCaptureStart = performance.now();
        useTerminalScreenStore.getState().setScreen(sessionId, {
          text: readRecentTerminalText(term, SCREEN_CAPTURE_LINES),
          rows: term.rows,
          cols: term.cols,
        });
        lastScreenCaptureAt = performance.now();
        outputBytesSinceScreenCapture = 0;
        recordTerminalScreenCapture(performance.now() - screenCaptureStart);
      }
    };

    const enqueueOutput = (rawData: ArrayBuffer) => {
      if (disposed || !term) return;
      const chunk = new Uint8Array(rawData);
      recordTerminalOutputChunk(chunk.byteLength);
      outputQueue.push(chunk);
      queuedOutputBytes += chunk.byteLength;
      recordTerminalQueuedOutputBytes(queuedOutputBytes);
      outputBytesSinceScreenCapture += chunk.byteLength;
      if (!isVisibleRef.current) {
        if (queuedOutputBytes >= HIDDEN_TERMINAL_OUTPUT_QUEUE_HIGH_WATER_BYTES) {
          scheduleHiddenOutputDrain();
        }
        return;
      }
      if (queuedOutputBytes >= MAX_TERMINAL_WRITE_BATCH_BYTES && !outputWriteInProgress) {
        flushOutput();
      } else {
        scheduleOutputFlush();
      }
    };

    const scheduleInputFlush = () => {
      if (inputFlushTimeout !== null) return;
      inputFlushTimeout = window.setTimeout(() => {
        inputFlushTimeout = null;
        flushInput();
      }, TERMINAL_INPUT_FLUSH_DELAY_MS);
    };

    const flushInput = () => {
      if (disposed || !inputQueue || inputWriteInProgress) return;

      const next = inputQueue;
      inputQueue = "";
      inputWriteInProgress = true;
      const start = performance.now();
      writeToSession(sessionId, next)
        .then(() => recordTerminalWriteDuration(performance.now() - start))
        .catch(console.error)
        .finally(() => {
          inputWriteInProgress = false;
          if (inputQueue) scheduleInputFlush();
        });
    };

    const enqueueInput = (data: string) => {
      recordTerminalInput(data);
      inputQueue += data;
      if (
        shouldFlushTerminalInputImmediately(data) ||
        inputQueue.length >= MAX_TERMINAL_INPUT_BATCH_CHARS
      ) {
        if (inputFlushTimeout !== null) {
          clearTimeout(inputFlushTimeout);
          inputFlushTimeout = null;
        }
        flushInput();
      } else {
        scheduleInputFlush();
      }
    };

    async function init() {
      if (disposed) return;
      const initStart = performance.now();

      // Use cached config if available (instant), otherwise use defaults
      const cfg = cachedConfig;
      const initTheme = theme ?? withTerminalBackground(cfg?.theme ?? storeTheme.terminal ?? DEFAULT_THEME, storeTheme.terminal.background ?? DEFAULT_THEME.background!);
      const initFontSize = fontSize ?? cfg?.fontSize ?? storeFontSize;
      const initFontFamily = fontFamily ?? cfg?.fontFamily ?? "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Geist Mono', 'SF Mono', monospace";
      paneFontSizeRef.current = initFontSize;

      term = new Terminal({
        cursorBlink: isVisible && isFocused,
        cursorStyle: "block",
        fontSize: initFontSize,
        fontFamily: initFontFamily,
        fontWeight: 400,
        fontWeightBold: 600,
        letterSpacing: 0,
        lineHeight: 1.0,
        rescaleOverlappingGlyphs: true,
        customGlyphs: true,
        theme: initTheme,
        allowTransparency: false,
        scrollback: 5000,
        smoothScrollDuration: 0,
      });
      termRef.current = term;
      const oscNotificationState = createOscNotificationState();

      fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      const searchAddon = new SearchAddon();
      searchAddonRef.current = searchAddon;
      
      term.loadAddon(fitAddon);
      term.loadAddon(searchAddon);
      term.loadAddon(new WebLinksAddon((_e, uri) => {
        if (onUrlClick) {
          onUrlClick(uri);
        } else {
          open(uri).catch(err => console.error("Failed to open URL:", err));
        }
      }));

      term.open(container!);

      const handleOscNotification = (ident: 9 | 99 | 777, data: string): boolean => {
        if (suppressNotifications) return true;
        const notification = parseOscNotification(ident, data, oscNotificationState);
        if (notification) {
          addPaneNotification(sessionId, notification, { desktop: true, sound: true });
        }
        return true;
      };

      term.parser.registerOscHandler(9, (data) => handleOscNotification(9, data));
      term.parser.registerOscHandler(99, (data) => handleOscNotification(99, data));
      term.parser.registerOscHandler(777, (data) => handleOscNotification(777, data));

      // OSC 52: programs (e.g. Claude Code copy) set the system clipboard via
      // base64 payload "<selection>;<base64>". Reads ("?") are not supported.
      term.parser.registerOscHandler(52, (data) => {
        const semi = data.indexOf(";");
        if (semi === -1) return true;
        const payload = data.slice(semi + 1);
        if (payload === "?") return true;
        try {
          const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
          const text = new TextDecoder().decode(bytes);
          if (text) void copySelectionToClipboard(text);
        } catch {
          // Malformed base64 payload — ignore.
        }
        return true;
      });

      // Forward modifier+key combos that xterm intercepts before the PTY sees them
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type !== "keydown") return true;

        const paneZoomDelta = isPaneZoomKey(e);
        if (paneZoomDelta) {
          zoomPaneFont(paneZoomDelta);
          return false;
        }

        const keybindingStore = useKeybindingStore.getState();
        
        // Check if this event matches ANY app shortcut
        const actions = keybindingStore.getActionsForEvent(e);
        
        // If it matches an app shortcut, let it bubble to AppShell's window listener
        // by returning false (tells xterm to NOT handle it)
        if (actions.length > 0) {
          // Handle terminal-specific shortcuts here before bubbling
          if (actions.includes("terminal.search")) {
            setIsSearchOpen(true);
            setTimeout(() => searchInputRef.current?.focus(), 50);
            return false;
          }
          
          if (actions.includes("pane.zoom.toggle")) {
            onZoomToggle?.();
            return false;
          }

          if (actions.includes("pane.focus.latestUnread")) {
            window.dispatchEvent(new CustomEvent("lmux-keybinding-action", {
              detail: { action: "pane.focus.latestUnread" },
            }));
            return false;
          }
          
          // For all other shortcuts (pane split, workspace nav, etc.),
          // return false to let the event bubble to AppShell
          return false;
        }
        
        // Codex/Claude-style TUIs treat Linefeed as "insert newline" while Enter submits.
        const isShiftEnterNewline =
          (e.key === "Enter" && e.shiftKey) || e.key === "Linefeed";
        if (isShiftEnterNewline && !e.ctrlKey && !e.altKey) {
          enqueueInput("\n");
          return false; // prevent xterm's default handling
        }
        
        // No app shortcut match → let xterm handle it normally (typing, Ctrl+C, etc.)
        return true;
      });

      // Send user keystrokes to PTY — plain text, no encoding
      term.onData((data) => {
        enqueueInput(data);
      });

      term.onBinary((data) => {
        enqueueInput(data);
      });
      unregisterInputWriter = registerTerminalInputWriter(sessionId, enqueueInput);
      unregisterOutputFlusher = registerTerminalOutputFlusher(sessionId, forceFlushOutput);

      selectionChangeDisposable = term.onSelectionChange(() => {
        if (selectionCopyTimeout) clearTimeout(selectionCopyTimeout);
        selectionCopyTimeout = setTimeout(() => {
          if (disposed || !term) return;
          const selection = term.getSelection();
          if (!selection.trim()) {
            lastCopiedSelection = "";
            return;
          }
          if (selection === lastCopiedSelection) return;
          lastCopiedSelection = selection;
          void copySelectionToClipboard(selection);
        }, 80);
      });

      // Track terminal title changes (set via escape sequences by shells/apps)
      term.onTitleChange((title) => {
        if (disposed || !title) return;
        usePaneMetadataStore.getState().setMetadata(sessionId, { processTitle: title });
      });

      let _lastParsedOut = "";
      const scheduleParsedUpdate = () => {
        if (!term) return;
        // Throttle to 500ms — prevents hammering Zustand on every keystroke
        if (logThrottle) {
          logThrottlePending = true;
          return;
        }
        logThrottle = setTimeout(() => {
          logThrottle = null;
          if (!term || disposed) return;
          const buf = term.buffer.active;
          const y = buf.baseY + buf.cursorY;
          let lastLine = "";

          for (let i = y; i >= Math.max(0, y - 10); i--) {
            const lineObj = buf.getLine(i);
            if (lineObj) {
              const text = lineObj.translateToString(true).trim();
              if (text.length > 0) {
                lastLine = text;
                break;
              }
            }
          }

          if (lastLine.length > 0 && lastLine !== _lastParsedOut) {
            _lastParsedOut = lastLine;

            const stripped = lastLine.replace(/\x1b\[[0-9;]*m/g, "").trim();

            // Filter out terminal chrome / status bar noise before storing as log line.
            // These patterns match Claude Code's bottom status bar (token cost, session info)
            // and other terminal UI lines that aren't meaningful agent output.
            const isNoiseLine =
              /\d+k?\s+tokens/i.test(stripped) ||
              /access \d+/i.test(stripped) ||
              /past research/i.test(stripped) ||
              /http:\/\/localhost/i.test(stripped) ||
              /^\s*[\u2500-\u257F]+\s*$/.test(stripped) || // box-drawing chars only
              stripped.length < 3;

            // When agent returns to shell prompt, clear the log line. Do not publish
            // normal prompt input here: holding a key can otherwise churn a growing
            // metadata string every throttle tick.
            const isShellPrompt = /^>\s*$/.test(stripped) || /\$\s*$/.test(stripped);
            const isPromptInput =
              /^❯\s+\S/.test(stripped) ||
              /^[^@\s]+@[^:\s]+:.*[$#]\s+\S/.test(stripped);
            const agentStatus = usePaneMetadataStore.getState().metadata[sessionId]?.agentStatus;
            const shouldPublishLogLine =
              isShellPrompt ||
              (!isPromptInput && !isNoiseLine && (agentStatus === "working" || agentStatus === "waiting"));
            const logLineUpdate = !shouldPublishLogLine
              ? {}
              : isShellPrompt
              ? { lastLogLine: undefined }          // clear on shell prompt
              : { lastLogLine: truncateMetadataLogLine(lastLine) }; // update with meaningful line

            if (Object.keys(logLineUpdate).length > 0) {
              usePaneMetadataStore.getState().setMetadata(sessionId, {
                ...logLineUpdate,
              });
            }
          }

          const bytesSinceLastCapture = outputBytesSinceScreenCapture;
          outputBytesSinceScreenCapture = 0;
          const now = performance.now();
          if (
            now - lastScreenCaptureAt >= SCREEN_CAPTURE_MIN_INTERVAL_MS &&
            bytesSinceLastCapture < HIGH_OUTPUT_SCREEN_CAPTURE_THRESHOLD_BYTES
          ) {
            const screenCaptureStart = performance.now();
            useTerminalScreenStore.getState().setScreen(sessionId, {
              text: readRecentTerminalText(term, SCREEN_CAPTURE_LINES),
              rows: term.rows,
              cols: term.cols,
            });
            lastScreenCaptureAt = now;
            recordTerminalScreenCapture(performance.now() - screenCaptureStart);
          }
          if (logThrottlePending) {
            logThrottlePending = false;
            scheduleParsedUpdate();
          }
        }, 500);
      };
      term.onWriteParsed(scheduleParsedUpdate);

      // Register exit listener before spawning PTY to avoid race
      let sessionStarted = false;
      unlistenExit = await onPtyExit(sessionId, () => {
        if (disposed || !sessionStarted) return;
        onExit?.();
      });

      if (disposed) {
        unlistenExit?.();
        return;
      }

      fitAddon.fit();
      const cols = term.cols;
      const rows = term.rows;

      try {
        await createSession(sessionId, command, args, cols, rows, (rawData: ArrayBuffer) => {
          enqueueOutput(rawData);
        }, cwd, workspaceId);
        sessionStarted = true;
        console.log(`[PERF] Terminal session created - ${(performance.now() - initStart).toFixed(2)}ms`);
      } catch (err) {
        console.error("[XTermWrapper] Failed to create session:", err);
        term.writeln(`\r\n\x1b[31mFailed to start: ${err}\x1b[0m`);
      }

      // Resize observer — 50ms debounce (was 100ms)
      resizeObserver = new ResizeObserver(() => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          if (disposed || !fitAddon || !term) return;
          fitAddon.fit();
          resizeSession(sessionId, term.cols, term.rows).catch(console.error);
        }, 50);
      });
      resizeObserver.observe(container!);

      // If config wasn't cached yet, apply it once loaded (only for first terminal)
      if (!cfg && !theme && !fontSize && !fontFamily) {
        ensureConfigLoaded().then(() => {
          if (disposed || !term || !cachedConfig) return;
          term.options.theme = withTerminalBackground(cachedConfig.theme, storeTheme.terminal.background ?? DEFAULT_THEME.background!);
          term.options.fontSize = cachedConfig.fontSize;
          term.options.fontFamily = cachedConfig.fontFamily;
          fitAddon?.fit();
        });
      }
    }

    init();

    return () => {
      disposed = true;
      const cleanupStart = performance.now();
      clearTimeout(resizeTimeout);
      cancelTerminalOutputFlush(runScheduledOutputFlush);
      outputFlushQueued = false;
      if (hiddenOutputDrainTimeout !== null) {
        clearTimeout(hiddenOutputDrainTimeout);
        hiddenOutputDrainTimeout = null;
      }
      if (inputFlushTimeout !== null) {
        clearTimeout(inputFlushTimeout);
        inputFlushTimeout = null;
      }
      inputQueue = "";
      outputQueue.length = 0;
      unregisterInputWriter?.();
      unregisterOutputFlusher?.();
      requestVisibleOutputFlushRef.current = () => {};
      if (logThrottle) { clearTimeout(logThrottle); logThrottle = null; }
      if (selectionCopyTimeout) { clearTimeout(selectionCopyTimeout); selectionCopyTimeout = null; }
      useTerminalScreenStore.getState().clearScreen(sessionId);
      resizeObserver?.disconnect();
      unlistenExit?.();
      selectionChangeDisposable?.dispose();
      term?.dispose();
      searchAddonRef.current = null;
      console.log(`[PERF] XTermWrapper unmounted for session ${sessionId} - mount duration: ${(cleanupStart - mountStart).toFixed(2)}ms, cleanup: ${(performance.now() - cleanupStart).toFixed(2)}ms`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val && searchAddonRef.current) {
      searchAddonRef.current.findNext(val, { decorations: { matchBackground: '#063b16', matchBorder: '#00ff41', matchOverviewRuler: '#00ff41', activeMatchBackground: '#00ff41', activeMatchBorder: '#00ff41', activeMatchColorOverviewRuler: '#00ff41' } });
    } else if (searchAddonRef.current) {
      searchAddonRef.current.clearDecorations();
    }
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        searchAddonRef.current?.findPrevious(searchQuery);
      } else {
        searchAddonRef.current?.findNext(searchQuery);
      }
    } else if (e.key === "Escape") {
      setIsSearchOpen(false);
      setSearchQuery("");
      searchAddonRef.current?.clearDecorations();
      containerRef.current?.querySelector("textarea")?.focus();
    }
  }, [searchQuery]);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    searchAddonRef.current?.clearDecorations();
    containerRef.current?.querySelector("textarea")?.focus();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files).map((f) => {
        const path = (f as any).path || f.name;
        // Escape spaces
        return `"${path}"`;
      });
      writeToSession(sessionId, paths.join(" ") + " ").catch(console.error);
    }
  }, [sessionId]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }} onDrop={handleDrop} onDragOver={handleDragOver}>
      {isSearchOpen && (
        <div style={{
          position: "absolute",
          top: 8,
          right: 16,
          zIndex: 50,
          background: "var(--cmux-bg, #101010)",
          border: "1px solid var(--cmux-border, #333)",
          borderRadius: 6,
          padding: "4px 8px",
          display: "flex",
          gap: 8,
          alignItems: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          color: "var(--cmux-text, #ededed)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12
        }}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Find..."
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              outline: "none",
              fontFamily: "inherit",
              fontSize: "inherit",
              width: 150
            }}
          />
          <button onClick={() => searchAddonRef.current?.findPrevious(searchQuery)} style={searchBtnStyle}>↑</button>
          <button onClick={() => searchAddonRef.current?.findNext(searchQuery)} style={searchBtnStyle}>↓</button>
          <button onClick={closeSearch} style={searchBtnStyle}>✕</button>
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
          contain: "strict",
          background: "var(--cmux-bg, #101010)",
        }}
      />
    </div>
  );
});

const searchBtnStyle = {
  background: "transparent",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  padding: "0 4px",
  opacity: 0.7,
  fontFamily: "inherit"
};
