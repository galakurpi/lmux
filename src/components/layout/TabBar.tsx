import { useState } from "react";
import { useWorkspaceListStore, usePaneMetadataStore } from "../../stores/workspaceStore";
import { SIDEBAR_WIDTH } from "../../lib/constants";
import TabItem from "./TabItem";

interface TabBarProps {
  uiVariant?: "default" | "cmux";
  onCloseWorkspace: (id: string) => void;
}

const HELP_ROWS = [
  ["Split right", "Ctrl+Shift+D"],
  ["Split down", "Ctrl+Shift+X"],
  ["Focus panes", "Ctrl+Shift+Arrows"],
  ["New workspace", "Ctrl+Shift+N"],
  ["Switch workspaces", "Ctrl+1..9"],
  ["Close pane", "Ctrl+Shift+W"],
  ["Zoom focused pane in", "Ctrl+Shift++"],
  ["Zoom focused pane out", "Ctrl+Shift+-"],
  ["Find in terminal", "Ctrl+Shift+F"],
  ["Zoom pane", "Ctrl+Shift+Enter"],
  ["Insert newline", "Shift+Enter"],
  ["Open/focus Lmux", "lmux"],
];

const TERMS = [
  ["Workspace", "A saved working area or project. It contains panes."],
  ["Pane", "A visible split region inside a workspace."],
  ["Tab", "A tab inside a pane, usually terminal or browser."],
  ["Terminal", "A tab running a shell or agent command."],
  ["Browser", "A browser tab inside a pane."],
  ["Agent", "A configured command preset, like Shell, Codex, Claude, Gemini, or Aider."],
  ["Session", "The running process behind a terminal tab. Mostly internal/debug wording."],
];

export default function TabBar({ uiVariant = "default", onCloseWorkspace }: TabBarProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const workspaces = useWorkspaceListStore((s) => s.workspaces);
  const activeId = useWorkspaceListStore((s) => s.activeWorkspaceId);
  const setActive = useWorkspaceListStore((s) => s.setActiveWorkspace);
  const paneMetadata = usePaneMetadataStore((s) => s.metadata);

  return (
    <div
      data-tauri-drag-region
      style={{
        width: SIDEBAR_WIDTH,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: uiVariant === "cmux" ? "#151515" : "var(--cmux-sidebar)",
        borderRight: "1px solid var(--cmux-border)",
        flexShrink: 0,
        overflowY: "auto",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      <div style={{ flex: 1 }}>
        {workspaces.map((ws) => {
          let totalWsNotifications = 0;
          let lastLog: string | undefined;
          const statusCounts = { working: 0, waiting: 0, done: 0 };
          for (const pane of ws.panes) {
            // Use active tab's sessionId for metadata lookup (tabs have the agent status)
            const activeTabSessionId = pane.tabs.find((t) => t.id === pane.activeTabId)?.sessionId;
            const m = activeTabSessionId ? paneMetadata[activeTabSessionId] : undefined;
            if (m) {
              totalWsNotifications += m.notificationCount ?? 0;
              if (m.lastLogLine) lastLog = m.lastLogLine;
              if (m.agentStatus && m.agentStatus !== "idle") {
                statusCounts[m.agentStatus as keyof typeof statusCounts]++;
              }
            }
          }
          const firstActiveTabSessionId = ws.panes[0]?.tabs.find((t) => t.id === ws.panes[0]?.activeTabId)?.sessionId;
          const firstPaneMeta = firstActiveTabSessionId ? paneMetadata[firstActiveTabSessionId] : undefined;
          return (
            <TabItem
              key={ws.id}
              uiVariant={uiVariant}
              name={ws.name}
              color={ws.color}
              paneCount={ws.panes.length}
              cwd={firstPaneMeta?.cwd}
              gitBranch={firstPaneMeta?.gitBranch}
              notificationCount={totalWsNotifications || undefined}
              lastLogLine={lastLog}
              statusCounts={statusCounts}
              active={ws.id === activeId}
              onClick={() => setActive(ws.id)}
              onClose={() => onCloseWorkspace(ws.id)}
            />
          );
        })}
      </div>

      <button
        onClick={() => setHelpOpen(true)}
        title="Lmux help"
        style={{
          width: 13,
          height: 13,
          margin: "0 0 8px 14px",
          borderRadius: "50%",
          border: "1px solid var(--cmux-text-tertiary)",
          background: "transparent",
          color: "var(--cmux-text-tertiary)",
          cursor: "pointer",
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          padding: 0,
          opacity: 0.8,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--cmux-accent)";
          e.currentTarget.style.color = "var(--cmux-accent)";
          e.currentTarget.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--cmux-text-tertiary)";
          e.currentTarget.style.color = "var(--cmux-text-tertiary)";
          e.currentTarget.style.opacity = "0.8";
        }}
      >
        ?
      </button>

      {helpOpen && (
        <div
          onClick={() => setHelpOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0, 0, 0, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, calc(100vw - 48px))",
              maxHeight: "min(620px, calc(100vh - 48px))",
              overflow: "auto",
              background: "#000000",
              border: "1px solid var(--cmux-accent)",
              borderRadius: 8,
              boxShadow: "0 0 24px rgba(0, 255, 65, 0.22)",
              color: "var(--cmux-text)",
              padding: 18,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--cmux-accent)" }}>
                Lmux Commands
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  border: "1px solid var(--cmux-border)",
                  background: "#000000",
                  color: "var(--cmux-text-secondary)",
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                x
              </button>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
              {HELP_ROWS.map(([label, shortcut]) => (
                <div
                  key={label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center",
                    borderBottom: "1px solid rgba(0, 255, 65, 0.16)",
                    paddingBottom: 8,
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--cmux-text)" }}>{label}</span>
                  <code
                    style={{
                      color: "var(--cmux-accent)",
                      background: "rgba(0, 255, 65, 0.08)",
                      border: "1px solid rgba(0, 255, 65, 0.18)",
                      borderRadius: 4,
                      padding: "3px 6px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortcut}
                  </code>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--cmux-accent)", marginBottom: 10 }}>
                Names
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {TERMS.map(([term, description]) => (
                  <div
                    key={term}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "104px 1fr",
                      gap: 12,
                      borderBottom: "1px solid rgba(0, 255, 65, 0.16)",
                      paddingBottom: 8,
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    <span style={{ color: "var(--cmux-accent)", fontWeight: 700 }}>{term}</span>
                    <span style={{ color: "var(--cmux-text-secondary)" }}>{description}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, color: "var(--cmux-text)", fontSize: 12 }}>
                Workspace {"->"} Pane {"->"} Tab {"->"} Terminal session or Browser view
              </div>
            </div>

            <div style={{ marginTop: 14, color: "var(--cmux-text-secondary)", fontSize: 11, lineHeight: 1.5 }}>
              New terminals open in `/home/gal/Desktop/business/projects/Yekar_OS`.
              Use the top `+` button or Ctrl+Shift+N for another workspace.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
