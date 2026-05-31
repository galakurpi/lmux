use std::process::{Command, Stdio};
use std::thread;

#[tauri::command]
pub fn send_desktop_notification(
    title: String,
    body: Option<String>,
    sound: Option<bool>,
) -> Result<(), String> {
    let title = if title.trim().is_empty() {
        "Lmux".to_string()
    } else {
        title.trim().to_string()
    };
    let body = body.unwrap_or_default();

    #[cfg(target_os = "linux")]
    {
        let mut cmd = Command::new("notify-send");
        cmd.arg("-a").arg("Lmux").arg(&title);
        if !body.trim().is_empty() {
            cmd.arg(body.trim());
        }
        let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn();
    }

    if sound.unwrap_or(true) {
        thread::spawn(play_notification_sound);
    }

    Ok(())
}

fn play_notification_sound() {
    #[cfg(target_os = "linux")]
    {
        let candidates: &[(&str, &[&str])] = &[
            ("canberra-gtk-play", &["-i", "message"]),
            ("paplay", &["/usr/share/sounds/freedesktop/stereo/message.oga"]),
            ("pw-play", &["/usr/share/sounds/freedesktop/stereo/message.oga"]),
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
