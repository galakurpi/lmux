use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use sysinfo::System;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::AppState;

#[derive(serde::Serialize)]
pub struct TerminalConfigPayload {
    pub font_family: String,
    pub font_size: f32,
    pub shell: String,
    pub background: String,
    pub foreground: String,
    pub ansi: Vec<String>,
}

fn rgb_hex(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

fn default_session_cwd() -> Option<String> {
    let dir = std::env::var("LMUX_DEFAULT_CWD").ok()?;
    if Path::new(&dir).is_dir() {
        Some(dir)
    } else {
        None
    }
}

#[tauri::command]
pub fn get_terminal_config() -> TerminalConfigPayload {
    let cfg = crate::terminal_config::load();
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    TerminalConfigPayload {
        font_family: cfg.font_family,
        font_size: cfg.font_size,
        shell,
        background: rgb_hex(cfg.colors.background),
        foreground: rgb_hex(cfg.colors.foreground),
        ansi: cfg.colors.ansi.iter().map(|c| rgb_hex(*c)).collect(),
    }
}

#[tauri::command]
pub fn create_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    command: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<Vec<u8>>,
    cwd: Option<String>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let cwd = default_session_cwd().or(cwd);
    state.session_manager.create(
        session_id,
        &command,
        &args,
        cols,
        rows,
        on_data,
        app_handle,
        cwd,
        workspace_id,
    )
}

#[tauri::command]
pub fn write_to_session(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.session_manager.write(&session_id, data.as_bytes())
}

#[derive(serde::Serialize)]
pub struct RenameAgentSessionResult {
    pub renamed: bool,
    pub agent: Option<String>,
    pub thread_id: Option<String>,
}

fn proc_children(pid: u32) -> Vec<u32> {
    let path = format!("/proc/{pid}/task/{pid}/children");
    fs::read_to_string(path)
        .ok()
        .map(|children| {
            children
                .split_whitespace()
                .filter_map(|child| child.parse::<u32>().ok())
                .collect()
        })
        .unwrap_or_default()
}

fn proc_cmdline(pid: u32) -> String {
    fs::read(format!("/proc/{pid}/cmdline"))
        .ok()
        .map(|bytes| {
            String::from_utf8_lossy(&bytes)
                .replace('\0', " ")
                .trim()
                .to_string()
        })
        .unwrap_or_default()
}

fn proc_comm(pid: u32) -> String {
    fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|name| name.trim().to_string())
        .unwrap_or_default()
}

fn process_tree(root_pid: u32) -> Vec<u32> {
    let mut seen = HashSet::new();
    let mut stack = vec![root_pid];
    let mut pids = Vec::new();

    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        pids.push(pid);
        stack.extend(proc_children(pid));
    }

    pids
}

fn is_codex_process(pid: u32) -> bool {
    let comm = proc_comm(pid);
    if comm == "codex" {
        return true;
    }

    let cmdline = proc_cmdline(pid);
    cmdline.contains("@openai/codex") || cmdline.contains("/bin/codex")
}

fn is_claude_process(pid: u32) -> bool {
    let comm = proc_comm(pid);
    if comm == "claude" {
        return true;
    }

    let cmdline = proc_cmdline(pid);
    cmdline.contains("lmux-agent claude")
        || cmdline.contains("@anthropic-ai/claude-code")
        || cmdline.contains("/bin/claude")
}

fn terminal_has_claude(root_pid: u32) -> bool {
    process_tree(root_pid).into_iter().any(is_claude_process)
}

fn read_thread_id_from_rollout(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&first_line).ok()?;
    parsed
        .get("payload")
        .and_then(|payload| payload.get("id"))
        .and_then(|id| id.as_str())
        .map(ToOwned::to_owned)
}

fn codex_thread_id_from_open_files(pid: u32) -> Option<String> {
    let fd_dir = format!("/proc/{pid}/fd");
    for entry in fs::read_dir(fd_dir).ok()? {
        let path = entry.ok()?.path();
        let target = fs::read_link(path).ok()?;
        let target_str = target.to_string_lossy();
        if target_str.contains("/.codex/sessions/")
            && target_str.ends_with(".jsonl")
            && target
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("rollout-"))
        {
            if let Some(thread_id) = read_thread_id_from_rollout(&target) {
                return Some(thread_id);
            }
        }
    }
    None
}

fn codex_thread_id_from_logs(pid: u32) -> Option<String> {
    let script = r#"
import os
import sqlite3
import sys

pid = sys.argv[1]
logs_db = os.path.expanduser("~/.codex/logs_2.sqlite")
if not os.path.exists(logs_db):
    raise SystemExit(0)

con = sqlite3.connect(logs_db, timeout=3)
con.execute("PRAGMA busy_timeout = 3000")
row = con.execute(
    """
    SELECT thread_id
    FROM logs
    WHERE process_uuid LIKE ?
      AND thread_id IS NOT NULL
      AND thread_id != ''
    ORDER BY id DESC
    LIMIT 1
    """,
    (f"pid:{pid}:%",),
).fetchone()
con.close()
if row:
    print(row[0])
"#;

    let output = Command::new("python3")
        .arg("-c")
        .arg(script)
        .arg(pid.to_string())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let thread_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if thread_id.is_empty() {
        None
    } else {
        Some(thread_id)
    }
}

