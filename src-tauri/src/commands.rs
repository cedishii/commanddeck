//! Tauri command handlers: deserialize, delegate to `App`, serialize.
//! No logic lives here. Async so storage work never runs on the UI thread.

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::app::{App, CommandView, HomeView, ImportReport, SearchResult, StartupInfo};
use crate::catalog::Shell;
use crate::error::{AppError, AppResult};
use crate::store::{CustomDraft, Settings, SettingsPatch};

/// Managed state. If startup failed, the window still opens and every command
/// reports the startup error, so the user sees why instead of a vanished app.
pub struct Backend(pub Result<App, String>);

impl Backend {
    fn app(&self) -> AppResult<&App> {
        self.0
            .as_ref()
            .map_err(|e| AppError::Internal(format!("CommandDeck could not start: {e}")))
    }
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
