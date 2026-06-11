import { useCallback, useEffect, useMemo, useRef, memo } from "react";
import { Allotment, type AllotmentHandle } from "allotment";
import "allotment/dist/style.css";
import type { Pane, GridTemplateId, SplitLayoutNode } from "../../types";
import { useWorkspaceLayoutStore } from "../../stores/workspaceStore";
import TerminalPane from "./TerminalPane";
import { ErrorBoundary } from "../layout/ErrorBoundary";

interface TerminalGridProps {
  workspaceId: string;
  gridTemplateId: GridTemplateId;
  panes: Pane[];
  splitRows?: string[][];
  splitLayout?: SplitLayoutNode;
  isVisible?: boolean;
}

const CEO_GRID_CELLS = [
  { col: "1", row: "1" },
  { col: "2", row: "1 / span 2" },
  { col: "3", row: "1" },
  { col: "1", row: "2" },
  { col: "3", row: "2" },
  { col: "1", row: "3" },
  { col: "2", row: "3" },
  { col: "3", row: "3" },
  { col: "1", row: "4" },
  { col: "2", row: "4" },
  { col: "3", row: "4" },
];

function layoutSignature(node: SplitLayoutNode): string {
  if (node.type === "pane") return `pane:${node.paneId}`;
  return `${node.direction}(${node.children.map(layoutSignature).join(",")})`;
}

function layoutFromRows(rows: string[][]): SplitLayoutNode {
  const rowNodes: SplitLayoutNode[] = rows.map((row) => {
    const children: SplitLayoutNode[] = row.map((paneId) => ({ type: "pane", paneId }));
    return children.length === 1
      ? children[0]
      : { type: "split", direction: "horizontal", children };
  });

  return rowNodes.length === 1
    ? rowNodes[0]
    : { type: "split", direction: "vertical", children: rowNodes };
}

function SplitLayoutView({
  node,
  renderPane,
}: {
  node: SplitLayoutNode;
  renderPane: (paneId: string) => React.ReactNode;
}) {
  if (node.type === "pane") return renderPane(node.paneId);
  return <SplitNodeView node={node} renderPane={renderPane} />;
}

function SplitNodeView({
  node,
  renderPane,
}: {
  node: Extract<SplitLayoutNode, { type: "split" }>;
  renderPane: (paneId: string) => React.ReactNode;
}) {
  const allotmentRef = useRef<AllotmentHandle | null>(null);
  const signature = layoutSignature(node);

  useEffect(() => {
    allotmentRef.current?.reset();
  }, [signature]);

  return (
    <Allotment ref={allotmentRef} vertical={node.direction === "vertical"} separator={false}>
      {node.children.map((child, index) => {
        const key = layoutSignature(child);
        return (
          <Allotment.Pane key={key} preferredSize={node.sizes?.[index]}>
            <SplitLayoutView node={child} renderPane={renderPane} />
          </Allotment.Pane>
        );
      })}
    </Allotment>
  );
}

export default memo(function TerminalGrid({
  workspaceId,
  gridTemplateId,
  panes,
  splitRows,
  splitLayout,
  isVisible = true,
}: TerminalGridProps) {
  const removePaneFromWorkspace = useWorkspaceLayoutStore((s) => s.removePaneFromWorkspace);
  const addPaneToWorkspace = useWorkspaceLayoutStore((s) => s.addPaneToWorkspace);

  const handleClose = useCallback((paneId: string) => {
    removePaneFromWorkspace(workspaceId, paneId);
  }, [workspaceId, removePaneFromWorkspace]);

  const handleSplitRight = useCallback((paneId: string) => {
    addPaneToWorkspace(workspaceId, paneId, "right");
  }, [workspaceId, addPaneToWorkspace]);

  const handleSplitDown = useCallback((paneId: string) => {
    addPaneToWorkspace(workspaceId, paneId, "down");
  }, [workspaceId, addPaneToWorkspace]);

  const paneMap = useMemo(() => Object.fromEntries(panes.map((p) => [p.id, p])), [panes]);

  const renderPane = useCallback((paneId: string) => {
    const pane = paneMap[paneId];
    if (!pane) return null;

    return (
      <ErrorBoundary>
        <TerminalPane
          pane={pane}
          workspaceId={workspaceId}
          isWorkspaceVisible={isVisible}
          onClose={() => handleClose(pane.id)}
          onSplitRight={() => handleSplitRight(pane.id)}
          onSplitDown={() => handleSplitDown(pane.id)}
        />
      </ErrorBoundary>
    );
  }, [handleClose, handleSplitDown, handleSplitRight, isVisible, paneMap, workspaceId]);

  const renderLayout = useCallback((node: SplitLayoutNode): React.ReactNode => {
    return <SplitLayoutView node={node} renderPane={renderPane} />;
  }, [renderPane]);

  if (gridTemplateId === "ceo" && panes.length >= CEO_GRID_CELLS.length) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gridTemplateRows: "repeat(4, minmax(0, 1fr))",
          gap: 1,
          background: "var(--cmux-border)",
          overflow: "hidden",
        }}
      >
        {CEO_GRID_CELLS.map((cell, index) => {
          const pane = panes[index];
          if (!pane) return null;
          return (
            <div
              key={pane.id}
              style={{
                minWidth: 0,
                minHeight: 0,
                gridColumn: cell.col,
                gridRow: cell.row,
                overflow: "hidden",
              }}
            >
              {renderPane(pane.id)}
            </div>
          );
        })}
      </div>
    );
  }

  if (splitLayout) {
    return renderLayout(splitLayout);
  }

  if (splitRows) {
    return renderLayout(layoutFromRows(splitRows));
  }

  // Fallback: no splitRows (should not happen with current store logic)
  // Render a flat horizontal layout
  return renderLayout(layoutFromRows([panes.map((p) => p.id)]));
});
