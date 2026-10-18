//! Terminal sessions and one-off runs on top of ConPTY.
//!
//! The webview can start only known shells (never an arbitrary program) and
//! run only catalog commands by id (never frontend-provided command text).
//! Typing into a session is the same as typing into cmd.exe yourself.

pub mod conpty;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::catalog::{Command, Shell};

/// Serializes process creation across CommandDeck.
///
/// `CreatePseudoConsole` briefly makes its pipe handles inheritable while it
/// starts the console host, and `std::process::Command` spawns with handle
/// inheritance on. If the two overlap, the std child inherits a write end of a
/// terminal's output pipe, the pipe never reaches EOF, and that session never
/// reports its exit. Every spawn path takes this lock.
pub static SPAWN_LOCK: Mutex<()> = Mutex::new(());

/// The only way CommandDeck starts a `std::process::Command` (see `SPAWN_LOCK`).
pub fn spawn_std(command: &mut std::process::Command) -> std::io::Result<std::process::Child> {
    let _guard = SPAWN_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    command.spawn()
}
use crate::error::{AppError, AppResult};
pub use conpty::{ConPtyProcess, EventSink, ProcessEvent, SpawnSpec};

pub const MAX_SESSIONS: usize = 16;
pub const MAX_WRITE_BYTES: usize = 1 << 20;
const MAX_DIMENSION: u16 = 1000;

/// Shells CommandDeck can host. `Pwsh` is PowerShell 7, used only if installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellKind {
    Cmd,
    Powershell,
    Pwsh,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub id: ShellKind,
    pub label: &'static str,
    pub path: Option<String>,
    pub available: bool,
}

/// Event delivered to the webview over a Tauri channel.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PtyEvent {
    /// Raw terminal bytes, base64-encoded (may split UTF-8 sequences; xterm.js reassembles).
    Output {
        data: String,
    },
    Exit {
        code: u32,
    },
}

