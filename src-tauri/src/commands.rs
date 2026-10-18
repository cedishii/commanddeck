//! Tauri command handlers: deserialize, delegate to `App`, serialize.
//! No logic lives here. Async so storage work never runs on the UI thread.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::pty::{self, EventSink, PtyEvent, PtyManager, SessionInfo, ShellInfo, ShellKind};

use crate::app::{
    App, CommandView, HistoryEntry, HomeView, ImportReport, Prepared, SearchResult, SecurityStatus,
    StartupInfo,
};
use crate::catalog::Shell;
use crate::error::{AppError, AppResult};
use crate::store::{CustomDraft, PasswordPolicy, Settings, SettingsPatch};

/// Managed state. If startup failed, the window still opens and every command
/// reports the startup error, so the user sees why instead of a vanished app.
pub struct Backend {
    pub app: Result<App, String>,
    pub pty: PtyManager,
    pub home_dir: Option<std::path::PathBuf>,
    /// Token state at startup. It can't change while the process runs.
    pub elevated: bool,
    /// Page requested on the command line (only after a restart as administrator).
    pub launch_page: Option<String>,
    pub analyzer: Arc<crate::security::Analyzer>,
}

impl Backend {
    fn app(&self) -> AppResult<&App> {
        self.app
            .as_ref()
            .map_err(|e| AppError::Internal(format!("CommandDeck could not start: {e}")))
    }
}

fn channel_sink(channel: Channel<PtyEvent>) -> EventSink {
    Arc::new(move |event| {
        // A closed webview just drops events; the session keeps running until closed.
        let _ = channel.send(PtyEvent::from(event));
    })
}

#[tauri::command]
pub async fn shells_list() -> AppResult<Vec<ShellInfo>> {
    Ok(pty::shells())
}

