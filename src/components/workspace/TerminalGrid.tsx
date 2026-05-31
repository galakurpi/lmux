import { useCallback, useMemo, memo } from "react";
import { Allotment } from "allotment";
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
}

export default memo(function TerminalGrid({
  workspaceId,
  panes,
  splitRows,
  splitLayout,
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
          onClose={() => handleClose(pane.id)}
          onSplitRight={() => handleSplitRight(pane.id)}
          onSplitDown={() => handleSplitDown(pane.id)}
        />
      </ErrorBoundary>
    );
  }, [handleClose, handleSplitDown, handleSplitRight, paneMap, workspaceId]);

  const renderLayout = useCallback((node: SplitLayoutNode): React.ReactNode => {
    if (node.type === "pane") return renderPane(node.paneId);

    return (
      <Allotment vertical={node.direction === "vertical"} separator={false}>
        {node.children.map((child) => {
          const key = child.type === "pane" ? child.paneId : `${child.direction}-${child.children.map((c) => c.type === "pane" ? c.paneId : c.direction).join("-")}`;
          return (
            <Allotment.Pane key={key}>
              {renderLayout(child)}
            </Allotment.Pane>
          );
        })}
      </Allotment>
    );
  }, [renderPane]);

  if (splitLayout) {
    return renderLayout(splitLayout);
  }

  if (splitRows) {
    const rows: string[][] = splitRows ?? [panes.map((p) => p.id)];
    return (
      <Allotment vertical separator={false}>
        {rows.map((row, rowIdx) => (
          <Allotment.Pane key={row[0] ?? rowIdx}>
            <Allotment separator={false}>
              {row.map((paneId) => {
                const pane = paneMap[paneId];
                if (!pane) return null;
                return (
                  <Allotment.Pane key={pane.id}>
                    <ErrorBoundary>
                    <TerminalPane
                      pane={pane}
                      workspaceId={workspaceId}
                      onClose={() => handleClose(pane.id)}
                      onSplitRight={() => handleSplitRight(pane.id)}
                      onSplitDown={() => handleSplitDown(pane.id)}
                    />
                    </ErrorBoundary>
                  </Allotment.Pane>
                );
              })}
            </Allotment>
          </Allotment.Pane>
        ))}
      </Allotment>
    );
  }

  // Fallback: no splitRows (should not happen with current store logic)
  // Render a flat horizontal layout
  return (
    <Allotment vertical separator={false}>
      <Allotment.Pane>
        <Allotment separator={false}>
          {panes.map((pane) => (
            <Allotment.Pane key={pane.id}>
              <ErrorBoundary>
                <TerminalPane
                  pane={pane}
                  workspaceId={workspaceId}
                  onClose={() => handleClose(pane.id)}
                  onSplitRight={() => handleSplitRight(pane.id)}
                  onSplitDown={() => handleSplitDown(pane.id)}
                />
              </ErrorBoundary>
            </Allotment.Pane>
          ))}
        </Allotment>
      </Allotment.Pane>
    </Allotment>
  );
});
