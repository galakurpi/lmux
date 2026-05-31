import { memo, useEffect, useRef, useState } from "react";
import type { Pane, PaneTab } from "../../types";
import { getAgent, getDefaultAgent } from "../../lib/agents";
import { usePaneMetadataStore } from "../../stores/workspaceStore";
import type { AgentStatus } from "../../stores/paneMetadataStoreCompat";
import { LABEL_COLOR_OPTIONS } from "../../lib/colors";

interface PaneTabBarProps {
  pane: Pane;
  workspaceId: string;
  hasNotification?: boolean;
  onClose?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onAddTab?: (agentId?: string, type?: PaneTab["type"]) => void;
  onRemoveTab?: (tabId: string) => void;
  onSelectTab?: (tabId: string) => void;
  onRenamePane?: (label: string) => void;
  onPaneColorChange?: (color: string) => void;
}

const FolderIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
);

const SplitRightIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="12" y1="3" x2="12" y2="21"></line>
    <line x1="12" y1="12" x2="21" y2="12"></line>
  </svg>
);

const SplitDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="12" y1="12" x2="12" y2="21"></line>
  </svg>
);

const CloseIcon = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

const GlobeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
  </svg>
);

const STATUS_CONFIG: Record<AgentStatus, { color: string; title: string; pulse: boolean }> = {
  working: { color: "var(--status-working)", title: "Working",           pulse: true  },
  waiting: { color: "var(--status-waiting)", title: "Waiting for input", pulse: false },
  done:    { color: "var(--status-done)",    title: "Done",              pulse: false },
  idle:    { color: "transparent",           title: "",                  pulse: false },
};

const AGENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  "gemini":      "Gemini",
  "codex":       "Codex",
  "aider":       "Aider",
  "shell":       "Shell",
};

function AgentStatusDot({ status }: { status: AgentStatus }) {
  const cfg = STATUS_CONFIG[status];
  if (status === "idle" || !cfg) return null;
  return (
    <span
      title={cfg.title}
      style={{
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: cfg.color,
        flexShrink: 0,
        boxShadow: cfg.pulse ? `0 0 4px ${cfg.color}` : "none",
        animation: cfg.pulse ? "agentPulse 1.2s ease-in-out infinite" : "none",
      }}
    />
  );
}

