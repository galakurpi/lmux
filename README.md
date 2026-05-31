# Cmux for Linux

`lmux` is a Linux-first, cmux-inspired terminal workspace specialized for
managing multiple AI coding agents side by side.

The goal is not to clone cmux line by line. Original cmux is a native macOS app
built on Swift, AppKit, and libghostty. `lmux` takes the more hackable Linux and
cross-platform route: Tauri, React, xterm.js, and Rust.

## Status

Early side project. It is usable as a development base, but not yet something to
trust as a daily driver without rough edges.

Current focus:

- reliable workspaces and split panes for parallel agent sessions
- solid terminal behavior through `portable-pty` and xterm.js
- agent status indicators for Claude Code, Codex, Gemini CLI, Aider, and shells
- browser panes for local app testing
- socket/CLI automation so agents can drive the workspace
- Linux packages first, with macOS and Windows kept possible

## Features

- **Agent workspaces**: organize AI coding agents by project or task
- **Split panes**: horizontal and vertical layouts with resizable dividers
- **Agent presets**: launch common CLI agents from pane setup
- **Status visualization**: highlight panes that are working, waiting, or done
- **Command palette**: keyboard-first access to common actions
- **Custom keybindings**: remap shortcuts from the app
- **Persistent layout**: restore saved workspace structure across launches
- **Browser pane**: open web pages beside terminals for app testing
- **Socket API**: local automation surface for scripts and agents

## Tech Stack

- **Desktop shell**: Tauri v2
- **Frontend**: React 19, TypeScript, Vite
- **Terminal**: xterm.js with WebGL renderer
- **Backend**: Rust
- **PTY**: portable-pty
- **Layout/state**: Allotment, Zustand, Immer
- **Browser embedding**: wry / WebKitGTK on Linux

## Build From Source

### Prerequisites

- Rust, latest stable
- Node.js 18+
- Linux system packages:

```bash
sudo apt install pkg-config libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev libgtk-3-dev
```

For Fedora:

```bash
sudo dnf install pkgconf-pkg-config webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel gtk3-devel
```

For Arch:

```bash
sudo pacman -S pkgconf webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg gtk3
```

### Run

```bash
git clone https://github.com/galakurpi/lmux.git
cd lmux
npm install
npm run tauri dev
```

### Build

```bash
npm run build
npm run tauri build
```

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+Shift+P` | Open command palette |
| `Ctrl+,` | Open keyboard shortcuts |

### Workspace

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+N` | New workspace |
| `Ctrl+Tab` | Next workspace |
| `Ctrl+Shift+Tab` | Previous workspace |
| `Ctrl+Shift+W` | Close workspace |
| `Ctrl+1` - `Ctrl+8` | Jump to workspace 1-8 |
| `Ctrl+9` | Jump to last workspace |

### Pane

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+D` | Split pane right |
| `Ctrl+Alt+Shift+D` | Split pane down |
| `Ctrl+Alt+W` | Close active pane |
| `Ctrl+Alt+Arrow` | Focus pane in direction |
| `Ctrl+Shift+Enter` | Toggle pane zoom |
| `Ctrl+Shift+H` | Flash focused pane |

### Terminal

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+F` | Find in terminal |

## Roadmap

The current quality target is documented in
[`docs/plans/cmux-quality-roadmap.md`](docs/plans/cmux-quality-roadmap.md).

In short: make the terminal boring and reliable first, then deepen the agent
workflow until it becomes meaningfully better than juggling separate terminal
windows.

## Credits

This project started from `cai0baa/cmux-for-linux` and is inspired by
ManaFlow's cmux.

## License

GPL v3. See [LICENSE](LICENSE).
