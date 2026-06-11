use serde::Serialize;
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
struct NotificationActivationPayload {
    workspace_id: String,
    surface_id: String,
}

#[tauri::command]
pub fn send_desktop_notification(
    app_handle: AppHandle,
    title: String,
    body: Option<String>,
    sound: Option<bool>,
    workspace_id: Option<String>,
    surface_id: Option<String>,
) -> Result<(), String> {
    let title = if title.trim().is_empty() {
        "Lmux".to_string()
    } else {
        title.trim().to_string()
    };
    let body = body.unwrap_or_default();
    let target = workspace_id
        .zip(surface_id)
        .filter(|(workspace, surface)| !workspace.trim().is_empty() && !surface.trim().is_empty());

    #[cfg(target_os = "linux")]
    {
        spawn_linux_notification(app_handle.clone(), title.clone(), body.clone(), target);
    }

    if sound.unwrap_or(true) {
        thread::spawn(play_notification_sound);
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn spawn_linux_notification(
    app_handle: AppHandle,
    title: String,
    body: String,
    target: Option<(String, String)>,
) {
    thread::spawn(move || {
        let mut cmd = Command::new("notify-send");
        cmd.arg("-a").arg("Lmux");
        if target.is_some() {
            // "default" makes a click anywhere on the toast open the pane;
            // "open" keeps an explicit button for daemons that show actions.
            cmd.arg("--action=default=Open");
            cmd.arg("--action=open=Open");
        }
        cmd.arg(&title);
        if !body.trim().is_empty() {
            cmd.arg(body.trim());
        }

        if let Some((workspace_id, surface_id)) = target {
            let output = cmd.stdout(Stdio::piped()).stderr(Stdio::null()).output();
            let Ok(output) = output else {
                return;
            };
            let action = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if matches!(action.as_str(), "open" | "default" | "0") {
                focus_lmux_window(&app_handle);
                let _ = app_handle.emit(
                    "desktop-notification-activated",
                    NotificationActivationPayload {
                        workspace_id,
                        surface_id,
                    },
                );
            }
        } else {
            let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn();
        }
    });
}

#[cfg(target_os = "linux")]
fn focus_lmux_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        if !activate_lmux_window_x11() {
            let _ = window.set_focus();
        }
    }
}

#[cfg(target_os = "linux")]
fn activate_lmux_window_x11() -> bool {
    Command::new("xdotool")
        .args([
            "search",
            "--onlyvisible",
            "--name",
            "^Lmux$",
            "windowactivate",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn play_notification_sound() {
    #[cfg(target_os = "linux")]
    {
        let candidates: &[(&str, &[&str])] = &[
            ("canberra-gtk-play", &["-i", "message"]),
            (
                "paplay",
                &["/usr/share/sounds/freedesktop/stereo/message.oga"],
            ),
            (
                "pw-play",
                &["/usr/share/sounds/freedesktop/stereo/message.oga"],
            ),
            ("aplay", &["/usr/share/sounds/alsa/Front_Center.wav"]),
        ];

        for (program, args) in candidates {
            if Command::new(program)
                .args(*args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
            {
                return;
            }
        }
    }
}
