import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Pane, PaneTab, GridTemplateId, SplitLayoutNode } from "../types";
import { getGridTemplate } from "../lib/gridTemplates";
import { getDefaultAgent } from "../lib/agents";
import { makeSessionId } from "../lib/constants";
import { renameAgentSessionForTerminal } from "../lib/ipc";
import { usePaneFontStore } from "./paneFontStore";
import { useWorkspaceListStore } from "./workspaceListStore";

/**
 * Workspace Layout Store - Manages panes within workspaces
 * Handles pane CRUD and layout (splitRows)
 */

function makeTab(workspaceId: string, paneId: string, agentId: string, type: PaneTab["type"] = "terminal"): PaneTab {
  const tabId = uuid();
  return {
    id: tabId,
    sessionId: makeSessionId(workspaceId, `${paneId}-${tabId}`),
    agentId,
    type,
  };
}

function makePane(
  workspaceId: string,
  agentId: string,
  label?: string,
  color?: string,
): Pane {
  const paneId = uuid();
  const tab = makeTab(workspaceId, paneId, agentId);
  return {
    id: paneId,
    agentId,
    sessionId: tab.sessionId,
    tabs: [tab],
    activeTabId: tab.id,
    ...(label ? { label } : {}),
    ...(color ? { color } : {}),
  };
}

