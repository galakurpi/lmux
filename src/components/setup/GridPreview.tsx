import type { GridTemplate } from "../../types";

interface GridPreviewProps {
  template: GridTemplate;
  selected: boolean;
  onClick: () => void;
}

type PreviewCell = { x: number; y: number; w: number; h: number; label?: string };

export default function GridPreview({ template, selected, onClick }: GridPreviewProps) {
  const size = 56;
  const gap = 2;
  const cellW = (size - gap * (template.cols - 1)) / template.cols;
  const cellH = (size - gap * (template.rows - 1)) / template.rows;

  const cells: PreviewCell[] = template.previewCells
    ? template.previewCells.map((cell) => ({
        ...cell,
        x: (cell.x / 100) * size,
        y: (cell.y / 100) * size,
        w: (cell.w / 100) * size,
        h: (cell.h / 100) * size,
      }))
    : (() => {
      const gridCells: PreviewCell[] = [];
      for (let r = 0; r < template.rows; r++) {
        for (let c = 0; c < template.cols; c++) {
          gridCells.push({
            x: c * (cellW + gap),
            y: r * (cellH + gap),
            w: cellW,
            h: cellH,
          });
        }
      }
      return gridCells;
    })();

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: 8,
        background: selected ? "rgba(0, 255, 65, 0.12)" : "var(--cmux-bg)",
        border: selected ? "1px solid #00ff41" : "1px solid rgba(0, 255, 65, 0.18)",
        borderRadius: 6,
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
    >
      <svg width={size} height={size}>
        {cells.map((cell, i) => (
          <g key={i}>
            <rect
              x={cell.x}
              y={cell.y}
              width={cell.w}
              height={cell.h}
              rx={2}
              fill={selected ? "#00ff41" : "#0d5c22"}
              opacity={selected ? 0.6 : 0.4}
            />
            {cell.label && (
              <text
                x={cell.x + cell.w / 2}
                y={cell.y + cell.h / 2 + 3}
                textAnchor="middle"
                fontSize="7"
                fontFamily="JetBrains Mono, monospace"
                fontWeight="700"
                fill={selected ? "#001a07" : "#00ff41"}
              >
                {cell.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <span
        style={{
          fontSize: 10,
          color: selected ? "#00ff41" : "#007a24",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {template.label}
      </span>
    </button>
  );
}
