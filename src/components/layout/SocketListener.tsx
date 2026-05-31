import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  useWorkspaceListStore,
  useWorkspaceLayoutStore,
  useUiStore,
  usePaneMetadataStore,
} from "../../stores/workspaceStore";
import { sendSocketResponse } from "../../lib/ipc";
import { useThemeStore } from "../../stores/themeStore";
import { addPaneNotification, parseNotificationPayload } from "../../lib/notifications";
import type { AgentStatus } from "../../stores/paneMetadataStoreCompat";

interface SocketRequest {
  id: number;
  cmd: string;
  args: any;
}

export default function SocketListener() {
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
        const activeSessionId = () => {
          const ws = activeWorkspace();
          const pane = ws?.panes.find((p) => p.sessionId === uiStore.activePaneId) ?? ws?.panes[0];
          const activeTab = pane?.tabs.find((t) => t.id === pane.activeTabId);
          return activeTab?.sessionId ?? pane?.sessionId ?? null;
        };
        const sessionInWorkspace = (workspaceId: string, surfaceId?: string) => {
          const ws = listStore.workspaces.find((w) => w.id === workspaceId);
          if (!ws) return null;
          if (!surfaceId) {
            const pane = ws.panes.find((p) => p.sessionId === uiStore.activePaneId) ?? ws.panes[0];
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
            if (pane.sessionId === surfaceId || pane.id === surfaceId) return pane.sessionId;
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
        
        switch (cmd) {
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
              listStore.removeWorkspace(args.id);
              result = { success: true };
            } else {
              error = "Missing id argument";
            }
            break;

          case "pane.split-right":
            if (listStore.activeWorkspaceId && uiStore.activePaneId) {
              layoutStore.addPaneToWorkspace(listStore.activeWorkspaceId, uiStore.activePaneId, "right");
              result = { success: true };
            } else {
              error = "No active pane to split";
            }
            break;

          case "pane.split-down":
            if (listStore.activeWorkspaceId && uiStore.activePaneId) {
              layoutStore.addPaneToWorkspace(listStore.activeWorkspaceId, uiStore.activePaneId, "down");
              result = { success: true };
            } else {
              error = "No active pane to split";
            }
            break;

          case "pane.close": {
            const wsId = listStore.activeWorkspaceId;
            const paneId = uiStore.activePaneId;
            if (wsId && paneId) {
              const ws = listStore.workspaces.find((w) => w.id === wsId);
              const pane = ws?.panes.find((p) => p.sessionId === paneId);
              layoutStore.removePaneFromWorkspace(wsId, paneId);
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

          case "notify":
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
          case "agent.status": {
            const workspaceId = args?.workspace_id || listStore.activeWorkspaceId;
            const sessionId = args?.surface_id && workspaceId
              ? sessionInWorkspace(workspaceId, args.surface_id)
              : activeSessionId();
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
          case "agent.clear_status": {
            const workspaceId = args?.workspace_id || listStore.activeWorkspaceId;
            const sessionId = args?.surface_id && workspaceId
              ? sessionInWorkspace(workspaceId, args.surface_id)
              : activeSessionId();
            if (!sessionId) {
              error = "Status target not found";
              break;
            }
            metadataStore.setAgentStatus(sessionId, "idle");
            result = { success: true, surface_id: sessionId };
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
              if (args?.pane_id) return args.pane_id as string;
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
