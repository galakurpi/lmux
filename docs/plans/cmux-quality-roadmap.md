# Cmux-Quality Roadmap

This project should aim for cmux-level usefulness, not a line-for-line cmux clone.
Its specific niche is managing multiple AI coding agents cleanly on Linux.
The stack is different: Tauri, React, xterm.js, and Rust instead of Swift,
AppKit, and libghostty. That makes it more hackable on Linux and Windows, but
it means quality has to come from product polish, reliable PTY behavior, and
agent workflow depth rather than native macOS integration.

## Product Bar

- Opens fast, feels stable, and does not lose terminal sessions during ordinary pane/workspace changes.
- Terminal input, selection, copy/paste, resizing, font rendering, and shell behavior feel boring and correct.
- Workspaces make parallel agent work easier than separate terminal windows.
- Notifications tell the user when an agent is working, waiting, done, or failed without false noise.
- Browser panes are reliable enough for local app testing and agent-driven inspection.
- Socket/CLI automation is complete enough that an agent can drive the app without brittle UI scripting.

## Non-Goals

- Do not chase full cmux parity before the basics are solid.
- Do not replace xterm.js with a lower-level renderer until concrete terminal behavior or performance proves it is needed.
- Do not build a heavy IDE. The app should stay a terminal workspace first.

## Phase 1: Make The Base Trustworthy

- Keep `npm run build` green.
- Keep Rust/Tauri checks green on a Linux machine with documented system dependencies installed.
- Add a minimal test harness for pure TypeScript store/layout logic.
- Fix dependency audit issues that have safe patch upgrades.
- Remove stale naming/version drift between `package.json`, `package-lock.json`, Cargo, and Tauri config.
- Document the exact Linux development dependency install path.

## Phase 2: Terminal Quality

- Verify PTY lifecycle: spawn, resize, close, process exit, workspace close, and app shutdown.
- Improve keyboard handling for common agent workflows: Shift+Enter, Ctrl shortcuts, Alt keys, copy/paste, and shell control sequences.
- Add regression checks for pane layout persistence and terminal session metadata.
- Keep terminal defaults conservative: no visual styling that changes terminal semantics.

## Phase 3: Agent Workflow

- Replace heuristic-only agent status detection with explicit integrations where possible:
  Claude Code hooks, Codex hooks, OSC notification sequences, and CLI commands.
- Add robust socket commands:
  `pane.list`, `pane.focus`, `pane.write`, `pane.read-screen`, `pane.kill`,
  `workspace.rename`, `notify.send`, `notify.clear`, `browser.open`, and
  `browser.snapshot`.
- Ship an agent skill/instructions file that teaches Claude/Codex how to drive the app through the socket API.
- Make unread and waiting states obvious in sidebar, pane borders, and a notification panel.

## Phase 4: Browser And Local App Testing

- Make browser panes easy to open from detected localhost ports.
- Add reliable browser commands for navigate, click, fill, wait, snapshot, and evaluate.
- Surface browser errors plainly instead of silently failing.
- Keep browser panes optional so terminal-only usage remains fast.

## Phase 5: Shareable Quality

- Add CI for Linux builds and frontend checks.
- Produce AppImage and `.deb` release artifacts.
- Add a short demo workflow: start three agents, assign tasks, inspect results, open browser pane.
- Write contributor notes that keep the scope focused on terminal workspace and agent orchestration.

## Possible Future Renderer Work

If xterm.js becomes the limiting factor, evaluate `libghostty` through GTK or a
native rendering surface. That should be a measured migration, not the first
rewrite. The trigger should be specific evidence: rendering latency, missing
terminal protocol support, input correctness bugs, or memory/CPU overhead that
cannot be fixed inside the current stack.
