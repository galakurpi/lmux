use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

use crate::events;

const RECENT_OUTPUT_MAX_BYTES: usize = 1024 * 1024;
const PTY_READ_BUFFER_BYTES: usize = 32768;
const PTY_OUTPUT_INTERACTIVE_BYTES: usize = 16;
const PTY_OUTPUT_CHANNEL_BATCH_BYTES: usize = 64 * 1024;
const PTY_OUTPUT_CHANNEL_BATCH_WINDOW: Duration = Duration::from_millis(1);

#[derive(Default)]
struct RecentOutput {
    chunks: VecDeque<Vec<u8>>,
    total_bytes: usize,
}

pub struct PtySession {
    child: Mutex<Box<dyn Child + Send + Sync>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    data_channel: Arc<Mutex<Option<Channel<Vec<u8>>>>>,
    recent_output: Arc<Mutex<RecentOutput>>,
}

// Safety: All fields are behind Mutex, access is serialized.
unsafe impl Sync for PtySession {}

impl PtySession {
    pub fn spawn(
        session_id: String,
        command: &str,
        args: &[String],
        cols: u16,
        rows: u16,
        data_channel: Channel<Vec<u8>>,
        app_handle: AppHandle,
        cwd: Option<String>,
        workspace_id: Option<String>,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let mut cmd = CommandBuilder::new(command);
        cmd.args(args);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "lmux");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        cmd.env("LMUX_SURFACE_ID", &session_id);
        cmd.env("LMUX_SESSION_ID", &session_id);
        let wrapper_path = "/home/gal/Desktop/business/projects/lmux/scripts";
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", format!("{wrapper_path}:{path}"));
        }
        if let Some(workspace_id) = workspace_id {
            cmd.env("LMUX_WORKSPACE_ID", workspace_id);
        }

        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {e}"))?;

        // Drop slave — we only need master
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {e}"))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {e}"))?;

        let data_channel = Arc::new(Mutex::new(Some(data_channel)));
        let recent_output = Arc::new(Mutex::new(RecentOutput::default()));

        // Spawn reader thread — blocking I/O, not tokio
        let sid = session_id.clone();
        let handle = app_handle.clone();
        let reader_channel = Arc::clone(&data_channel);
        let reader_recent_output = Arc::clone(&recent_output);
        let (output_tx, output_rx) = mpsc::channel::<Vec<u8>>();
        thread::spawn(move || {
            coalesce_pty_output(output_rx, reader_channel, reader_recent_output);
        });

        thread::spawn(move || {
            let mut buf = [0u8; PTY_READ_BUFFER_BYTES];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if output_tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let exit_event = events::pty_exit_event(&sid);
            let _ = handle.emit(&exit_event, ());
        });

        Ok(Self {
            child: Mutex::new(child),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            data_channel,
            recent_output,
        })
    }

    pub fn attach(
        &self,
        data_channel: Channel<Vec<u8>>,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        self.resize(cols, rows)?;

        if let Ok(recent) = self.recent_output.lock() {
            for chunk in recent.chunks.iter() {
                let _ = data_channel.send(chunk.clone());
            }
        }

        let mut channel = self
            .data_channel
            .lock()
            .map_err(|e| format!("Channel lock failed: {e}"))?;
        *channel = Some(data_channel);
        Ok(())
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|e| format!("Lock failed: {e}"))?;

        writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {e}"))?;
        writer.flush().map_err(|e| format!("Flush failed: {e}"))?;

        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self
            .master
            .lock()
            .map_err(|e| format!("Lock failed: {e}"))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {e}"))
    }

    pub fn kill(&self) -> Result<(), String> {
        let mut child = self.child.lock().map_err(|e| format!("Lock failed: {e}"))?;
        child.kill().map_err(|e| format!("Kill failed: {e}"))
    }

    pub fn process_id(&self) -> Option<u32> {
        if let Ok(child) = self.child.lock() {
            child.process_id()
        } else {
            None
        }
    }
}

fn coalesce_pty_output(
    output_rx: mpsc::Receiver<Vec<u8>>,
    data_channel: Arc<Mutex<Option<Channel<Vec<u8>>>>>,
    recent_output: Arc<Mutex<RecentOutput>>,
) {
    while let Ok(first) = output_rx.recv() {
        if first.len() <= PTY_OUTPUT_INTERACTIVE_BYTES {
            send_pty_output(first, &data_channel, &recent_output);
            continue;
        }

        let mut pending = first;
        let batch_started = Instant::now();

        while pending.len() < PTY_OUTPUT_CHANNEL_BATCH_BYTES {
            let elapsed = batch_started.elapsed();
            if elapsed >= PTY_OUTPUT_CHANNEL_BATCH_WINDOW {
                break;
            }

            let remaining = PTY_OUTPUT_CHANNEL_BATCH_WINDOW - elapsed;
            match output_rx.recv_timeout(remaining) {
                Ok(chunk) => pending.extend_from_slice(&chunk),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        send_pty_output(pending, &data_channel, &recent_output);
    }
}

fn send_pty_output(
    chunk: Vec<u8>,
    data_channel: &Arc<Mutex<Option<Channel<Vec<u8>>>>>,
    recent_output: &Arc<Mutex<RecentOutput>>,
) {
    remember_recent_output(recent_output, chunk.clone());
    if let Ok(channel) = data_channel.lock() {
        if let Some(channel) = channel.as_ref() {
            let _ = channel.send(chunk);
        }
    }
}

fn remember_recent_output(recent_output: &Arc<Mutex<RecentOutput>>, chunk: Vec<u8>) {
    let Ok(mut recent) = recent_output.lock() else {
        return;
    };

    recent.total_bytes += chunk.len();
    recent.chunks.push_back(chunk);
    while recent.total_bytes > RECENT_OUTPUT_MAX_BYTES {
        if let Some(removed) = recent.chunks.pop_front() {
            recent.total_bytes = recent.total_bytes.saturating_sub(removed.len());
        } else {
            recent.total_bytes = 0;
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remember_recent_output_keeps_newest_bytes_under_cap() {
        let recent_output = Arc::new(Mutex::new(RecentOutput::default()));
        let first = vec![b'a'; RECENT_OUTPUT_MAX_BYTES - 4];
        let second = b"bbbb".to_vec();
        let third = b"cccc".to_vec();

        remember_recent_output(&recent_output, first);
        remember_recent_output(&recent_output, second);
        remember_recent_output(&recent_output, third.clone());

        let recent = recent_output.lock().unwrap();
        assert!(recent.total_bytes <= RECENT_OUTPUT_MAX_BYTES);
        assert_eq!(recent.chunks.back(), Some(&third));
        assert_eq!(
            recent.total_bytes,
            recent.chunks.iter().map(Vec::len).sum::<usize>()
        );
    }
}