/// Starts an interactive shell. Only known shells can be started.
#[tauri::command]
pub async fn pty_open(
    b: B<'_>,
    shell: ShellKind,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> AppResult<SessionInfo> {
    let spec = pty::interactive_spec(shell, b.home_dir.clone(), cols, rows)?;
    if shell != ShellKind::Cmd {
        // Start the PowerShell parser now so the first command-bar check is fast.
        let analyzer = b.analyzer.clone();
        tauri::async_runtime::spawn_blocking(move || analyzer.warm_up_powershell());
    }
    b.pty.open(&spec, channel_sink(on_event))
}

/// Structural check of a command-bar line before it's sent (SECURITY.md §6.2).
/// Purely advisory: the text is never changed, and sending it doesn't depend on this.
#[tauri::command]
pub async fn bar_check(
    b: B<'_>,
    shell: ShellKind,
    text: String,
) -> AppResult<crate::security::Analysis> {
    let syntax = match shell {
        ShellKind::Cmd => crate::security::Syntax::Cmd,
        ShellKind::Powershell | ShellKind::Pwsh => crate::security::Syntax::PowerShell,
    };
    let analyzer = b.analyzer.clone();
    tauri::async_runtime::spawn_blocking(move || analyzer.analyze(syntax, &text))
        .await
        .map_err(|e| AppError::Internal(format!("check failed: {e}")))
}

/// Step 1 of a one-off run (SECURITY.md §5): validates the values, resolves the
/// exact text, analyzes it, and says what's needed before it may start.
/// The frontend names a command id and values; it never supplies command text.
#[tauri::command]
pub async fn exec_prepare(
    handle: AppHandle,
    id: String,
    params: HashMap<String, String>,
) -> AppResult<Prepared> {
    // Analysis may wait on the PowerShell parser; keep it off the async workers.
    tauri::async_runtime::spawn_blocking(move || {
        let b = handle.state::<Backend>();
        b.app()?
            .prepare(&b.analyzer, &id, &params, b.home_dir.as_deref(), b.elevated)
    })
    .await
    .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?
}

/// Step 2, only when confirmation or the password is needed: returns a single-use grant.
#[tauri::command]
pub async fn exec_authorize(
    b: B<'_>,
    prepare_id: String,
    confirmation: Option<String>,
    password: Option<String>,
) -> AppResult<String> {
    b.app()?
        .authorize(&prepare_id, confirmation.as_deref(), password.as_deref())
}

/// Step 3: re-derives the run, checks it matches what was prepared and authorized, starts it.
/// When the run ends, its metadata (not output) is added to run history.
#[tauri::command]
pub async fn exec_run(
    handle: AppHandle,
    b: B<'_>,
    prepare_id: String,
    grant: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> AppResult<SessionInfo> {
    let command = b.app()?.take_run(
        &prepare_id,
        grant.as_deref(),
        b.home_dir.as_deref(),
        b.elevated,
    )?;
    let spec = pty::run_spec(&command, b.home_dir.clone(), cols, rows)?;
    let started_at = crate::store::now_millis();
    let forward = channel_sink(on_event);
    let id = command.id;
    let sink: EventSink = Arc::new(move |event| {
        if let pty::ProcessEvent::Exit(code) = &event {
            let duration = crate::store::now_millis() - started_at;
            if let Ok(app) = handle.state::<Backend>().app() {
                let _ = app.record_run(&id, started_at, duration, Some(i64::from(*code)));
            }
        }
        forward(event);
    });
    b.pty.open(&spec, sink)
}

#[tauri::command]
pub async fn security_get(b: B<'_>) -> AppResult<SecurityStatus> {
    b.app()?.security_status()
}

#[tauri::command]
pub async fn security_set_password(
    b: B<'_>,
    current: Option<String>,
    password: String,
) -> AppResult<SecurityStatus> {
    b.app()?.set_password(current.as_deref(), &password)
}

#[tauri::command]
pub async fn security_remove_password(
    b: B<'_>,
    current: Option<String>,
) -> AppResult<SecurityStatus> {
    b.app()?.remove_password(current.as_deref())
}

#[tauri::command]
pub async fn security_set_policy(
    b: B<'_>,
    policy: PasswordPolicy,
    password: Option<String>,
) -> AppResult<SecurityStatus> {
    b.app()?.set_policy(&policy, password.as_deref())
}

#[tauri::command]
pub async fn security_set_advanced(
    b: B<'_>,
    enabled: bool,
    password: Option<String>,
) -> AppResult<SecurityStatus> {
    b.app()?.set_advanced_mode(enabled, password.as_deref())
}

#[tauri::command]
pub async fn history_get(b: B<'_>, limit: Option<i64>) -> AppResult<Vec<HistoryEntry>> {
    b.app()?.history(limit.unwrap_or(50))
}

#[tauri::command]
pub async fn history_clear(b: B<'_>) -> AppResult<()> {
    b.app()?.clear_history()
}

/// Keyboard input for a session or run, forwarded exactly as given.
#[tauri::command]
pub async fn pty_write(b: B<'_>, session_id: u64, data: String) -> AppResult<()> {
    b.pty.write(session_id, &data)
}

#[tauri::command]
pub async fn pty_resize(b: B<'_>, session_id: u64, cols: u16, rows: u16) -> AppResult<()> {
    b.pty.resize(session_id, cols, rows)
}

/// Ends a session or run and kills everything it started.
#[tauri::command]
pub async fn pty_close(b: B<'_>, session_id: u64) -> AppResult<()> {
    b.pty.close(session_id)
}

type B<'a> = State<'a, Backend>;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegeInfo {
    pub elevated: bool,
    pub launch_page: Option<String>,
}

/// Works even if startup failed, so the UI can always show the true token state.
#[tauri::command]
pub async fn privilege_get(b: B<'_>) -> AppResult<PrivilegeInfo> {
    Ok(PrivilegeInfo {
        elevated: b.elevated,
        launch_page: b.launch_page.clone(),
    })
}

/// Relaunches the whole app through UAC, then exits this instance.
/// Declining UAC returns a `conflict` error and this instance keeps running.
#[tauri::command]
pub async fn restart_elevated(
    handle: AppHandle,
    b: B<'_>,
    page: String,
    password: Option<String>,
) -> AppResult<()> {
    if b.elevated {
        return Err(AppError::Conflict(
            "CommandDeck is already running as administrator.".into(),
        ));
    }
    // If startup failed there's no stored policy to check; elevation is still UAC-gated.
    if let Ok(app) = b.app() {
        app.check_restart_allowed(password.as_deref())?;
    }
    crate::platform::relaunch_elevated(&page)?;
    // Exit shortly after replying. Closing ends every session's Job Object.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        handle.exit(0);
    });
    Ok(())
}

