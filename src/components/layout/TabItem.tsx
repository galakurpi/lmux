import { memo, useEffect, useRef, useState } from "react";
import { LABEL_COLOR_OPTIONS } from "../../lib/colors";

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
  onColorChange: (color: string) => void;
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

export default memo(function TabItem({ uiVariant = "default", name, color, paneCount, cwd, gitBranch, notificationCount, lastLogLine, statusCounts, active, onClick, onClose, onRename, onColorChange }: TabItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
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
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
      className={uiVariant === "cmux" ? "cmux-workspace-item" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        cursor: "pointer",
        background: active ? "var(--cmux-bg)" : "transparent",
        color: active ? "var(--cmux-text)" : "var(--cmux-text-secondary)",
        fontSize: "13px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        userSelect: "none",
        transition: "background 0.1s, color 0.1s, border-color 0.1s",
        border: active
          ? `1px solid ${color ?? "var(--cmux-accent)"}`
          : "1px solid transparent",
        borderRadius: uiVariant === "cmux" ? "8px" : "6px",
        margin: "0 8px",
        marginTop: "4px"
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = uiVariant === "cmux" ? "var(--cmux-bg)" : "rgba(255, 255, 255, 0.05)";
          e.currentTarget.style.color = "var(--cmux-text)";
          if (uiVariant === "cmux") e.currentTarget.style.borderColor = color ?? "rgba(0, 255, 65, 0.45)";
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
                background: "var(--cmux-bg)",
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
              setDraftName(name);
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
                  onColorChange(option);
                  setContextMenu(null);
                }}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: option === color ? "2px solid #ffffff" : "1px solid var(--cmux-border)",
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
