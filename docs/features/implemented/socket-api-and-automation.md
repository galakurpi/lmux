# Socket API & Automation

## Overview

TCP socket API on localhost exposing a JSON-RPC API for external control, plus a CLI tool (`ptr`) for scripting terminal operations. Uses TCP for cross-platform compatibility (Windows, macOS, Linux).

## cmux Reference
- Unix socket at `~/.cmux/cmux.sock`
- **60+ commands** across categories:
  - **Window**: new, close, minimize, fullscreen, geometry
  - **Workspace**: new, close, select, rename, reorder, list
  - **Surface**: new (terminal/browser/markdown), close, focus, split, zoom
  - **Notification**: send, clear, list, mark-read
  - **Status**: set/get per-pane status text, Git branch display
  - **Port monitoring**: scan, list, open in browser
- CLI wrapper: `cmux <command> [args]` translates to socket messages
- JSON request/response protocol with streaming for output

## lmux Implementation

| Layer | Implementation |
|-------|----------------|
| Rust | `src-tauri/src/socket.rs` — TCP listener on `127.0.0.1:<random_port>` |
| Rust | JSON message parser and frontend dispatcher |
| Discovery | Port written to `~/.lmux/ptr.port` |
| CLI | `ptr` binary reads port file, connects via TCP |
| Protocol | JSON messages: `{"cmd": "workspace.new", "args": {...}}` |

## Command Set

```
workspace.list    workspace.new       workspace.select
workspace.close   workspace.rename
pane.list         pane.focus          pane.write
pane.read-screen  pane.kill           pane.split-right
pane.split-down   pane.close
notify.send       notify.clear        notification.list
status.set        status.clear        progress.set
progress.clear    browser.open        browser.navigate
browser.snapshot  browser.eval        browser.click
browser.fill      browser.wait        browser.status
theme.set
```

The drop-in agent skill lives at `skills/lmux/SKILL.md`. It follows the same
shape as the external cmux skill: teach workspace/pane/surface concepts, prefer
explicit surface targeting, avoid stealing focus, and use pane inspection plus
status/progress/notification commands for lightweight coordination.

## Key Decisions

- **Transport**: TCP on localhost (`127.0.0.1`) for cross-platform support
- **Port discovery**: Random port, written to `~/.lmux/ptr.port`
- **Protocol**: Simple JSON-RPC over TCP, newline-delimited messages
- **Security**: Only accepts connections from loopback addresses
- **Screen reads**: `pane.read-screen` returns the latest xterm buffer snapshot captured in the frontend

## Priority: **Medium**

Enables scripting, agent integration, and external tool control. High value for power users and AI agent workflows.