export default memo(function PaneTabBar({
  pane,
  hasNotification,
  onClose,
  onSplitRight,
  onSplitDown,
  onAddTab,
  onRemoveTab,
  onSelectTab,
  onRenamePane,
  onPaneColorChange,
}: PaneTabBarProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState(pane.label ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const allMetadata = usePaneMetadataStore((s) => s.metadata);

  // Derive active tab's agent status for the status bar
  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
  const activeMeta = activeTab ? allMetadata[activeTab.sessionId] : undefined;
  const activeStatus: AgentStatus = activeMeta?.agentStatus ?? "idle";
  const activeLastLog = activeMeta?.lastLogLine;
  const activeAgentLabel = activeTab
    ? (AGENT_LABELS[activeTab.agentId ?? ""] ?? getAgent(activeTab.agentId)?.name ?? "Shell")
    : "Shell";
  const showStatusBar = activeStatus !== "idle" && activeTab?.type !== "browser";
  const statusCfg = STATUS_CONFIG[activeStatus];

  useEffect(() => {
    if (!isRenaming) setDraftLabel(pane.label ?? "");
  }, [isRenaming, pane.label]);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [contextMenu]);

  const commitRename = () => {
    onRenamePane?.(draftLabel);
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setDraftLabel(pane.label ?? "");
    setIsRenaming(false);
  };

  return (
    <div
      className="pane-tabbar"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--cmux-surface)",
        borderBottom: hasNotification
          ? "1px solid rgba(255, 59, 48, 0.5)"
          : "1px solid var(--cmux-border)",
        flexShrink: 0,
        userSelect: "none",
        position: "relative",
        overflow: "visible",
        zIndex: 10,
      }}
    >
      {/* Agent status bar — shown above tabs when an agent is active */}
      {showStatusBar && (
        <div
          style={{
            height: 22,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 10px",
            borderBottom: `1px solid ${statusCfg.color}22`,
            background: `${statusCfg.color}0d`,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusCfg.color,
              flexShrink: 0,
              boxShadow: statusCfg.pulse ? `0 0 5px ${statusCfg.color}` : "none",
              animation: statusCfg.pulse ? "agentPulse 1.2s ease-in-out infinite" : "none",
            }}
          />
          <span style={{ fontSize: 11, color: statusCfg.color, fontWeight: 600, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {statusCfg.title}
          </span>
          <span style={{ fontSize: 11, color: "var(--cmux-text-tertiary)", flexShrink: 0 }}>
            {activeAgentLabel}
          </span>
          {activeLastLog && (
            <>
              <span style={{ fontSize: 11, color: "var(--cmux-text-tertiary)", flexShrink: 0 }}>—</span>
              <span style={{ fontSize: 11, color: "var(--cmux-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {activeLastLog}
              </span>
            </>
          )}
        </div>
      )}

      {/* Tab pills row */}
      <div style={{ height: 36, display: "flex", alignItems: "center" }}>
      {(pane.label || pane.color || isRenaming) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 36,
            padding: "0 8px",
            borderRight: "1px solid var(--cmux-border)",
            flexShrink: 0,
            maxWidth: 170,
          }}
        >
          {pane.color && (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: pane.color,
                flexShrink: 0,
              }}
            />
          )}
          {isRenaming ? (
            <input
              ref={inputRef}
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              style={{
                width: 118,
                minWidth: 80,
                background: "var(--cmux-bg)",
                border: "1px solid var(--cmux-accent)",
                borderRadius: 4,
                color: "var(--cmux-text)",
                font: "12px 'JetBrains Mono', 'Geist Mono', monospace",
                lineHeight: 1.2,
                padding: "2px 5px",
                outline: "none",
              }}
            />
          ) : pane.label ? (
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--cmux-text)",
                font: "12px 'JetBrains Mono', 'Geist Mono', monospace",
                fontWeight: 600,
              }}
            >
              {pane.label}
            </span>
          ) : null}
        </div>
      )}
      {/* Tab pills — overflow:hidden here to clip tab text, not the dropdown */}
      <div style={{ display: "flex", alignItems: "center", flex: 1, overflow: "hidden", minWidth: 0 }}>
        {pane.tabs.map((tab) => {
          const agent = getAgent(tab.agentId) ?? getDefaultAgent();
          const isActive = tab.id === pane.activeTabId;
          const tabMeta = allMetadata[tab.sessionId];
          const tabProcessTitle = tabMeta?.processTitle;
          const tabCwd = tabMeta?.cwd;
          const agentStatus = tabMeta?.agentStatus ?? "idle";
          const label = tab.label
            ?? (tab.type === "browser"
              ? "Browser"
              : tabProcessTitle
                ? tabProcessTitle
                : (isActive && tabCwd ? tabCwd.split("/").pop() || agent.name : agent.name));

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab?.(tab.id)}
              title={label}
              className={`pane-tab-pill ${isActive ? "is-active" : ""}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0 8px 0 7px",
                height: 36,
                maxWidth: 160,
                cursor: "pointer",
                background: isActive ? "rgba(255,255,255,0.06)" : "transparent",
                borderRight: "1px solid var(--cmux-border)",
                borderBottom: isActive ? `2px solid var(--cmux-accent)` : "2px solid transparent",
                flexShrink: 0,
                transition: "background 0.1s",
              }}
            >
              {/* notification dot */}
              {hasNotification && isActive && (
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ff3b30", flexShrink: 0 }} />
              )}
              {/* agent status badge (only on terminal tabs) */}
              {tab.type !== "browser" && <AgentStatusDot status={agentStatus} />}
              {/* folder icon */}
              <span style={{ color: isActive ? "var(--cmux-accent)" : "var(--cmux-text-tertiary)", flexShrink: 0 }}>
                <FolderIcon />
              </span>
              {/* label */}
              <span
                className="pane-tab-label"
                style={{
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Geist Mono', monospace",
                  color: isActive ? "var(--cmux-text)" : "var(--cmux-text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {label}
              </span>
              {/* close tab button */}
              {pane.tabs.length > 1 && (
                <button
                  className="pane-action-btn"
                  onClick={(e) => { e.stopPropagation(); onRemoveTab?.(tab.id); }}
                  title="Close tab"
                  style={{ padding: 2, flexShrink: 0 }}
                >
                  <CloseIcon size={9} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add terminal tab — direct, no dropdown */}
      <button
        className="pane-action-btn"
        onClick={() => onAddTab?.(getDefaultAgent().id, "terminal")}
        title="New terminal tab"
        style={{ margin: "0 1px", padding: "3px 5px", flexShrink: 0 }}
      >
        <PlusIcon />
      </button>
      {/* Add browser tab */}
      <button
        className="pane-action-btn"
        onClick={() => onAddTab?.(undefined, "browser")}
        title="New browser tab"
        style={{ margin: "0 2px", padding: "3px 5px", flexShrink: 0 }}
      >
        <GlobeIcon />
      </button>

      {/* Right: split + close pane buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, paddingRight: 6, flexShrink: 0 }}>
        {onSplitRight && (
          <button className="pane-action-btn" onClick={onSplitRight} title="Split right">
            <SplitRightIcon />
          </button>
        )}
        {onSplitDown && (
          <button className="pane-action-btn" onClick={onSplitDown} title="Split down">
            <SplitDownIcon />
          </button>
        )}
        {onClose && (
          <button className="pane-action-btn" onClick={onClose} title="Close pane">
            <CloseIcon size={11} />
          </button>
        )}
      </div>
      </div>{/* end tab pills row */}

      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 300,
            minWidth: 154,
            padding: 6,
            border: "1px solid var(--cmux-border)",
            borderRadius: 6,
            background: "var(--cmux-bg)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.42)",
            color: "var(--cmux-text)",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <button
            onClick={() => {
              setContextMenu(null);
              setDraftLabel(pane.label ?? "");
              setIsRenaming(true);
            }}
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              color: "var(--cmux-text)",
              cursor: "pointer",
              textAlign: "left",
              padding: "6px 8px",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Rename
          </button>
          <div style={{ padding: "6px 8px 4px", color: "var(--cmux-text-tertiary)", fontSize: 11 }}>
            Color
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 5, padding: "0 8px 6px" }}>
            {LABEL_COLOR_OPTIONS.map((option) => (
              <button
                key={option}
                title={option}
                onClick={() => {
                  onPaneColorChange?.(option);
                  setContextMenu(null);
                }}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: option === pane.color ? "2px solid #ffffff" : "1px solid var(--cmux-border)",
                  background: option,
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
