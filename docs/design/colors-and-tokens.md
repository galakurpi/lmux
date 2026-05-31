# Colors & Design Tokens

## CSS Custom Properties (`global.css`)

```css
:root {
  --cmux-bg: #000000;
  --cmux-sidebar: #000000;
  --cmux-accent: #00ff41;
  --cmux-border: rgba(0, 255, 65, 0.24);
  --cmux-text: #d7ffe1;
  --cmux-text-secondary: #00c853;
  --cmux-text-tertiary: #007a24;
}
```

Note: These are static fallback values. Theme-driven colors come from `ThemeDefinition.chrome.*` applied via inline styles.

## Opacity Scale

| Token | Opacity | Usage |
|-------|---------|-------|
| `--cmux-text` | 0.9 | Primary text, labels |
| `--cmux-text-secondary` | 0.6 | Inactive tabs, descriptions |
| `--cmux-text-tertiary` | 0.3 | Placeholders, disabled controls |
| `--cmux-border` | 0.1 | Borders, dividers |

## Semantic Color Usage

| Context | Color Source | Example |
|---------|-------------|---------|
| App background | `--cmux-bg` / `chrome.background` | `#000000` |
| Sidebar background | `--cmux-sidebar` | `#000000` |
| Pane header | `--cmux-surface` | PaneTabBar background |
| Active indicator | `--cmux-accent` | Tab underline, focus outline |
| Notification dot | `#ff3b30` (iOS red) | Pane notification badge |
| Hover states | `rgba(0, 255, 65, 0.1)` | Button/tab hover |
| Active tab bg | `rgba(0, 255, 65, 0.1)` | Selected tab in PaneTabBar |
| Pill background | `rgba(0, 255, 65, 0.16)` | `.cmux-pill` class |
| Focus outline | `rgba(0, 255, 65, 0.5)` | Active pane border |
| Flash border | `var(--cmux-accent)` | 3px solid on flash animation |

## Workspace Colors

6 rotating colors assigned to new workspaces:

```typescript
["#00ff41", "#00c853", "#39ff14", "#d7ff00", "#00ffaa", "#007a24"]
```

Cycle: workspace index `% 6`.

## xterm.js Hard-coded Overrides

```css
.xterm             { padding: 2px 4px 0; background: #000000; }
.xterm-viewport    { overflow-y: hidden !important; background: #000000 !important; }
.xterm-screen      { image-rendering: pixelated; background: #000000; }
```

These override xterm's defaults for sharper rendering in WebKitGTK (Tauri's Linux webview).