#[tauri::command]
pub async fn app_startup(b: B<'_>) -> AppResult<StartupInfo> {
    Ok(b.app()?.startup())
}

#[tauri::command]
pub async fn catalog_list(b: B<'_>, shell: Option<Shell>) -> AppResult<Vec<CommandView>> {
    b.app()?.list(shell)
}

#[tauri::command]
pub async fn catalog_get(b: B<'_>, id: String) -> AppResult<CommandView> {
    b.app()?.get(&id)
}

#[tauri::command]
pub async fn catalog_search(
    b: B<'_>,
    query: String,
    shell: Option<Shell>,
    limit: Option<usize>,
) -> AppResult<Vec<SearchResult>> {
    b.app()?.search(&query, shell, limit.unwrap_or(20))
}

#[tauri::command]
pub async fn catalog_open_source(
    handle: AppHandle,
    b: B<'_>,
    id: String,
    index: usize,
) -> AppResult<()> {
    let url = b.app()?.source_url(&id, index)?;
    handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Internal(format!("could not open the browser: {e}")))
}

#[tauri::command]
pub async fn home_get(b: B<'_>) -> AppResult<HomeView> {
    b.app()?.home()
}

#[tauri::command]
pub async fn home_add(b: B<'_>, id: String) -> AppResult<HomeView> {
    b.app()?.home_add(&id)
}

#[tauri::command]
pub async fn home_remove(b: B<'_>, id: String) -> AppResult<HomeView> {
    b.app()?.home_remove(&id)
}

#[tauri::command]
pub async fn home_move(b: B<'_>, id: String, to_index: usize) -> AppResult<HomeView> {
    b.app()?.home_move(&id, to_index)
}

#[tauri::command]
pub async fn home_update(
    b: B<'_>,
    id: String,
    label: Option<String>,
    note: Option<String>,
) -> AppResult<HomeView> {
    b.app()?.home_update(&id, label.as_deref(), note.as_deref())
}

#[tauri::command]
pub async fn settings_get(b: B<'_>) -> AppResult<Settings> {
    b.app()?.settings()
}

#[tauri::command]
pub async fn settings_update(b: B<'_>, patch: SettingsPatch) -> AppResult<Settings> {
    b.app()?.update_settings(&patch)
}

#[tauri::command]
pub async fn settings_reset(b: B<'_>) -> AppResult<Settings> {
    b.app()?.reset_preferences()
}

#[tauri::command]
pub async fn favorite_set(b: B<'_>, id: String, favorite: bool) -> AppResult<CommandView> {
    b.app()?.set_favorite(&id, favorite)
}

#[tauri::command]
pub async fn recent_record(b: B<'_>, id: String) -> AppResult<()> {
    b.app()?.record_recent(&id)
}

#[tauri::command]
pub async fn recents_get(b: B<'_>) -> AppResult<Vec<CommandView>> {
    b.app()?.recents()
}

#[tauri::command]
pub async fn recents_clear(b: B<'_>) -> AppResult<()> {
    b.app()?.clear_recents()
}

#[tauri::command]
pub async fn aliases_set(b: B<'_>, id: String, aliases: Vec<String>) -> AppResult<CommandView> {
    b.app()?.set_user_aliases(&id, &aliases)
}

#[tauri::command]
pub async fn custom_create(b: B<'_>, draft: CustomDraft) -> AppResult<CommandView> {
    b.app()?.custom_create(draft)
}

#[tauri::command]
pub async fn custom_update(b: B<'_>, id: String, draft: CustomDraft) -> AppResult<CommandView> {
    b.app()?.custom_update(&id, draft)
}

#[tauri::command]
pub async fn custom_delete(b: B<'_>, id: String) -> AppResult<()> {
    b.app()?.custom_delete(&id)
}

#[tauri::command]
pub async fn custom_export(b: B<'_>) -> AppResult<String> {
    b.app()?.custom_export()
}

#[tauri::command]
pub async fn custom_import(b: B<'_>, json: String) -> AppResult<ImportReport> {
    b.app()?.custom_import(&json)
}
