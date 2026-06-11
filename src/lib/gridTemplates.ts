import type { GridTemplate, GridTemplateId } from "../types";

export const GRID_TEMPLATES: Record<GridTemplateId, GridTemplate> = {
  "1x1": { id: "1x1", label: "Single", rows: 1, cols: 1, paneCount: 1 },
  "2x1": { id: "2x1", label: "2 Columns", rows: 1, cols: 2, paneCount: 2 },
  "1x2": { id: "1x2", label: "2 Rows", rows: 2, cols: 1, paneCount: 2 },
  "2x2": { id: "2x2", label: "2x2 Grid", rows: 2, cols: 2, paneCount: 4 },
  "3x2": { id: "3x2", label: "3x2 Grid", rows: 2, cols: 3, paneCount: 6 },
  "2x3": { id: "2x3", label: "2x3 Grid", rows: 3, cols: 2, paneCount: 6 },
  "3x3": { id: "3x3", label: "3x3 Grid", rows: 3, cols: 3, paneCount: 9 },
  "4x4": { id: "4x4", label: "4x4 Grid", rows: 4, cols: 4, paneCount: 16 },
  "ceo": {
    id: "ceo",
    label: "CEO",
    rows: 4,
    cols: 3,
    paneCount: 11,
    previewCells: [
      { x: 0, y: 0, w: 32.8, h: 25.5 },
      { x: 33.6, y: 0, w: 32.8, h: 51.5, label: "CEO" },
      { x: 67.2, y: 0, w: 32.8, h: 25.5 },
      { x: 0, y: 26.5, w: 32.8, h: 25.5 },
      { x: 67.2, y: 26.5, w: 32.8, h: 25.5 },
      { x: 0, y: 53, w: 32.8, h: 22.5 },
      { x: 33.6, y: 53, w: 32.8, h: 22.5 },
      { x: 67.2, y: 53, w: 32.8, h: 22.5 },
      { x: 0, y: 76.5, w: 32.8, h: 23.5 },
      { x: 33.6, y: 76.5, w: 32.8, h: 23.5 },
      { x: 67.2, y: 76.5, w: 32.8, h: 23.5 },
    ],
  },
};

export function getGridTemplate(id: GridTemplateId): GridTemplate {
  return GRID_TEMPLATES[id];
}
