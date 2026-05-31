import type { GridTemplate } from "../../types";

interface GridPreviewProps {
  template: GridTemplate;
  selected: boolean;
  onClick: () => void;
}

export default function GridPreview({ template, selected, onClick }: GridPreviewProps) {
  const size = 56;
  const gap = 2;
  const cellW = (size - gap * (template.cols - 1)) / template.cols;
  const cellH = (size - gap * (template.rows - 1)) / template.rows;

  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < template.rows; r++) {
    for (let c = 0; c < template.cols; c++) {
      cells.push({
        x: c * (cellW + gap),
        y: r * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
  }

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
          <rect
            key={i}
            x={cell.x}
            y={cell.y}
            width={cell.w}
            height={cell.h}
            rx={2}
            fill={selected ? "#00ff41" : "#0d5c22"}
            opacity={selected ? 0.6 : 0.4}
          />
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
