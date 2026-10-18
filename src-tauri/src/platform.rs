//! Windows platform facts: privilege level and the UAC relaunch.

use std::time::Duration;

use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};
use windows::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::PCWSTR;

use crate::error::{AppError, AppResult};

/// True when this process runs with an elevated (administrator) token.
pub fn is_elevated() -> bool {
    let mut token = HANDLE::default();
    // SAFETY: pseudo-handle for the current process; out-pointer is a live local.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.is_err() {
        return false;
    }
    let mut elevation = TOKEN_ELEVATION::default();
    let mut returned = 0u32;
    // SAFETY: buffer pointer and size describe a live TOKEN_ELEVATION.
    let ok = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
    };
    // SAFETY: we own the token handle.
    unsafe {
        let _ = CloseHandle(token);
    }
    ok.is_ok() && elevation.TokenIsElevated != 0
}

/// Command-line options CommandDeck understands at startup.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LaunchArgs {
    pub page: Option<String>,
    pub handoff_pid: Option<u32>,
}

pub fn parse_args<I: IntoIterator<Item = String>>(args: I) -> LaunchArgs {
    let mut out = LaunchArgs::default();
    let mut it = args.into_iter().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--page" => {
                out.page = it
                    .next()
                    .filter(|p| matches!(p.as_str(), "home" | "cmd" | "powershell" | "settings"))
            }
            "--handoff" => out.handoff_pid = it.next().and_then(|p| p.parse().ok()),
            _ => {}
        }
    }
    out
}

/// Waits (bounded) for the instance that launched us to exit, so two instances
/// never share the WebView2 profile at the same time.
pub fn wait_for_handoff(pid: u32, timeout: Duration) {
    // SAFETY: requesting only SYNCHRONIZE access to wait on the process.
    let Ok(handle) = (unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }) else {
        return;
    };
    // SAFETY: valid handle; bounded wait.
    unsafe {
        WaitForSingleObject(handle, timeout.as_millis() as u32);
        let _ = CloseHandle(handle);
    }
}

/// Starts a new elevated CommandDeck through UAC. Windows shows the consent
/// prompt; nothing here can bypass it. `Ok(())` means the user approved and
/// the new instance is starting; the caller should then exit.
pub fn relaunch_elevated(page: &str) -> AppResult<()> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::Internal(format!("can't find CommandDeck's executable: {e}")))?;
    let page = if matches!(page, "home" | "cmd" | "powershell" | "settings") {
        page
    } else {
        "home"
    };
    let params = format!("--page {page} --handoff {}", std::process::id());
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();
    let file: Vec<u16> = exe
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let parameters: Vec<u16> = params.encode_utf16().chain(std::iter::once(0)).collect();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: all strings outlive the call; struct size is set.
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) => {
            if !info.hProcess.is_invalid() {
                // SAFETY: we own the returned process handle.
                unsafe {
                    let _ = CloseHandle(info.hProcess);
                }
            }
            Ok(())
        }
        Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => Err(AppError::Conflict(
            "Restart cancelled. CommandDeck is still running as a standard user.".into(),
        )),
        Err(e) => Err(AppError::Internal(format!(
            "Windows couldn't start CommandDeck as administrator: {e}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elevation_matches_the_token_reported_by_windows() {
        // whoami reports "High Mandatory Level" only for elevated tokens.
        let out = std::process::Command::new(crate::pty::system_dir().join("whoami.exe"))
            .arg("/groups")
            .output()
            .unwrap();
        let high = String::from_utf8_lossy(&out.stdout).contains("High Mandatory Level");
        assert_eq!(is_elevated(), high);
    }

    #[test]
    fn launch_args_are_parsed_and_validated() {
        let a = parse_args([
            "x".into(),
            "--page".into(),
            "cmd".into(),
            "--handoff".into(),
            "123".into(),
        ]);
        assert_eq!(
            a,
            LaunchArgs {
                page: Some("cmd".into()),
                handoff_pid: Some(123)
            }
        );
        let b = parse_args([
            "x".into(),
            "--page".into(),
            "evil".into(),
            "--handoff".into(),
            "abc".into(),
        ]);
        assert_eq!(b, LaunchArgs::default());
    }

    #[test]
    fn handoff_wait_returns_for_unknown_process() {
        let start = std::time::Instant::now();
        wait_for_handoff(u32::MAX - 7, Duration::from_secs(5));
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}
