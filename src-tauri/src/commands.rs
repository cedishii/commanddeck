//! Tauri command handlers: deserialize, delegate to `App`, serialize.
//! No logic lives here. Async so storage work never runs on the UI thread.

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::pty::{self, EventSink, PtyEvent, PtyManager, SessionInfo, ShellInfo, ShellKind};

use crate::app::{App, CommandView, HomeView, ImportReport, SearchResult, StartupInfo};
use crate::catalog::Shell;
use crate::error::{AppError, AppResult};
use crate::store::{CustomDraft, Settings, SettingsPatch};

/// Managed state. If startup failed, the window still opens and every command
/// reports the startup error, so the user sees why instead of a vanished app.
pub struct Backend {
    pub app: Result<App, String>,
    pub pty: PtyManager,
    pub home_dir: Option<std::path::PathBuf>,
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
    b.pty.open(&spec, channel_sink(on_event))
}

/// One-off run of a catalog command by id. The frontend never supplies command text.
#[tauri::command]
pub async fn run_start(
    b: B<'_>,
    id: String,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> AppResult<SessionInfo> {
    let command = b.app()?.runnable_command(&id)?;
    let spec = pty::run_spec(&command, b.home_dir.clone(), cols, rows)?;
    b.pty.open(&spec, channel_sink(on_event))
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