impl From<ProcessEvent> for PtyEvent {
    fn from(e: ProcessEvent) -> Self {
        match e {
            ProcessEvent::Output(bytes) => PtyEvent::Output {
                data: base64::engine::general_purpose::STANDARD.encode(bytes),
            },
            ProcessEvent::Exit(code) => PtyEvent::Exit { code },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: u64,
    pub pid: u32,
    pub program: String,
}

/// `%SystemRoot%\System32` via the API (not an environment variable).
pub fn system_dir() -> PathBuf {
    let mut buf = [0u16; 260];
    // SAFETY: buffer is a valid, writable local of the stated length.
    let len =
        unsafe { windows::Win32::System::SystemInformation::GetSystemDirectoryW(Some(&mut buf)) }
            as usize;
    if len == 0 || len >= buf.len() {
        return PathBuf::from(r"C:\Windows\System32");
    }
    PathBuf::from(String::from_utf16_lossy(&buf[..len]))
}

pub fn shell_path(shell: ShellKind) -> Option<PathBuf> {
    let path = match shell {
        ShellKind::Cmd => system_dir().join("cmd.exe"),
        ShellKind::Powershell => system_dir().join(r"WindowsPowerShell\v1.0\powershell.exe"),
        ShellKind::Pwsh => {
            let base = std::env::var_os("ProgramFiles")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
            ["7", "7-preview"]
                .iter()
                .map(|v| base.join("PowerShell").join(v).join("pwsh.exe"))
                .find(|p| p.is_file())?
        }
    };
    path.is_file().then_some(path)
}

pub fn shells() -> Vec<ShellInfo> {
    [
        (ShellKind::Cmd, "Command Prompt"),
        (ShellKind::Powershell, "Windows PowerShell"),
        (ShellKind::Pwsh, "PowerShell 7"),
    ]
    .into_iter()
    .map(|(id, label)| {
        let path = shell_path(id);
        ShellInfo {
            id,
            label,
            available: path.is_some(),
            path: path.map(|p| p.display().to_string()),
        }
    })
    .collect()
}

fn quoted(p: &std::path::Path) -> String {
    format!("\"{}\"", p.display())
}

/// Interactive shell exactly as a normal terminal would start it (profiles/AutoRun included).
pub fn interactive_spec(
    shell: ShellKind,
    cwd: Option<PathBuf>,
    cols: u16,
    rows: u16,
) -> AppResult<SpawnSpec> {
    let program = shell_path(shell)
        .ok_or_else(|| AppError::NotFound(format!("{shell:?} is not installed on this PC.")))?;
    let command_line = match shell {
        ShellKind::Cmd => quoted(&program),
        ShellKind::Powershell | ShellKind::Pwsh => format!("{} -NoLogo", quoted(&program)),
    };
    Ok(SpawnSpec {
        program,
        command_line,
        cwd,
        cols,
        rows,
    })
}

/// One-off run of a catalog command's canonical syntax, verbatim.
///
/// CMD: `cmd.exe /d /s /c "<syntax>"`. `/s` strips exactly the outer quotes, so the
/// syntax runs as typed; `/d` skips AutoRun for predictable behavior.
/// PowerShell: `-EncodedCommand` (UTF-16LE base64), so nothing is re-parsed by a
/// command line; `-NoProfile -NonInteractive` for predictable behavior.
pub fn run_spec(
    command: &Command,
    cwd: Option<PathBuf>,
    cols: u16,
    rows: u16,
) -> AppResult<SpawnSpec> {
    match command.shell {
        Shell::Cmd => {
            if command.syntax.contains(['\r', '\n']) {
                return Err(AppError::invalid(
                    "syntax",
                    "multi-line CMD commands can't run as one command",
                ));
            }
            let program = shell_path(ShellKind::Cmd)
                .ok_or_else(|| AppError::NotFound("cmd.exe not found".into()))?;
            let command_line = format!("{} /d /s /c \"{}\"", quoted(&program), command.syntax);
            Ok(SpawnSpec {
                program,
                command_line,
                cwd,
                cols,
                rows,
            })
        }
        Shell::Powershell => {
            let program = shell_path(ShellKind::Powershell)
                .ok_or_else(|| AppError::NotFound("powershell.exe not found".into()))?;
            let utf16: Vec<u8> = command
                .syntax
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect();
            let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
            let command_line = format!(
                "{} -NoLogo -NoProfile -NonInteractive -EncodedCommand {encoded}",
                quoted(&program)
            );
            Ok(SpawnSpec {
                program,
                command_line,
                cwd,
                cols,
                rows,
            })
        }
    }
}

pub fn check_dimensions(cols: u16, rows: u16) -> AppResult<()> {
    if cols == 0 || rows == 0 || cols > MAX_DIMENSION || rows > MAX_DIMENSION {
        return Err(AppError::invalid(
            "size",
            "terminal size must be 1–1000 columns and rows",
        ));
    }
    Ok(())
}

/// Live sessions keyed by id. Dropping the manager kills every process tree.
#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<u64, Arc<ConPtyProcess>>>,
    next_id: AtomicU64,
}

impl PtyManager {
    fn sessions(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<u64, Arc<ConPtyProcess>>>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::Internal("session lock poisoned".into()))
    }

