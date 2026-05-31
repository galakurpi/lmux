import { memo, useEffect, useRef, useState } from "react";

interface StatusCounts {
  working: number;
  waiting: number;
  done: number;
}

interface TabItemProps {
  uiVariant?: "default" | "cmux";
  name: string;
  color?: string;
  paneCount: number;
  cwd?: string;
  gitBranch?: string;
  notificationCount?: number;
  lastLogLine?: string;
  statusCounts?: StatusCounts;
  active: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

function StatusPip({ count, color, pulse }: { count: number; color: string; pulse?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        boxShadow: pulse ? `0 0 4px ${color}` : "none",
        animation: pulse ? "agentPulse 1.2s ease-in-out infinite" : "none",
      }} />
      {count > 1 && (
        <span style={{ fontSize: 10, color, fontWeight: 600, lineHeight: 1 }}>{count}</span>
      )}
    </span>
  );
}

export default memo(function TabItem({ uiVariant = "default", name, color, paneCount, cwd, gitBranch, notificationCount, lastLogLine, statusCounts, active, onClick, onClose, onRename }: TabItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasAgents = statusCounts && (statusCounts.working + statusCounts.waiting + statusCounts.done) > 0;

  useEffect(() => {
    if (!isRenaming) setDraftName(name);
  }, [isRenaming, name]);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const commitRename = () => {
    const trimmedName = draftName.trim();
    if (trimmedName && trimmedName !== name) {
      onRename(trimmedName);
    }
    setIsRenaming(false);
  };

  const cancelRename = () => {
    setDraftName(name);
    setIsRenaming(false);
  };

  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDraftName(name);
        setIsRenaming(true);
      }}
      className={uiVariant === "cmux" ? "cmux-workspace-item" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        cursor: "pointer",
        background: active ? "#000000" : "transparent",
        color: active ? "var(--cmux-text)" : "var(--cmux-text-secondary)",
        fontSize: "13px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        userSelect: "none",
        transition: "background 0.1s, color 0.1s, border-color 0.1s",
        border: active
          ? "1px solid var(--cmux-accent)"
          : "1px solid transparent",
        borderRadius: uiVariant === "cmux" ? "8px" : "6px",
        margin: "0 8px",
        marginTop: "4px"
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = uiVariant === "cmux" ? "#000000" : "rgba(255, 255, 255, 0.05)";
          e.currentTarget.style.color = "var(--cmux-text)";
          if (uiVariant === "cmux") e.currentTarget.style.borderColor = "rgba(0, 255, 65, 0.45)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--cmux-text-secondary)";
          if (uiVariant === "cmux") e.currentTarget.style.borderColor = "transparent";
        }
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, overflow: "hidden", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {color && (
            <div style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color,
              flexShrink: 0,
              opacity: active ? 1 : 0.7,
            }} />
          )}
          {notificationCount ? (
            <span style={{
              background: "#007aff",
              color: "white",
              fontSize: "9px",
              fontWeight: "bold",
              borderRadius: "50%",
              width: "14px",
              height: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0
            }}>
              {notificationCount}
            </span>
          ) : null}
          {isRenaming ? (
            <input
              ref={inputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
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
                minWidth: 0,
                width: "100%",
                flex: 1,
                background: "#000000",
                border: "1px solid var(--cmux-accent)",
                borderRadius: 4,
                color: "var(--cmux-text)",
                font: "inherit",
                fontWeight: active ? 600 : 500,
                lineHeight: 1.2,
                padding: "1px 4px",
                outline: "none",
              }}
            />
          ) : (
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: active ? 600 : 500,
              }}
            >
              {name}
            </span>
          )}
          {paneCount > 1 && (
            <span className="cmux-pill" style={{
              flexShrink: 0,
              background: active ? "rgba(0,255,65,0.12)" : "rgba(0,255,65,0.08)",
              color: active ? "var(--cmux-accent)" : "var(--cmux-text-secondary)"
            }}>
              {paneCount}
            </span>
          )}
        </div>
        {hasAgents && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
            {statusCounts!.working > 0 && <StatusPip count={statusCounts!.working} color="var(--status-working)" pulse />}
            {statusCounts!.waiting > 0 && <StatusPip count={statusCounts!.waiting} color="var(--status-waiting)" />}
            {statusCounts!.done > 0    && <StatusPip count={statusCounts!.done}    color="var(--status-done)" />}
          </div>
        )}
        {lastLogLine && (
          <span style={{
            fontSize: "12px",
            color: active ? "rgba(255,255,255,0.85)" : "var(--cmux-text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.2
          }}>
            {lastLogLine}
          </span>
        )}
        <span style={{
          fontSize: "11px",
          color: active ? "rgba(255,255,255,0.6)" : "var(--cmux-text-tertiary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          lineHeight: 1.2
        }}>
          {cwd ? cwd.replace(/^\/home\/[^\/]+/, '~') : 'Starting session...'}
          {gitBranch ? ` —  ${gitBranch}` : ''}
        </span>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{
          background: "none",
          border: "none",
          color: active ? "rgba(255,255,255,0.6)" : "var(--cmux-text-tertiary)",
          cursor: "pointer",
          fontSize: "12px",
          padding: "2px 4px",
          lineHeight: 1,
          flexShrink: 0,
          opacity: 0,
          transition: "opacity 0.1s, color 0.1s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = active ? "#ffffff" : "var(--cmux-text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = active ? "rgba(255,255,255,0.6)" : "var(--cmux-text-tertiary)";
        }}
        title="Close workspace"
        className="tab-close-btn"
      >
        ×
      </button>
    </div>
  );
});