fn codex_thread_id_for_terminal(root_pid: u32) -> Option<String> {
    for pid in process_tree(root_pid) {
        if is_codex_process(pid) {
            if let Some(thread_id) =
                codex_thread_id_from_open_files(pid).or_else(|| codex_thread_id_from_logs(pid))
            {
                return Some(thread_id);
            }
        }
    }
    None
}

fn update_codex_thread_title(thread_id: &str, label: &str) -> Result<(), String> {
    let script = r#"
import datetime
import json
import os
import sqlite3
import sys
import time

thread_id, label = sys.argv[1], sys.argv[2]
home = os.path.expanduser("~")
state_db = os.path.join(home, ".codex", "state_5.sqlite")
session_index = os.path.join(home, ".codex", "session_index.jsonl")
now = datetime.datetime.now(datetime.timezone.utc)
updated_at = int(now.timestamp())
updated_at_ms = int(now.timestamp() * 1000)
updated_at_iso = now.isoformat().replace("+00:00", "Z")

if os.path.exists(state_db):
    con = sqlite3.connect(state_db, timeout=3)
    con.execute("PRAGMA busy_timeout = 3000")
    for _ in range(25):
        cur = con.execute(
            "UPDATE threads SET title = ?, updated_at = ?, updated_at_ms = ? WHERE id = ?",
            (label, updated_at, updated_at_ms, thread_id),
        )
        if cur.rowcount:
            break
        time.sleep(0.2)
    con.commit()
    con.close()

with open(session_index, "a", encoding="utf-8") as f:
    f.write(json.dumps(
        {"id": thread_id, "thread_name": label, "updated_at": updated_at_iso},
        separators=(",", ":"),
    ) + "\n")
"#;

    let output = Command::new("python3")
        .arg("-c")
        .arg(script)
        .arg(thread_id)
        .arg(label)
        .output()
        .map_err(|err| format!("python3 unavailable: {err}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("codex title update exited with {}", output.status)
        } else {
            stderr
        })
    }
}

#[tauri::command]
pub fn rename_agent_session_for_terminal(
    state: State<'_, AppState>,
    session_id: String,
    label: String,
) -> Result<RenameAgentSessionResult, String> {
    let label = label
        .replace(['\r', '\n', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if label.is_empty() {
        return Err("empty label".to_string());
    }

    let root_pid = state
        .session_manager
        .process_id(&session_id)
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    if let Some(thread_id) = codex_thread_id_for_terminal(root_pid) {
        update_codex_thread_title(&thread_id, &label)?;
        return Ok(RenameAgentSessionResult {
            renamed: true,
            agent: Some("codex".to_string()),
            thread_id: Some(thread_id),
        });
    }

    if terminal_has_claude(root_pid) {
        state
            .session_manager
            .write(&session_id, format!("/rename {label}\r").as_bytes())?;
        return Ok(RenameAgentSessionResult {
            renamed: true,
            agent: Some("claude".to_string()),
            thread_id: None,
        });
    }

    Ok(RenameAgentSessionResult {
        renamed: false,
        agent: None,
        thread_id: None,
    })
}

#[tauri::command]
pub fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.session_manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn kill_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.session_manager.kill(&session_id)
}

fn write_command_stdin(command: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|err| format!("{command} unavailable: {err}"))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| format!("{command} stdin unavailable"))?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|err| format!("{command} write failed: {err}"))?;

    let status = child
        .wait()
        .map_err(|err| format!("{command} wait failed: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{command} exited with {status}"))
    }
}

#[cfg(target_os = "linux")]
fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut errors = Vec::new();

    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        if let Err(err) = write_command_stdin("wl-copy", &[], text) {
            errors.push(err);
        } else {
            return Ok(());
        }
    }

    for (command, args) in [
        ("xclip", &["-selection", "clipboard"][..]),
        ("xsel", &["--clipboard", "--input"][..]),
    ] {
        if let Err(err) = write_command_stdin(command, args, text) {
            errors.push(err);
        } else {
            return Ok(());
        }
    }

    Err(format!("clipboard write failed: {}", errors.join("; ")))
}

#[cfg(target_os = "macos")]
fn write_clipboard_text(text: &str) -> Result<(), String> {
    write_command_stdin("pbcopy", &[], text)
}

#[cfg(target_os = "windows")]
fn write_clipboard_text(text: &str) -> Result<(), String> {
    write_command_stdin(
        "powershell.exe",
        &["-NoProfile", "-Command", "Set-Clipboard"],
        text,
    )
}

#[tauri::command]
pub fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    write_clipboard_text(&text)
}

#[tauri::command]
pub fn get_all_cwds(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let mut cwds = HashMap::new();
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for (session_id, pid_opt) in state.session_manager.iter_pids() {
        if let Some(pid) = pid_opt {
            let sys_pid = sysinfo::Pid::from_u32(pid);
            // We want the foreground process CWD. If bash is the child, we find its children.
            // For simplicity, we just take the deepest child process's CWD or the shell's CWD.
            // Let's find any child of this PID, or use the PID itself.
            let mut target_pid = sys_pid;

            // Find a child process (like nvim, node, etc)
            for (p, proc) in sys.processes() {
                if let Some(parent) = proc.parent() {
                    if parent == sys_pid {
                        target_pid = *p;
                        break;
                    }
                }
            }

            if let Some(proc) = sys.process(target_pid) {
                if let Some(cwd) = proc.cwd() {
                    cwds.insert(session_id, cwd.to_string_lossy().to_string());
                }
            }
        }
    }

    Ok(cwds)
}