    fn get(&self, id: u64) -> AppResult<Arc<ConPtyProcess>> {
        self.sessions()?
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::NotFound("That terminal session has ended.".into()))
    }

    pub fn open(&self, spec: &SpawnSpec, sink: EventSink) -> AppResult<SessionInfo> {
        check_dimensions(spec.cols, spec.rows)?;
        {
            let mut sessions = self.sessions()?;
            sessions.retain(|_, p| !p.has_exited());
            if sessions.len() >= MAX_SESSIONS {
                return Err(AppError::Limit(format!(
                    "At most {MAX_SESSIONS} terminals can be open at once. Close one first."
                )));
            }
        }
        let process =
            ConPtyProcess::spawn(spec, sink).map_err(|e| AppError::Internal(e.to_string()))?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let info = SessionInfo {
            session_id: id,
            pid: process.pid(),
            program: spec.program.display().to_string(),
        };
        self.sessions()?.insert(id, Arc::new(process));
        Ok(info)
    }

    pub fn write(&self, id: u64, data: &str) -> AppResult<()> {
        if data.len() > MAX_WRITE_BYTES {
            return Err(AppError::invalid("data", "input is larger than 1 MB"));
        }
        self.get(id)?
            .write(data.as_bytes())
            .map_err(|e| AppError::Conflict(e.to_string()))
    }

    pub fn resize(&self, id: u64, cols: u16, rows: u16) -> AppResult<()> {
        check_dimensions(cols, rows)?;
        // Resizing an exited session is harmless; ignore that case.
        let _ = self.get(id)?.resize(cols, rows);
        Ok(())
    }

    /// Kills the session's whole process tree and forgets it.
    pub fn close(&self, id: u64) -> AppResult<()> {
        let process = self.sessions()?.remove(&id);
        if let Some(p) = process
            && !p.has_exited()
        {
            p.kill().map_err(|e| AppError::Internal(e.to_string()))?;
        }
        Ok(())
    }

    pub fn count(&self) -> usize {
        self.sessions.lock().map(|s| s.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn collect() -> (EventSink, mpsc::Receiver<ProcessEvent>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (
            Arc::new(move |e| {
                let _ = tx.lock().unwrap().send(e);
            }),
            rx,
        )
    }

    /// Reads events until Exit (or timeout); returns (output text, exit code).
    fn drain(rx: &mpsc::Receiver<ProcessEvent>, timeout: Duration) -> (String, Option<u32>) {
        let mut out = Vec::new();
        let deadline = std::time::Instant::now() + timeout;
        while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(ProcessEvent::Output(b)) => out.extend(b),
                Ok(ProcessEvent::Exit(code)) => {
                    return (String::from_utf8_lossy(&out).into_owned(), Some(code));
                }
                Err(_) => break,
            }
        }
        (String::from_utf8_lossy(&out).into_owned(), None)
    }

    fn wait_for(rx: &mpsc::Receiver<ProcessEvent>, needle: &str, timeout: Duration) -> String {
        let mut out = Vec::new();
        let deadline = std::time::Instant::now() + timeout;
        while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
            if let Ok(ProcessEvent::Output(b)) = rx.recv_timeout(left) {
                out.extend(b);
                if String::from_utf8_lossy(&out).contains(needle) {
                    break;
                }
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    fn command(shell: Shell, syntax: &str) -> Command {
        let mut c = crate::catalog::load_builtin().unwrap().remove(0);
        c.shell = shell;
        c.syntax = syntax.into();
        c
    }

    fn temp_cwd() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    /// Regression: a std::process spawn overlapping CreatePseudoConsole inherited a
    /// terminal's output pipe, so the run never reported its exit (seen with the
    /// PowerShell analysis helper). Long-lived std children race terminal spawns here.
    #[test]
    fn std_spawns_racing_terminals_never_keep_their_pipes_open() {
        use std::os::windows::process::CommandExt;
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let racer = {
            let stop = stop.clone();
            std::thread::spawn(move || {
                let mut children = Vec::new();
                while !stop.load(Ordering::SeqCst) {
                    let spawned = spawn_std(
                        std::process::Command::new(system_dir().join("cmd.exe"))
                            .args(["/d", "/c", "ping -n 3 127.0.0.1 >nul"])
                            .stdin(std::process::Stdio::piped())
                            .stdout(std::process::Stdio::piped())
                            .creation_flags(0x0800_0000),
                    );
                    children.extend(spawned.ok());
                }
                for mut c in children {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            })
        };
        let cwd = temp_cwd();
        for i in 0..6 {
            let (sink, rx) = collect();
            let spec = run_spec(
                &command(Shell::Cmd, &format!("echo run-{i}")),
                Some(cwd.path().into()),
                80,
                24,
            )
            .unwrap();
            let _p = ConPtyProcess::spawn(&spec, sink).unwrap();
            let (out, code) = drain(&rx, Duration::from_secs(10));
            assert!(out.contains(&format!("run-{i}")), "{out:?}");
            assert_eq!(code, Some(0), "run {i} never reported its exit");
        }
        stop.store(true, Ordering::SeqCst);
        racer.join().unwrap();
    }

    #[test]
    fn shells_are_discovered_from_system_paths() {
        let shells = shells();
        let cmd = shells.iter().find(|s| s.id == ShellKind::Cmd).unwrap();
        let ps = shells
            .iter()
            .find(|s| s.id == ShellKind::Powershell)
            .unwrap();
        assert!(
            cmd.available
                && cmd
                    .path
                    .as_deref()
                    .unwrap()
                    .to_lowercase()
                    .ends_with(r"system32\cmd.exe")
        );
        assert!(
            ps.available
                && ps
                    .path
                    .as_deref()
                    .unwrap()
                    .to_lowercase()
                    .ends_with(r"v1.0\powershell.exe")
        );
    }

    #[test]
    fn run_spec_keeps_syntax_verbatim() {
        let spec = run_spec(
            &command(Shell::Cmd, r#"dir "%USERPROFILE%\Documents" /s"#),
            None,
            80,
            24,
        )
        .unwrap();
        assert!(
            spec.command_line
                .ends_with(r#" /d /s /c "dir "%USERPROFILE%\Documents" /s""#),
            "{}",
            spec.command_line
        );

        let ps = run_spec(
            &command(Shell::Powershell, "Get-Date; 'a\"b'"),
            None,
            80,
            24,
        )
        .unwrap();
        let b64 = ps.command_line.rsplit(' ').next().unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        let units: Vec<u16> = bytes
            .chunks(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(String::from_utf16(&units).unwrap(), "Get-Date; 'a\"b'");
    }

    #[test]
    fn multi_line_cmd_is_refused() {
        assert!(run_spec(&command(Shell::Cmd, "echo a\necho b"), None, 80, 24).is_err());
    }

    #[test]
    fn dimensions_are_bounded() {
        assert!(check_dimensions(80, 24).is_ok());
        assert!(check_dimensions(0, 24).is_err());
        assert!(check_dimensions(80, 1001).is_err());
    }

    #[test]
    fn cmd_one_off_output_and_exit_code() {
        let cwd = temp_cwd();
        let (sink, rx) = collect();
        let spec = run_spec(
            &command(Shell::Cmd, "echo hello-from-cmd & exit /b 3"),
            Some(cwd.path().into()),
            80,
            24,
        )
        .unwrap();
        let p = ConPtyProcess::spawn(&spec, sink).unwrap();
        let (out, code) = drain(&rx, Duration::from_secs(15));
        p.wait();
        assert!(out.contains("hello-from-cmd"), "{out:?}");
        assert_eq!(code, Some(3));
    }

    #[test]
    fn powershell_one_off_unicode_output() {
        let cwd = temp_cwd();
        let (sink, rx) = collect();
        let spec = run_spec(
            &command(Shell::Powershell, "Write-Output 'π-ok ✓'"),
            Some(cwd.path().into()),
            80,
            24,
        )
        .unwrap();
        let _p = ConPtyProcess::spawn(&spec, sink).unwrap();
        let (out, code) = drain(&rx, Duration::from_secs(30));
        assert!(out.contains("π-ok ✓"), "{out:?}");
        assert_eq!(code, Some(0));
    }

    #[test]
    fn interactive_session_keeps_state_between_commands() {
        let cwd = temp_cwd();
        let (sink, rx) = collect();
        let spec = interactive_spec(ShellKind::Cmd, Some(cwd.path().into()), 100, 30).unwrap();
        let p = ConPtyProcess::spawn(&spec, sink).unwrap();
        p.write(b"set CMDDECK_TEST=persisted-42\r").unwrap();
        p.write(b"echo value=%CMDDECK_TEST%\r").unwrap();
        let out = wait_for(&rx, "value=persisted-42", Duration::from_secs(15));
        assert!(out.contains("value=persisted-42"), "{out:?}");
        p.resize(120, 40).unwrap();
        p.write(b"exit 7\r").unwrap();
        let (_, code) = drain(&rx, Duration::from_secs(15));
        assert_eq!(code, Some(7));
    }

    #[test]
    fn interactive_input_reaches_programs_that_prompt() {
        let cwd = temp_cwd();
        let (sink, rx) = collect();
        let p = ConPtyProcess::spawn(
            &interactive_spec(ShellKind::Cmd, Some(cwd.path().into()), 80, 24).unwrap(),
            sink,
        )
        .unwrap();
        p.write(b"set /p ANSWER=Name? \r").unwrap();
        wait_for(&rx, "Name?", Duration::from_secs(10));
        p.write(b"Ada\r").unwrap();
        p.write(b"echo got=%ANSWER%\r").unwrap();
        let out = wait_for(&rx, "got=Ada", Duration::from_secs(10));
        assert!(out.contains("got=Ada"), "{out:?}");
        p.kill().unwrap();
    }

    #[test]
    fn kill_terminates_the_whole_process_tree() {
        let cwd = temp_cwd();
        let (sink, rx) = collect();
        let p = ConPtyProcess::spawn(
            &interactive_spec(ShellKind::Cmd, Some(cwd.path().into()), 80, 24).unwrap(),
            sink,
        )
        .unwrap();
        // A long-running child of the shell.
        p.write(b"ping -n 60 127.0.0.1\r").unwrap();
        wait_for(&rx, "127.0.0.1", Duration::from_secs(10));
        assert!(
            p.active_processes().unwrap() >= 2,
            "shell + ping should be in the job"
        );
        p.kill().unwrap();
        let (_, code) = drain(&rx, Duration::from_secs(10));
        assert!(code.is_some(), "Exit event must follow a kill");
        assert_eq!(
            p.active_processes().unwrap(),
            0,
            "no process from the session may survive"
        );
    }

    #[test]
    fn failed_launch_is_an_error_not_a_panic() {
        let spec = SpawnSpec {
            program: PathBuf::from(r"C:\definitely\missing\nothing.exe"),
            command_line: r#""C:\definitely\missing\nothing.exe""#.into(),
            cwd: None,
            cols: 80,
            rows: 24,
        };
        let (sink, _rx) = collect();
        assert!(ConPtyProcess::spawn(&spec, sink).is_err());
    }

    #[test]
    fn manager_limits_writes_and_cleans_up() {
        let m = PtyManager::default();
        let cwd = temp_cwd();
        let (sink, rx) = collect();
        let info = m
            .open(
                &interactive_spec(ShellKind::Cmd, Some(cwd.path().into()), 80, 24).unwrap(),
                sink,
            )
            .unwrap();
        assert!(info.pid > 0);
        assert!(matches!(
            m.write(info.session_id, &"x".repeat(MAX_WRITE_BYTES + 1)),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            m.resize(info.session_id, 0, 0),
            Err(AppError::Validation(_))
        ));
        m.close(info.session_id).unwrap();
        let (_, code) = drain(&rx, Duration::from_secs(10));
        assert!(code.is_some());
        assert!(matches!(
            m.write(info.session_id, "dir\r"),
            Err(AppError::NotFound(_))
        ));
        assert_eq!(m.count(), 0);
    }

    #[test]
    fn output_events_are_base64() {
        let e: PtyEvent = ProcessEvent::Output(b"hi\xff".to_vec()).into();
        assert_eq!(
            e,
            PtyEvent::Output {
                data: "aGn/".into()
            }
        );
        let json = serde_json::to_value(PtyEvent::Exit { code: 2 }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "exit", "code": 2 }));
    }
}
