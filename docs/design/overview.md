# Design Overview

## Philosophy

lmux is a dark-first, keyboard-centric terminal workspace. The UI should feel like a native terminal emulator that happens to have workspace management — not a web app pretending to be one.

**Principles:**
- **Terminal first**: The terminal viewport gets maximum space; chrome is minimal
- **Dark by default**: All 9 shipped themes are dark; the default Matrix theme uses full black (`#000000`) with green accents
- **Keyboard native**: Every action reachable by keyboard; mouse is optional
- **Density over whitespace**: Compact headers (36px), tight spacing, monospace typography
- **Instant feel**: No loading spinners, no page transitions, no skeleton screens — just content

## Visual Identity

- **Window**: Custom title bar (no OS decorations), borderless
- **Layout**: Sidebar (200px, collapsible) + main content area
- **Split panes**: Allotment-based with 1px sash (invisible at rest, accent color on hover)
- **Color accent**: Theme-driven; default is Matrix green (`#00ff41`)
- **Typography**: System sans-serif for UI, user's terminal font for terminals

## Color Architecture

Two color layers per theme:

| Layer | Purpose | Example fields |
|-------|---------|----------------|
| `terminal` | xterm.js colors | background, foreground, cursor, 16 ANSI colors |
| `chrome` | UI wrapper colors | background, surface, border, text, textMuted, accent |

Chrome background is always darker than terminal background to create visual depth.

## Layout Anatomy

```
┌──────────────────────────────────────────────────┐
│ TitleBar (32px) — drag region, workspace name     │
├─────────┬────────────────────────────────────────┤
│ Sidebar │ PaneTabBar (36px) — tabs + split/close │
│ (200px) │ ────────────────────────────────────── │
│         │ Terminal content (flex: 1)              │
│ Tab     │                                         │
│ Tab     │ ──────────── 1px sash ──────────────── │
│ Tab     │                                         │
│         │ PaneTabBar                              │
│ + New   │ Terminal content                        │
├─────────┴────────────────────────────────────────┤
```
