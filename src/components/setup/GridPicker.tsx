import type { GridTemplateId } from "../../types";
import { GRID_TEMPLATES } from "../../lib/gridTemplates";
import GridPreview from "./GridPreview";

interface GridPickerProps {
  selected: GridTemplateId;
  onSelect: (id: GridTemplateId) => void;
  minPaneCount?: number;
}

const DISPLAY_ORDER: GridTemplateId[] = [
  "1x1", "2x1", "1x2", "2x2", "3x2", "2x3", "3x3", "ceo", "4x4",
];

export default function GridPicker({ selected, onSelect, minPaneCount = 1 }: GridPickerProps) {
  const options = DISPLAY_ORDER.filter((id) => GRID_TEMPLATES[id].paneCount >= minPaneCount);

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: "#a3a3a3",
          marginBottom: 8,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        Layout
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((id) => (
          <GridPreview
            key={id}
            template={GRID_TEMPLATES[id]}
            selected={id === selected}
            onClick={() => onSelect(id)}
          />
        ))}
      </div>
    </div>
  );
}
