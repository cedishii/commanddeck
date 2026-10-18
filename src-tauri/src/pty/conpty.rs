//! Windows pseudoconsole (ConPTY) process host.
//!
//! All `unsafe` in CommandDeck lives here. Each process is:
//!   1. created SUSPENDED with a pseudoconsole attached,
//!   2. assigned to its own Job Object (KILL_ON_JOB_CLOSE) *before* it runs,
//!   3. resumed.
//!
//! So the shell and everything it launches belong to the job from the first
//! instruction. Killing the session (or CommandDeck exiting, which closes the
//! job handle) terminates the whole tree and nothing else.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
use windows::Win32::System::Console::{
    COORD, ClosePseudoConsole, CreatePseudoConsole, HPCON, ResizePseudoConsole,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, INFINITE, InitializeProcThreadAttributeList,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, PROCESS_INFORMATION,
    ResumeThread, STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute,
    WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

/// Events produced by a running process, in order. `Exit` is always last.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessEvent {
    Output(Vec<u8>),
    Exit(u32),
}

pub type EventSink = Arc<dyn Fn(ProcessEvent) + Send + Sync>;

/// What to start. `command_line` must begin with the quoted `program` path.
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub program: std::path::PathBuf,
    pub command_line: String,
    pub cwd: Option<std::path::PathBuf>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("could not start {program}: {source}")]
    Spawn {
        program: String,
        source: windows::core::Error,
    },
    #[error("{0}")]
    Os(#[from] windows::core::Error),
    #[error("the process has already exited")]
    Exited,
}

/// A kernel handle closed on drop. Kernel handles may be used from any thread.
struct OwnedHandle(HANDLE);
// SAFETY: Win32 kernel object handles are process-wide and thread-agnostic.
unsafe impl Send for OwnedHandle {}
// SAFETY: as above; all operations used on these handles are thread-safe syscalls.
unsafe impl Sync for OwnedHandle {}
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: we own the handle and close it exactly once.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