function sessionRenameLabel(label: string): string {
  return label.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

interface RenameAgentSessionAttempt {
  sessionId: string;
  renamed: boolean;
  agent?: string;
  thread_id?: string;
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function renameAgentSessionsInPane(pane: Pane, label: string): Promise<RenameAgentSessionAttempt[]> {
  const sessionLabel = sessionRenameLabel(label);
  if (!sessionLabel) return Promise.resolve([]);

  return Promise.all(
    pane.tabs
      .filter((tab) => tab.type !== "browser")
      .map(async (tab) => {
        try {
          const result = await renameAgentSessionForTerminal(tab.sessionId, sessionLabel);
          return { sessionId: tab.sessionId, ...result };
        } catch (err) {
          console.warn("Failed to rename agent session", err);
          return { sessionId: tab.sessionId, renamed: false, error: errorMessage(err) };
        }
      }),
  );
}

function noAgentRenameAttempts(): Promise<RenameAgentSessionAttempt[]> {
  return Promise.resolve([]);
}

interface BuildPanesResult {
  panes: Pane[];
  splitRows: string[][];
  splitLayout: SplitLayoutNode;
}

function paneNode(paneId: string): SplitLayoutNode {
  return { type: "pane", paneId };
}

function splitNode(
  direction: "horizontal" | "vertical",
  children: SplitLayoutNode[],
  sizes?: number[],
): SplitLayoutNode {
  const compactChildren = children.filter(Boolean);
  if (compactChildren.length === 1) return compactChildren[0];
  return { type: "split", direction, children: compactChildren, ...(sizes ? { sizes } : {}) };
}

function layoutFromRows(rows: string[][]): SplitLayoutNode {
  const rowNodes = rows.map((row) => splitNode("horizontal", row.map(paneNode)));
  return splitNode("vertical", rowNodes);
}

function rowsFromPaneIds(paneIds: string[], gridTemplateId: GridTemplateId): string[][] {
  const template = getGridTemplate(gridTemplateId);
  const cols = Math.max(1, template.cols);
  const rows: string[][] = [];

  for (let i = 0; i < paneIds.length; i += cols) {
    rows.push(paneIds.slice(i, i + cols));
  }

  return rows;
}

function ceoSplitLayoutFromPaneIds(paneIds: string[]): SplitLayoutNode {
  const leftColumn = splitNode("vertical", [
    paneNode(paneIds[0]),
    paneNode(paneIds[3]),
    paneNode(paneIds[5]),
    paneNode(paneIds[8]),
  ]);
  const centerColumn = splitNode("vertical", [
    paneNode(paneIds[1]),
    paneNode(paneIds[6]),
    paneNode(paneIds[9]),
  ]);
  const rightColumn = splitNode("vertical", [
    paneNode(paneIds[2]),
    paneNode(paneIds[4]),
    paneNode(paneIds[7]),
    paneNode(paneIds[10]),
  ]);
  return splitNode("horizontal", [leftColumn, centerColumn, rightColumn]);
}

function splitLayoutFromPaneIds(paneIds: string[], gridTemplateId: GridTemplateId): SplitLayoutNode {
  if (gridTemplateId === "ceo") {
    return ceoSplitLayoutFromPaneIds(paneIds);
  }
  return layoutFromRows(rowsFromPaneIds(paneIds, gridTemplateId));
}

function makeTemplatePane(workspaceId: string, gridTemplateId: GridTemplateId, index: number): Pane {
  if (gridTemplateId === "ceo") {
    return makePane(
      workspaceId,
      getDefaultAgent().id,
      index === 1 ? "CEO" : undefined,
      index === 1 ? "#00ff41" : "#007a24",
    );
  }
  return makePane(workspaceId, getDefaultAgent().id);
}

function insertIntoLayout(
  node: SplitLayoutNode,
  targetPaneId: string,
  newPaneId: string,
  direction: "horizontal" | "vertical",
): { node: SplitLayoutNode; inserted: boolean } {
  if (node.type === "pane") {
    if (node.paneId !== targetPaneId) return { node, inserted: false };
    return {
      node: splitNode(direction, [node, paneNode(newPaneId)]),
      inserted: true,
    };
  }

  const directIdx = node.children.findIndex(
    (child) => child.type === "pane" && child.paneId === targetPaneId,
  );
  if (directIdx !== -1 && node.direction === direction) {
    const children = [...node.children];
    children.splice(directIdx + 1, 0, paneNode(newPaneId));
    return { node: { ...node, children }, inserted: true };
  }

  let inserted = false;
  const children = node.children.map((child) => {
    if (inserted) return child;
    const result = insertIntoLayout(child, targetPaneId, newPaneId, direction);
    inserted = result.inserted;
    return result.node;
  });

  return { node: inserted ? { ...node, children } : node, inserted };
}

function removeFromLayout(
  node: SplitLayoutNode,
  paneId: string,
): { node: SplitLayoutNode | null; removed: boolean } {
  if (node.type === "pane") {
    return node.paneId === paneId
      ? { node: null, removed: true }
      : { node, removed: false };
  }

  let removed = false;
  const children: SplitLayoutNode[] = [];
  for (const child of node.children) {
    const result = removeFromLayout(child, paneId);
    removed ||= result.removed;
    if (result.node) children.push(result.node);
  }

  if (!removed) return { node, removed: false };
  if (children.length === 0) return { node: null, removed: true };
  if (children.length === 1) return { node: children[0], removed: true };
  return { node: { ...node, children }, removed: true };
}

function buildPanes(
  workspaceId: string,
  gridTemplateId: GridTemplateId,
  agentAssignments?: Record<number, string>,
): BuildPanesResult {
  if (gridTemplateId === "ceo") {
    return buildCeoPanes(workspaceId, agentAssignments);
  }

  const template = getGridTemplate(gridTemplateId);
  const defaultAgentId = getDefaultAgent().id;
  const assignedPaneIndexes = agentAssignments
    ? Object.keys(agentAssignments).map(Number)
    : [];
  const assignedPaneCount = assignedPaneIndexes.length > 0
    ? Math.max(...assignedPaneIndexes) + 1
    : 0;
  const paneCount = Math.max(template.paneCount, assignedPaneCount);
  const panes: Pane[] = [];
  const splitRows: string[][] = [];

  let paneIndex = 0;
  while (paneIndex < paneCount) {
    const row: string[] = [];
    for (let c = 0; c < template.cols; c++) {
      if (paneIndex < paneCount) {
        const agentId = agentAssignments?.[paneIndex] ?? defaultAgentId;
        const pane = makePane(workspaceId, agentId);
        panes.push(pane);
        row.push(pane.id);
        paneIndex++;
      }
    }
    if (row.length > 0) {
      splitRows.push(row);
    }
  }

  return { panes, splitRows, splitLayout: layoutFromRows(splitRows) };
}

function buildCeoPanes(
  workspaceId: string,
  agentAssignments?: Record<number, string>,
): BuildPanesResult {
  const defaultAgentId = getDefaultAgent().id;
  const panes = Array.from({ length: 11 }, (_, index) =>
    makePane(
      workspaceId,
      agentAssignments?.[index] ?? defaultAgentId,
      index === 1 ? "CEO" : undefined,
      index === 1 ? "#00ff41" : "#007a24",
    )
  );
  const splitRows = [
    [panes[0].id, panes[1].id, panes[2].id],
    [panes[3].id, panes[4].id],
    [panes[5].id, panes[6].id, panes[7].id],
    [panes[8].id, panes[9].id, panes[10].id],
  ];

  const splitLayout = ceoSplitLayoutFromPaneIds(panes.map((pane) => pane.id));

  return { panes, splitRows, splitLayout };
}

interface WorkspaceLayoutState {
  // Pane operations
  removePaneFromWorkspace: (workspaceId: string, paneId: string) => void;
  renamePane: (workspaceId: string, paneId: string, label: string) => Promise<RenameAgentSessionAttempt[]>;
  setPaneColor: (workspaceId: string, paneId: string, color: string) => void;
  addPaneToWorkspace: (
    workspaceId: string,
    afterPaneId: string,
    direction: "right" | "down",
    agentId?: string
  ) => void;
  changeWorkspaceLayout: (workspaceId: string, gridTemplateId: GridTemplateId) => void;
  
  // Tab operations
  addTabToPane: (workspaceId: string, paneId: string, agentId?: string, type?: PaneTab["type"]) => PaneTab | undefined;
  removeTabFromPane: (workspaceId: string, paneId: string, tabId: string) => void;
  setActivePaneTab: (workspaceId: string, paneId: string, tabId: string) => void;
  
  // Helper to build initial panes for new workspace
  buildInitialPanes: (
    workspaceId: string,
    gridTemplateId: GridTemplateId,
    agentAssignments?: Record<number, string>
  ) => BuildPanesResult;
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>(() => ({
  buildInitialPanes: (workspaceId, gridTemplateId, agentAssignments) => {
    return buildPanes(workspaceId, gridTemplateId, agentAssignments);
  },

  changeWorkspaceLayout: (workspaceId, gridTemplateId) => {
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return;

    const template = getGridTemplate(gridTemplateId);
    if (template.paneCount < workspace.panes.length) return;

    const panes = [...workspace.panes];
    for (let index = panes.length; index < template.paneCount; index++) {
      panes.push(makeTemplatePane(workspaceId, gridTemplateId, index));
    }

    const paneIds = panes.map((p) => p.id);
    const splitRows = rowsFromPaneIds(paneIds, gridTemplateId);
    const splitLayout = splitLayoutFromPaneIds(paneIds, gridTemplateId);
    useWorkspaceListStore.getState().setWorkspaceLayout(
      workspaceId,
      gridTemplateId,
      panes,
      splitRows,
      splitLayout,
    );
  },

  removePaneFromWorkspace: (workspaceId, paneId) => {
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return;
    if (workspace.panes.length <= 1) return; // never remove last pane

    const removedPane = workspace.panes.find((p) => p.id === paneId);
    removedPane?.tabs.forEach((tab) => usePaneFontStore.getState().removeFontSize(tab.sessionId));
    const newPanes = workspace.panes.filter((p) => p.id !== paneId);
    
    // Update splitRows if present
    let newSplitRows = workspace.splitRows;
    if (newSplitRows) {
      newSplitRows = newSplitRows
        .map((row) => row.filter((id) => id !== paneId))
        .filter((row) => row.length > 0);
    }
    const layout = workspace.splitLayout ?? layoutFromRows(workspace.splitRows ?? [workspace.panes.map((p) => p.id)]);
    const result = removeFromLayout(layout, paneId);
    const newSplitLayout = result.node ?? layoutFromRows([newPanes.map((p) => p.id)]);

    useWorkspaceListStore.getState()._updateWorkspacePanes(workspaceId, newPanes, newSplitRows, newSplitLayout);
  },

  renamePane: (workspaceId, paneId, label) => {
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return noAgentRenameAttempts();

    const trimmedLabel = label.trim();
    const renamedPane = workspace.panes.find((p) => p.id === paneId);
    const agentRenameAttempts = renamedPane
      ? renameAgentSessionsInPane(renamedPane, trimmedLabel)
      : noAgentRenameAttempts();

    const newPanes = workspace.panes.map((p) =>
      p.id === paneId ? { ...p, label: trimmedLabel || undefined } : p
    );

    useWorkspaceListStore.getState()._updateWorkspacePanes(workspaceId, newPanes);
    return agentRenameAttempts;
  },

  setPaneColor: (workspaceId, paneId, color) => {
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return;

    const newPanes = workspace.panes.map((p) =>
      p.id === paneId ? { ...p, color } : p
    );

    useWorkspaceListStore.getState()._updateWorkspacePanes(workspaceId, newPanes);
  },

  addPaneToWorkspace: (workspaceId, afterPaneId, direction, agentId) => {
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return;

    // Always use default agent for new split panes (unless explicitly specified)
    const agId = agentId ?? getDefaultAgent().id;
    const paneId = uuid();
    const tab = makeTab(workspaceId, paneId, agId);
    const newPane: Pane = {
      id: paneId,
      agentId: agId,
      sessionId: tab.sessionId,
      tabs: [tab],
      activeTabId: tab.id,
    };
    const sourcePane = workspace.panes.find((p) => p.id === afterPaneId);
    if (sourcePane) {
      usePaneFontStore.getState().copyFontSize(sourcePane.sessionId, newPane.sessionId);
      newPane.color = sourcePane.color;
    }
    const newPanes = [...workspace.panes, newPane];

    // Initialize splitRows if not present
    const existingRows: string[][] = workspace.splitRows ?? [workspace.panes.map((p) => p.id)];

    let newSplitRows: string[][];
    let newSplitLayout: SplitLayoutNode;
    if (direction === "right") {
      // Insert new pane ID after afterPaneId in its row
      newSplitRows = existingRows.map((row) => {
        const idx = row.indexOf(afterPaneId);
        if (idx === -1) return row;
        const newRow = [...row];
        newRow.splice(idx + 1, 0, paneId);
        return newRow;
      });
      const layout = workspace.splitLayout ?? layoutFromRows(existingRows);
      newSplitLayout = insertIntoLayout(layout, afterPaneId, paneId, "horizontal").node;
    } else {
      // direction === "down": insert new row after the row containing afterPaneId
      newSplitRows = [];
      for (const row of existingRows) {
        newSplitRows.push(row);
        if (row.includes(afterPaneId)) {
          newSplitRows.push([paneId]);
        }
      }
      const layout = workspace.splitLayout ?? layoutFromRows(existingRows);
      newSplitLayout = insertIntoLayout(layout, afterPaneId, paneId, "vertical").node;
    }

    useWorkspaceListStore.getState()._updateWorkspacePanes(workspaceId, newPanes, newSplitRows, newSplitLayout);
  },

  addTabToPane: (workspaceId, paneId, agentId, type = "terminal") => {
    const start = performance.now();
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return undefined;
    let createdTab: PaneTab | undefined;

    const newPanes = workspace.panes.map((p) => {
      if (p.id !== paneId) return p;
      const agId = agentId ?? p.agentId;
      const tab = makeTab(workspaceId, paneId, agId, type);
      createdTab = tab;
      usePaneFontStore.getState().copyFontSize(p.sessionId, tab.sessionId);
      return {
        ...p,
        tabs: [...p.tabs, tab],
        activeTabId: tab.id,
        sessionId: tab.sessionId,
      };
    });

    useWorkspaceListStore.getState()._updateWorkspacePanes(workspaceId, newPanes);
    console.log(`[PERF] Tab create (layout store): ${(performance.now() - start).toFixed(2)}ms`);
    return createdTab;
  },

  removeTabFromPane: (workspaceId, paneId, tabId) => {
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return;

    const newPanes = workspace.panes.flatMap((p) => {
      if (p.id !== paneId) return [p];
      const removedTab = p.tabs.find((t) => t.id === tabId);
      if (removedTab) {
        usePaneFontStore.getState().removeFontSize(removedTab.sessionId);
      }
      const remaining = p.tabs.filter((t) => t.id !== tabId);
      if (remaining.length === 0) return []; // remove pane if no tabs left
      const newActiveId = p.activeTabId === tabId ? remaining[remaining.length - 1].id : p.activeTabId;
      const activeTab = remaining.find((t) => t.id === newActiveId) ?? remaining[0];
      return [{ ...p, tabs: remaining, activeTabId: newActiveId, sessionId: activeTab.sessionId }];
    });

    useWorkspaceListStore.getState()._updateWorkspacePanes(workspaceId, newPanes);
  },

  setActivePaneTab: (workspaceId, paneId, tabId) => {
    const workspace = useWorkspaceListStore.getState().getWorkspace(workspaceId);
    if (!workspace) return;

    const newPanes = workspace.panes.map((p) => {
      if (p.id !== paneId) return p;
      const tab = p.tabs.find((t) => t.id === tabId);
      if (!tab) return p;
      return { ...p, activeTabId: tabId, sessionId: tab.sessionId };
    });

    useWorkspaceListStore.getState()._updateWorkspacePanes(workspaceId, newPanes);
  },
}));
