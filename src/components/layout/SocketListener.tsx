import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  useWorkspaceListStore,
  useWorkspaceLayoutStore,
  useUiStore,
  usePaneMetadataStore,
  useTerminalScreenStore,
} from "../../stores/workspaceStore";
import { killSession, sendSocketResponse, writeToSession } from "../../lib/ipc";
import { useThemeStore } from "../../stores/themeStore";
import { addPaneNotification, parseNotificationPayload } from "../../lib/notifications";
import type { AgentStatus } from "../../stores/paneMetadataStoreCompat";
import { getTerminalPerfStats, resetTerminalPerfStats } from "../../lib/perfTelemetry";
import { flushRegisteredTerminalOutput, writeRegisteredTerminalInput } from "../../lib/terminalInputRegistry";

interface SocketRequest {
  id: number;
  cmd: string;
  args: any;
}

interface DesktopNotificationActivated {
  workspace_id: string;
  surface_id: string;
}

export default function SocketListener() {
  useEffect(() => {
    const unlisten = listen<DesktopNotificationActivated>("desktop-notification-activated", (event) => {
      const { workspace_id, surface_id } = event.payload;
      const listStore = useWorkspaceListStore.getState();
      const layoutStore = useWorkspaceLayoutStore.getState();
      const uiStore = useUiStore.getState();
      const metadataStore = usePaneMetadataStore.getState();
      const workspace = listStore.workspaces.find((w) => w.id === workspace_id);
      if (!workspace) return;

      for (const pane of workspace.panes) {
        const tab = pane.tabs.find((t) => t.sessionId === surface_id || t.id === surface_id);
        if (!tab) continue;
        listStore.setActiveWorkspace(workspace.id);
        layoutStore.setActivePaneTab(workspace.id, pane.id, tab.id);
        uiStore.setActivePaneId(tab.sessionId);
        metadataStore.clearNotification(tab.sessionId);
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>(`[data-session-id="${tab.sessionId}"]`);
          const textarea = el?.querySelector<HTMLTextAreaElement>("textarea");
          if (textarea) textarea.focus(); else el?.focus();
        }, 0);
        return;
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<SocketRequest>("socket-request", async (event) => {
      const { id, cmd, args } = event.payload;
      let result = null;
      let error = null;

      try {
        const listStore = useWorkspaceListStore.getState();
        const layoutStore = useWorkspaceLayoutStore.getState();
        const uiStore = useUiStore.getState();
        const metadataStore = usePaneMetadataStore.getState();
        const activeWorkspace = () => listStore.workspaces.find((w) => w.id === listStore.activeWorkspaceId);
        const paneMatchesSession = (pane: any, sessionId: string | null) =>
          Boolean(sessionId) && (
            pane.sessionId === sessionId ||
            pane.tabs.some((t: any) => t.sessionId === sessionId || t.id === sessionId)
          );
        const activeSessionId = () => {
          const ws = activeWorkspace();
          const pane = ws?.panes.find((p) => paneMatchesSession(p, uiStore.activePaneId)) ?? ws?.panes[0];
          const activeTab = pane?.tabs.find((t) => t.id === pane.activeTabId);
          return activeTab?.sessionId ?? pane?.sessionId ?? null;
        };
        const sessionInWorkspace = (workspaceId: string, surfaceId?: string) => {
          const ws = listStore.workspaces.find((w) => w.id === workspaceId);
          if (!ws) return null;
          if (!surfaceId) {
            const pane = ws.panes.find((p) => paneMatchesSession(p, uiStore.activePaneId)) ?? ws.panes[0];
            const activeTab = pane?.tabs.find((t) => t.id === pane.activeTabId);
            return activeTab?.sessionId ?? pane?.sessionId ?? null;
          }
          const index = Number(surfaceId);
          if (Number.isInteger(index) && index >= 0 && index < ws.panes.length) {
            const pane = ws.panes[index];
            const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
            return activeTab?.sessionId ?? pane.sessionId;
          }
          for (const pane of ws.panes) {
            if (pane.sessionId === surfaceId || pane.id === surfaceId) {
              const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
              return activeTab?.sessionId ?? pane.sessionId;
            }
            const tab = pane.tabs.find((t) => t.sessionId === surfaceId || t.id === surfaceId);
            if (tab) return tab.sessionId;
          }
          return null;
        };
        const notifySession = (sessionId: string | null, payload: string, fallbackTitle = "Notification") => {
          if (!sessionId) {
            error = "Notification target not found";
            return;
          }
          const notification = payload.trim()
            ? parseNotificationPayload(payload)
            : { title: fallbackTitle };
          addPaneNotification(sessionId, notification, { desktop: true, sound: true });
          result = { success: true, surface_id: sessionId };
        };
        const normalizeUrl = (raw: string) => {
          const url = raw.trim();
          if (!url) return "about:blank";
          if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("about:")) return url;
          return `https://${url}`;
        };
        const resolveSurface = (input: any = args) => {
          const workspaceId = input?.workspace_id ?? input?.workspaceId ?? listStore.activeWorkspaceId;
          const workspace = workspaceId
            ? listStore.workspaces.find((w) => w.id === workspaceId)
            : activeWorkspace();
          if (!workspace) return null;

          const surfaceId =
            input?.surface_id ??
            input?.surfaceId ??
            input?.session_id ??
            input?.sessionId ??
            input?.pane_id ??
            input?.paneId ??
            input?.id;

          if (!surfaceId) {
            const pane = workspace.panes.find((p) => paneMatchesSession(p, uiStore.activePaneId)) ?? workspace.panes[0];
            const tab = pane?.tabs.find((t) => t.id === pane.activeTabId) ?? pane?.tabs[0];
            return pane && tab ? { workspace, pane, tab, sessionId: tab.sessionId } : null;
          }

          const index = Number(surfaceId);
          if (Number.isInteger(index) && index >= 0 && index < workspace.panes.length) {
            const pane = workspace.panes[index];
            const tab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
            return tab ? { workspace, pane, tab, sessionId: tab.sessionId } : null;
          }

          for (const pane of workspace.panes) {
            if (pane.id === surfaceId || pane.sessionId === surfaceId) {
              const tab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
              return tab ? { workspace, pane, tab, sessionId: tab.sessionId } : null;
            }
            const tab = pane.tabs.find((t) => t.id === surfaceId || t.sessionId === surfaceId);
            if (tab) return { workspace, pane, tab, sessionId: tab.sessionId };
          }
          return null;
        };
        const serializeSurface = (workspace: any, pane: any, tab: any) => {
          const meta = metadataStore.metadata[tab.sessionId] ?? {};
          return {
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            pane_id: pane.id,
            pane_index: workspace.panes.indexOf(pane),
            pane_label: pane.label ?? null,
            surface_id: tab.sessionId,
            session_id: tab.sessionId,
            tab_id: tab.id,
            type: tab.type ?? "terminal",
            agent_id: tab.agentId ?? pane.agentId,
            active_in_pane: pane.activeTabId === tab.id,
            focused: uiStore.activePaneId === tab.sessionId,
            status: meta.agentStatus ?? "idle",
            progress: meta.progress ?? null,
            progress_label: meta.progressLabel ?? null,
            last_log_line: meta.lastLogLine ?? null,
            notification_count: meta.notificationCount ?? 0,
            last_notification_at: meta.lastNotificationAt ?? null,
            cwd: meta.cwd ?? pane.cwd ?? null,
            git_branch: meta.gitBranch ?? pane.gitBranch ?? null,
            process_title: meta.processTitle ?? null,
          };
        };
        const focusSurface = (workspace: any, pane: any, tab: any) => {
          listStore.setActiveWorkspace(workspace.id);
          layoutStore.setActivePaneTab(workspace.id, pane.id, tab.id);
          uiStore.setActivePaneId(tab.sessionId);
          metadataStore.clearNotification(tab.sessionId);
          setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-session-id="${tab.sessionId}"]`);
            const textarea = el?.querySelector<HTMLTextAreaElement>("textarea");
            if (textarea) textarea.focus(); else el?.focus();
          }, 0);
          return { success: true, ...serializeSurface(workspace, pane, tab) };
        };
        const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const findLatestUnreadOrFinished = () => {
          let unread: { workspace: any; pane: any; tab: any; at: number } | null = null;
          let finished: { workspace: any; pane: any; tab: any; at: number } | null = null;

          for (const workspace of listStore.workspaces) {
            for (const pane of workspace.panes) {
              for (const tab of pane.tabs) {
                const meta = metadataStore.metadata[tab.sessionId];
                if (!meta) continue;
                if ((meta.notificationCount ?? 0) > 0) {
                  const at = meta.lastNotificationAt ?? 0;
                  if (!unread || at >= unread.at) unread = { workspace, pane, tab, at };
                }
                if (meta.agentStatus === "done" && meta.lastFinishedAt) {
                  const at = meta.lastFinishedAt;
                  if (!finished || at >= finished.at) finished = { workspace, pane, tab, at };
                }
              }
            }
          }

          return unread ?? finished;
        };
        
        switch (cmd) {
          case "debug.perf":
          case "perf.stats":
            result = getTerminalPerfStats();
            break;

          case "debug.perf.reset":
          case "perf.reset":
            resetTerminalPerfStats();
            result = { success: true };
            break;

          case "debug.perf.input-benchmark":
          case "perf.input-benchmark": {
            const target = resolveSurface();
            if (!target) {
              error = "Pane target not found";
              break;
            }

            const chars = Math.max(1, Number(args?.chars ?? 900));
            const delayMs = Math.max(0, Number(args?.delay_ms ?? args?.delayMs ?? 1));
            const stamp = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
            const prefix = `lmuxbenchstart${stamp} `;
            const suffix = ` lmuxbenchend${stamp}`;
            const phrase = "typing latency benchmark ddddd quick normal words ";
            const bodyLength = Math.max(0, chars - prefix.length - suffix.length);
            const body = phrase.repeat(Math.ceil(bodyLength / phrase.length)).slice(0, bodyLength);
            const payload = `${prefix}${body}${suffix}`;
            const marker = "lmuxbenchend";

            if (!writeRegisteredTerminalInput(target.sessionId, "\x15")) {
              error = "Input writer not registered for pane";
              break;
            }
            await sleep(80);

            resetTerminalPerfStats();
            const started = performance.now();
            for (const char of payload) {
              writeRegisteredTerminalInput(target.sessionId, char);
              if (delayMs > 0) await sleep(delayMs);
            }
            const injectedAt = performance.now();

            let visibleAt: number | null = null;
            let screenText = "";
            for (let i = 0; i < 100; i++) {
              screenText = useTerminalScreenStore.getState().screens[target.sessionId]?.text ?? "";
              if (screenText.includes(marker)) {
                visibleAt = performance.now();
                break;
              }
              await sleep(50);
            }

            result = {
              success: true,
              chars: payload.length,
              delay_ms: delayMs,
              workspace_id: target.workspace.id,
              surface_id: target.sessionId,
              injected_ms: injectedAt - started,
              visible_ms: visibleAt === null ? null : visibleAt - started,
              visible: visibleAt !== null,
              stats: getTerminalPerfStats(),
              screen_tail: screenText.slice(-240),
            };

            writeRegisteredTerminalInput(target.sessionId, "\x15");
            break;
          }

          case "workspace.list":
            result = listStore.workspaces.map(w => ({
              id: w.id,
              name: w.name,
              status: w.status,
              active: listStore.activeWorkspaceId === w.id,
            }));
            break;
            
          case "workspace.new":
            const workspaceId = crypto.randomUUID();
            const template = args?.template || "1x1";
            const { panes, splitRows, splitLayout } = layoutStore.buildInitialPanes(workspaceId, template);
            const ws = listStore.createWorkspace(
              args?.name || `Workspace ${listStore.workspaces.length + 1}`,
              template,
              panes,
              splitRows,
              splitLayout
            );
            result = { id: ws.id, name: ws.name };
            break;
            
          case "workspace.select":
            if (args?.id) {
              listStore.setActiveWorkspace(args.id);
              result = { success: true };
            } else {
              error = "Missing id argument";
            }
            break;
            
          case "workspace.close":
            if (args?.id) {
              const workspace = listStore.workspaces.find((w) => w.id === args.id);
              if (workspace) {
                await Promise.allSettled(
                  workspace.panes.flatMap((pane) =>
                    pane.tabs.map((tab) => killSession(tab.sessionId))
                  )
                );
              }
              listStore.removeWorkspace(args.id);
              result = { success: true };
            } else {
              error = "Missing id argument";
            }
            break;

          case "workspace.rename":
            if (args?.id && args?.name) {
              listStore.renameWorkspace(args.id, String(args.name));
              result = { success: true };
            } else {
              error = "Missing id or name argument";
            }
            break;

          case "pane.list": {
            const workspaceId = args?.workspace_id ?? args?.workspaceId;
            const workspaces = workspaceId
              ? listStore.workspaces.filter((w) => w.id === workspaceId)
              : listStore.workspaces;
            result = workspaces.flatMap((workspace) =>
              workspace.panes.flatMap((pane) =>
                pane.tabs.map((tab) => serializeSurface(workspace, pane, tab))
              )
            );
            break;
          }

          case "pane.focus": {
            const target = resolveSurface();
            if (!target) {
              error = "Pane target not found";
              break;
            }
            result = focusSurface(target.workspace, target.pane, target.tab);
            break;
          }

          case "pane.focus.latestUnread":
          case "pane.focus_latest_unread": {
            const target = findLatestUnreadOrFinished();
            if (!target) {
              error = "No unread or finished pane found";
              break;
            }
            result = focusSurface(target.workspace, target.pane, target.tab);
            break;
          }

          case "pane.write": {
            const target = resolveSurface();
            const text = args?.text ?? args?.data ?? args?.input;
            if (!target) {
              error = "Pane target not found";
              break;
            }
            if (typeof text !== "string") {
              error = "Missing text argument";
              break;
            }
            const data = args?.enter || args?.submit || args?.newline
              ? text.endsWith("\n") ? text : `${text}\n`
              : text;
            await writeToSession(target.sessionId, data);
            result = { success: true, surface_id: target.sessionId, bytes: data.length };
            break;
          }

          case "pane.read-screen": {
            const target = resolveSurface();
            if (!target) {
              error = "Pane target not found";
              break;
            }
            await flushRegisteredTerminalOutput(target.sessionId);
            const screen = useTerminalScreenStore.getState().screens[target.sessionId];
            const maxLines = Number(args?.max_lines ?? args?.maxLines ?? 200);
            const lines = screen?.text ? screen.text.split("\n") : [];
            const text = Number.isFinite(maxLines) && maxLines > 0
              ? lines.slice(-maxLines).join("\n")
              : lines.join("\n");
            result = {
              success: true,
              surface_id: target.sessionId,
              available: Boolean(screen),
              text,
              rows: screen?.rows ?? null,
              cols: screen?.cols ?? null,
              updated_at: screen?.updatedAt ?? null,
            };
            break;
          }

          case "pane.kill": {
            const target = resolveSurface();
            if (!target) {
              error = "Pane target not found";
              break;
            }
            await killSession(target.sessionId);
            metadataStore.setAgentStatus(target.sessionId, "idle");
            result = { success: true, surface_id: target.sessionId };
            break;
          }

          case "pane.split-right": {
            const target = resolveSurface();
            if (target) {
              layoutStore.addPaneToWorkspace(target.workspace.id, target.pane.id, "right");
              result = { success: true };
            } else {
              error = "No active pane to split";
            }
            break;
          }

          case "pane.split-down": {
            const target = resolveSurface();
            if (target) {
              layoutStore.addPaneToWorkspace(target.workspace.id, target.pane.id, "down");
              result = { success: true };
            } else {
              error = "No active pane to split";
            }
            break;
          }

          case "pane.close": {
            const target = resolveSurface();
            if (target) {
              const ws = target.workspace;
              const pane = target.pane;
              await Promise.allSettled(pane.tabs.map((tab: any) => killSession(tab.sessionId)));
              layoutStore.removePaneFromWorkspace(ws.id, pane.id);
              // Focus a remaining pane
              if (ws && pane) {
                const remaining = ws.panes.filter((p) => p.id !== pane.id);
                if (remaining.length > 0) {
                  uiStore.setActivePaneId(remaining[0].sessionId);
                } else {
                  uiStore.setActivePaneId(null);
                }
              }
              result = { success: true };
            } else {
              error = "No active pane to close";
            }
            break;
          }

          case "pane.rename": {
            const target = resolveSurface();
            const label = args?.label ?? args?.name;
            if (!target) {
              error = "Pane target not found";
            } else if (typeof label !== "string") {
              error = "Missing label argument";
            } else {
              const agentRenames = await layoutStore.renamePane(target.workspace.id, target.pane.id, label);
              result = {
                success: true,
                workspace_id: target.workspace.id,
                pane_id: target.pane.id,
                label: label.trim() || null,
                agent_renames: agentRenames,
              };
            }
            break;
          }

          case "notify":
          case "notify.send":
          case "notification.create":
          case "notification.create_for_caller": {
            const sessionId = args?.surface_id
              ? sessionInWorkspace(args?.workspace_id || listStore.activeWorkspaceId || "", args.surface_id)
              : activeSessionId();
            const payload = args?.payload
              ?? [args?.title, args?.subtitle, args?.body].filter((v) => v !== undefined && v !== null).join("|");
            notifySession(sessionId, payload);
            break;
          }

          case "notify_surface":
          case "notification.create_for_surface": {
            const workspaceId = args?.workspace_id || listStore.activeWorkspaceId;
            if (!workspaceId) {
              error = "No active workspace";
              break;
            }
            const sessionId = sessionInWorkspace(workspaceId, args?.surface_id);
            const payload = args?.payload
              ?? [args?.title, args?.subtitle, args?.body].filter((v) => v !== undefined && v !== null).join("|");
            notifySession(sessionId, payload);
            break;
          }

          case "notify_target":
          case "notify_target_async":
          case "notification.create_for_target": {
            const workspaceId = args?.workspace_id;
            const surfaceId = args?.surface_id;
            if (!workspaceId || !surfaceId) {
              error = "Missing workspace_id or surface_id";
              break;
            }
            const sessionId = sessionInWorkspace(workspaceId, surfaceId);
            const payload = args?.payload
              ?? [args?.title, args?.subtitle, args?.body].filter((v) => v !== undefined && v !== null).join("|");
            notifySession(sessionId, payload);
            break;
          }

          case "list_notifications":
          case "notification.list": {
            result = listStore.workspaces.flatMap((workspace) =>
              workspace.panes.flatMap((pane) => {
                const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
                const sessionId = activeTab?.sessionId ?? pane.sessionId;
                const meta = metadataStore.metadata[sessionId];
                if (!meta || (meta.notificationCount ?? 0) <= 0) return [];
                return [{
                  workspace_id: workspace.id,
                  surface_id: sessionId,
                  title: meta.lastNotificationTitle ?? "Notification",
                  body: meta.lastNotificationBody ?? "",
                  count: meta.notificationCount ?? 0,
                  created_at: meta.lastNotificationAt ?? null,
                  is_read: false,
                }];
              })
            );
            break;
          }

          case "clear_notifications":
          case "notify.clear":
          case "notification.clear": {
            const workspaceId = args?.workspace_id;
            const surfaceId = args?.surface_id;
            for (const workspace of listStore.workspaces) {
              if (workspaceId && workspace.id !== workspaceId) continue;
              for (const pane of workspace.panes) {
                for (const tab of pane.tabs) {
                  if (surfaceId && tab.sessionId !== surfaceId && pane.sessionId !== surfaceId && pane.id !== surfaceId) continue;
                  metadataStore.clearNotification(tab.sessionId);
                }
              }
            }
            result = { success: true };
            break;
          }

          case "set_status":
          case "status.set":
          case "agent.status": {
            const target = resolveSurface();
            const sessionId = target?.sessionId ?? activeSessionId();
            const status = String(args?.status || args?.state || "idle").toLowerCase();
            if (!sessionId) {
              error = "Status target not found";
              break;
            }
            if (!["working", "waiting", "done", "idle"].includes(status)) {
              error = `Invalid status: ${status}`;
              break;
            }
            metadataStore.setAgentStatus(sessionId, status as AgentStatus, args?.message || args?.last_log_line);
            result = { success: true, surface_id: sessionId, status };
            break;
          }

          case "clear_status":
          case "status.clear":
          case "agent.clear_status": {
            const target = resolveSurface();
            const sessionId = target?.sessionId ?? activeSessionId();
            if (!sessionId) {
              error = "Status target not found";
              break;
            }
            metadataStore.setAgentStatus(sessionId, "idle");
            result = { success: true, surface_id: sessionId };
            break;
          }

          case "progress.set": {
            const target = resolveSurface();
            if (!target) {
              error = "Progress target not found";
              break;
            }
            const raw = Number(args?.value ?? args?.progress ?? 0);
            if (!Number.isFinite(raw)) {
              error = "Invalid progress value";
              break;
            }
            const progress = Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw));
            metadataStore.setMetadata(target.sessionId, {
              progress,
              progressLabel: args?.label ?? args?.message,
              lastProgressAt: Date.now(),
            });
            result = { success: true, surface_id: target.sessionId, progress };
            break;
          }

          case "progress.clear": {
            const target = resolveSurface();
            if (!target) {
              error = "Progress target not found";
              break;
            }
            metadataStore.setMetadata(target.sessionId, {
              progress: undefined,
              progressLabel: undefined,
              lastProgressAt: Date.now(),
            });
            result = { success: true, surface_id: target.sessionId };
            break;
          }

          case "browser.open": {
            const workspaceId = args?.workspace_id ?? args?.workspaceId ?? listStore.activeWorkspaceId;
            const workspace = workspaceId ? listStore.workspaces.find((w) => w.id === workspaceId) : activeWorkspace();
            if (!workspace) {
              error = "No active workspace";
              break;
            }

            const target = resolveSurface({ ...args, workspace_id: workspace.id });
            const pane = target?.pane ?? workspace.panes[0];
            if (!pane) {
              error = "No pane available for browser";
              break;
            }

            const previousActiveTabId = pane.activeTabId;
            const previousActivePaneId = uiStore.activePaneId;
            const tab = layoutStore.addTabToPane(workspace.id, pane.id, pane.agentId, "browser");
            if (!tab) {
              error = "Failed to create browser surface";
              break;
            }

            if (args?.focus === false) {
              layoutStore.setActivePaneTab(workspace.id, pane.id, previousActiveTabId);
              uiStore.setActivePaneId(previousActivePaneId);
            } else {
              uiStore.setActivePaneId(tab.sessionId);
            }

            if (args?.url) {
              const url = normalizeUrl(String(args.url));
              window.setTimeout(() => {
                invoke("browser_navigate", { sessionId: tab.sessionId, url }).catch(() => {});
              }, 250);
            }

            result = {
              success: true,
              workspace_id: workspace.id,
              pane_id: pane.id,
              surface_id: tab.sessionId,
              session_id: tab.sessionId,
              type: "browser",
            };
            break;
          }

          case "browser.navigate":
          case "browser.eval":
          case "browser.snapshot":
          case "browser.status":
          case "browser.click":
          case "browser.fill":
          case "browser.wait": {
            // Find the target browser pane session ID
            const targetPaneId = (() => {
              const explicitTarget = resolveSurface();
              if (explicitTarget && (explicitTarget.tab.type ?? "terminal") === "browser") return explicitTarget.sessionId;
              const activeWs = listStore.workspaces.find(
                (w) => w.id === listStore.activeWorkspaceId
              );
              if (!activeWs) return null;
              for (const pane of activeWs.panes) {
                const browserTab = pane.tabs.find((t) => t.type === "browser");
                if (browserTab) return browserTab.sessionId;
              }
              return null;
            })();

            if (!targetPaneId) {
              error = "No browser pane found";
              break;
            }

            if (cmd === "browser.navigate") {
              let url = (args?.url as string) || "about:blank";
              if (url && !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("about:")) {
                url = "https://" + url;
              }
              result = await invoke("browser_navigate", { sessionId: targetPaneId, url });

            } else if (cmd === "browser.eval") {
              const script = args?.script as string;
              if (!script) { error = "Missing script argument"; break; }
              result = await invoke("browser_eval", { sessionId: targetPaneId, script });

            } else if (cmd === "browser.snapshot") {
              result = await invoke("browser_snapshot", { sessionId: targetPaneId });

            } else if (cmd === "browser.status") {
              result = await invoke("browser_status", { sessionId: targetPaneId });

            } else if (cmd === "browser.click") {
              const selector = args?.selector as string;
              if (!selector) { error = "Missing selector argument"; break; }
              const clickScript = `
                (() => {
                  const el = document.querySelector(${JSON.stringify(selector)});
                  if (!el) return JSON.stringify({ ok: false, error: 'not_found' });
                  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  if (typeof el.click === 'function') { el.click(); }
                  else { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 })); }
                  return JSON.stringify({ ok: true });
                })()
              `;
              result = await invoke("browser_eval", { sessionId: targetPaneId, script: clickScript });

            } else if (cmd === "browser.fill") {
              const selector = args?.selector as string;
              const text = args?.text as string ?? "";
              if (!selector) { error = "Missing selector argument"; break; }
              const fillScript = `
                (() => {
                  const el = document.querySelector(${JSON.stringify(selector)});
                  if (!el) return JSON.stringify({ ok: false, error: 'not_found' });
                  if ('value' in el) {
                    el.value = ${JSON.stringify(text)};
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  } else {
                    el.textContent = ${JSON.stringify(text)};
                  }
                  return JSON.stringify({ ok: true });
                })()
              `;
              result = await invoke("browser_eval", { sessionId: targetPaneId, script: fillScript });

            } else if (cmd === "browser.wait") {
              const waitFor = args?.for as string || "load";
              const timeout = (args?.timeout as number) || 10000;
              const selector = args?.selector as string;

              const waitScript = (() => {
                if (waitFor === "load_state" || waitFor === "load") {
                  return `document.readyState === 'complete' ? JSON.stringify({ok:true}) : null`;
                } else if (waitFor === "selector" && selector) {
                  return `document.querySelector(${JSON.stringify(selector)}) !== null ? JSON.stringify({ok:true}) : null`;
                } else if (waitFor === "url_contains" && args?.text) {
                  return `String(location.href).includes(${JSON.stringify(args.text)}) ? JSON.stringify({ok:true}) : null`;
                } else if (waitFor === "text_contains" && args?.text) {
                  return `document.body && document.body.innerText.includes(${JSON.stringify(args.text)}) ? JSON.stringify({ok:true}) : null`;
                }
                return `JSON.stringify({ok:true})`;
              })();

              // Poll until condition is met or timeout
              const start = Date.now();
              let waitResult = null;
              while (Date.now() - start < timeout) {
                const evalResult = await invoke<{ result: any }>("browser_eval", {
                  sessionId: targetPaneId,
                  script: waitScript,
                });
                if (evalResult?.result !== null && evalResult?.result !== undefined) {
                  waitResult = evalResult.result;
                  break;
                }
                await new Promise((r) => setTimeout(r, 200));
              }
              if (!waitResult) {
                error = `browser.wait timed out after ${timeout}ms`;
              } else {
                result = waitResult;
              }
            }
            break;
          }

          case "theme.set":
            if (args?.id) {
              useThemeStore.getState().setTheme(args.id);
              result = { success: true };
            } else {
              error = "Missing id argument";
            }
            break;

          default:
            error = `Unknown command: ${cmd}`;
        }
      } catch (err: any) {
        error = err.toString();
      }

      await sendSocketResponse(id, result, error);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  return null;
}