struct PseudoConsole(HPCON);
// SAFETY: an HPCON may be resized/closed from any thread (documented ConPTY usage).
unsafe impl Send for PseudoConsole {}
impl Drop for PseudoConsole {
    fn drop(&mut self) {
        // SAFETY: we own the pseudoconsole and close it exactly once.
        unsafe { ClosePseudoConsole(self.0) };
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_path(p: &Path) -> Vec<u16> {
    p.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn now_ms() -> u64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// A process running under ConPTY inside its own Job Object.
pub struct ConPtyProcess {
    pid: u32,
    input: Mutex<Option<OwnedHandle>>,
    console: Arc<Mutex<Option<PseudoConsole>>>,
    job: Arc<OwnedHandle>,
    exited: Arc<std::sync::atomic::AtomicBool>,
    waiter: Mutex<Option<JoinHandle<()>>>,
}

impl ConPtyProcess {
    pub fn spawn(spec: &SpawnSpec, sink: EventSink) -> Result<ConPtyProcess, PtyError> {
        let program_display = spec.program.display().to_string();
        let spawn_err = |source| PtyError::Spawn {
            program: program_display.clone(),
            source,
        };

        // Pipes: we write to `input_write`, ConPTY reads `input_read`; ConPTY writes `output_write`, we read `output_read`.
        let (mut input_read, mut input_write, mut output_read, mut output_write) = (
            HANDLE::default(),
            HANDLE::default(),
            HANDLE::default(),
            HANDLE::default(),
        );
        // SAFETY: out-pointers are valid locals; default security, default buffer size.
        unsafe {
            CreatePipe(&mut input_read, &mut input_write, None, 0)?;
            CreatePipe(&mut output_read, &mut output_write, None, 0)?;
        }
        let (input_read, input_write) = (OwnedHandle(input_read), OwnedHandle(input_write));
        let (output_read, output_write) = (OwnedHandle(output_read), OwnedHandle(output_write));

        let size = COORD {
            X: spec.cols.max(1) as i16,
            Y: spec.rows.max(1) as i16,
        };
        // Held until CreateProcessW returns: see `pty::SPAWN_LOCK`.
        let spawn_guard = super::SPAWN_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // SAFETY: pipe handles are valid; ConPTY duplicates what it needs.
        let hpc = unsafe { CreatePseudoConsole(size, input_read.0, output_write.0, 0)? };
        let console = PseudoConsole(hpc);
        // The pseudoconsole holds its own references; ours must close so EOF propagates.
        drop(input_read);
        drop(output_write);

        // Attribute list carrying the pseudoconsole.
        let mut attr_size = 0usize;
        // SAFETY: size query; the documented first call fails with ERROR_INSUFFICIENT_BUFFER.
        unsafe {
            let _ = InitializeProcThreadAttributeList(None, 1, None, &mut attr_size);
        }
        let mut attr_buf = vec![0u8; attr_size];
        let attr_list = LPPROC_THREAD_ATTRIBUTE_LIST(attr_buf.as_mut_ptr().cast());
        // SAFETY: buffer has the size the system asked for and outlives the list's use.
        unsafe {
            InitializeProcThreadAttributeList(Some(attr_list), 1, None, &mut attr_size)?;
            UpdateProcThreadAttribute(
                attr_list,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                Some(hpc.0 as *const c_void),
                std::mem::size_of::<HPCON>(),
                None,
                None,
            )?;
        }

        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.lpAttributeList = attr_list;
        // Don't let the child inherit CommandDeck's own (possibly redirected) std handles;
        // it must talk to the pseudoconsole only.
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
        startup.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
        startup.StartupInfo.hStdError = INVALID_HANDLE_VALUE;

        let application = wide_path(&spec.program);
        let mut command_line = wide(&spec.command_line);
        let cwd = spec.cwd.as_deref().map(wide_path);
        let mut info = PROCESS_INFORMATION::default();
        // SAFETY: all pointers reference live buffers for the duration of the call; the
        // command line buffer is mutable as CreateProcessW requires.
        let created = unsafe {
            CreateProcessW(
                PCWSTR(application.as_ptr()),
                Some(PWSTR(command_line.as_mut_ptr())),
                None,
                None,
                false,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
                None,
                cwd.as_ref().map_or(PCWSTR::null(), |c| PCWSTR(c.as_ptr())),
                &startup.StartupInfo,
                &mut info,
            )
        };
        // SAFETY: the list was initialized above and is no longer needed after CreateProcessW.
        unsafe { DeleteProcThreadAttributeList(attr_list) };
        drop(spawn_guard);
        created.map_err(spawn_err)?;
        let process = OwnedHandle(info.hProcess);
        let thread = OwnedHandle(info.hThread);

        // Job Object before the first instruction runs.
        let job = match Self::create_job() {
            Ok(job) => job,
            Err(e) => {
                // SAFETY: valid process handle we own; the suspended process never ran.
                unsafe {
                    let _ = windows::Win32::System::Threading::TerminateProcess(process.0, 1);
                }
                return Err(e);
            }
        };
        // SAFETY: both handles are valid; assignment of a suspended process.
        if let Err(e) = unsafe { AssignProcessToJobObject(job.0, process.0) } {
            // SAFETY: as above.
            unsafe {
                let _ = windows::Win32::System::Threading::TerminateProcess(process.0, 1);
            }
            return Err(e.into());
        }
        // SAFETY: valid thread handle of the suspended primary thread.
        unsafe { ResumeThread(thread.0) };
        drop(thread);

        let console = Arc::new(Mutex::new(Some(console)));
        let job = Arc::new(job);
        let exited = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let last_output = Arc::new(AtomicU64::new(now_ms()));

        // Reader: forwards output until the pseudoconsole closes the pipe.
        let reader = {
            let sink = sink.clone();
            let last_output = last_output.clone();
            std::thread::Builder::new()
                .name("pty-reader".into())
                .spawn(move || {
                    // Capture the whole Send wrapper, not just its raw field.
                    let output_read = output_read;
                    let mut buf = vec![0u8; 16 * 1024];
                    loop {
                        let mut read = 0u32;
                        // SAFETY: valid pipe handle; buffer and counter are live locals.
                        let ok = unsafe {
                            ReadFile(output_read.0, Some(&mut buf), Some(&mut read), None)
                        };
                        if ok.is_err() || read == 0 {
                            break;
                        }
                        last_output.store(now_ms(), Ordering::Relaxed);
                        sink(ProcessEvent::Output(buf[..read as usize].to_vec()));
                    }
                })
                .map_err(|e| {
                    PtyError::Os(windows::core::Error::new(
                        windows::core::HRESULT(-1),
                        e.to_string(),
                    ))
                })?
        };

        // Waiter: process exit → let final output drain → close the pseudoconsole → Exit event last.
        let waiter = {
            let console = console.clone();
            let exited = exited.clone();
            std::thread::Builder::new()
                .name("pty-waiter".into())
                .spawn(move || {
                    let process = process;
                    // SAFETY: valid process handle owned by this thread.
                    unsafe { WaitForSingleObject(process.0, INFINITE) };
                    let mut code = 0u32;
                    // SAFETY: valid process handle; out-pointer is a live local.
                    unsafe {
                        let _ = GetExitCodeProcess(process.0, &mut code);
                    }
                    exited.store(true, Ordering::SeqCst);
                    // ConPTY may still be rendering the last frame: wait for output to go quiet (max 2 s).
                    let deadline = now_ms() + 2000;
                    while now_ms() < deadline
                        && now_ms().saturating_sub(last_output.load(Ordering::Relaxed)) < 150
                    {
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    if let Ok(mut guard) = console.lock() {
                        guard.take(); // ClosePseudoConsole → reader sees EOF
                    }
                    let _ = reader.join();
                    sink(ProcessEvent::Exit(code));
                })
                .map_err(|e| {
                    PtyError::Os(windows::core::Error::new(
                        windows::core::HRESULT(-1),
                        e.to_string(),
                    ))
                })?
        };

        Ok(ConPtyProcess {
            pid: info.dwProcessId,
            input: Mutex::new(Some(input_write)),
            console,
            job,
            exited,
            waiter: Mutex::new(Some(waiter)),
        })
    }

    fn create_job() -> Result<OwnedHandle, PtyError> {
        // SAFETY: anonymous job with default security.
        let job = OwnedHandle(unsafe { CreateJobObjectW(None, PCWSTR::null())? });
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: pointer and size describe a live, correctly typed struct.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )?;
        }
        Ok(job)
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn has_exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }

    /// Sends bytes as keyboard input (UTF-8, VT sequences), exactly as given.
    pub fn write(&self, data: &[u8]) -> Result<(), PtyError> {
        if self.has_exited() {
            return Err(PtyError::Exited);
        }
        let guard = self.input.lock().map_err(|_| PtyError::Exited)?;
        let handle = guard.as_ref().ok_or(PtyError::Exited)?;
        let mut offset = 0;
        while offset < data.len() {
            let mut written = 0u32;
            // SAFETY: valid pipe handle; slice and counter are live.
            unsafe { WriteFile(handle.0, Some(&data[offset..]), Some(&mut written), None)? };
            offset += written as usize;
        }
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        let guard = self.console.lock().map_err(|_| PtyError::Exited)?;
        let console = guard.as_ref().ok_or(PtyError::Exited)?;
        // SAFETY: valid pseudoconsole handle while held under the lock.
        unsafe {
            ResizePseudoConsole(
                console.0,
                COORD {
                    X: cols.max(1) as i16,
                    Y: rows.max(1) as i16,
                },
            )?
        };
        Ok(())
    }

    /// Terminates the process and everything it started (the whole job).
    pub fn kill(&self) -> Result<(), PtyError> {
        // SAFETY: valid job handle.
        unsafe { TerminateJobObject(self.job.0, 1)? };
        Ok(())
    }

    /// Number of live processes in the job (the shell plus anything it started).
    pub fn active_processes(&self) -> Result<u32, PtyError> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        // SAFETY: pointer and size describe a live, correctly typed struct.
        unsafe {
            QueryInformationJobObject(
                Some(self.job.0),
                JobObjectBasicAccountingInformation,
                (&mut info as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                None,
            )?;
        }
        Ok(info.ActiveProcesses)
    }

    /// Blocks until the Exit event has been delivered (tests and shutdown).
    pub fn wait(&self) {
        if let Ok(mut guard) = self.waiter.lock()
            && let Some(handle) = guard.take()
        {
            let _ = handle.join();
        }
    }
}

impl Drop for ConPtyProcess {
    fn drop(&mut self) {
        // Closing the last job handle kills the tree (KILL_ON_JOB_CLOSE); be explicit anyway.
        if !self.has_exited() {
            let _ = self.kill();
        }
        if let Ok(mut input) = self.input.lock() {
            input.take();
        }
    }
}
