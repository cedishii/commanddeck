//! CommandDeck backend. See docs/ARCHITECTURE.md for the layer overview.

pub mod app;
pub mod catalog;
mod commands;
pub mod error;
pub mod pty;
pub mod store;

use tauri::Manager;

use crate::app::App;
use crate::store::Store;

const DB_FILE: &str = "commanddeck.db";

fn init_app(handle: &tauri::AppHandle) -> Result<App, String> {
    let builtin =
        catalog::load_builtin().map_err(|e| format!("built-in catalog is invalid: {e:?}"))?;
    // Debug builds only: tests point the app at a throwaway folder so they never
    // touch the owner's real data. Release builds always use the app data folder.
    let override_dir = if cfg!(debug_assertions) {
        std::env::var_os("COMMANDDECK_DATA_DIR").map(std::path::PathBuf::from)
    } else {
        None
    };
    let dir = match override_dir {
        Some(dir) => dir,
        None => handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("no app data folder: {e}"))?,
    };
    let opened = Store::open(&dir.join(DB_FILE)).map_err(|e| e.to_string())?;
    let notice = opened.recovered.map(|backup| {
        format!(
            "Your saved data could not be read, so CommandDeck started fresh. The damaged file was kept at {}.",
            backup.display()
        )
    });
    App::new(builtin, opened.store, notice).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = commands::Backend {
                app: init_app(app.handle()),
                pty: pty::PtyManager::default(),
                home_dir: app.path().home_dir().ok(),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_startup,
            commands::catalog_list,
            commands::catalog_get,
            commands::catalog_search,
            commands::catalog_open_source,
            commands::home_get,
            commands::home_add,
            commands::home_remove,
            commands::home_move,
            commands::home_update,
            commands::settings_get,
            commands::settings_update,
            commands::settings_reset,
            commands::favorite_set,
            commands::recent_record,
            commands::recents_get,
            commands::recents_clear,
            commands::aliases_set,
            commands::custom_create,
            commands::custom_update,
            commands::custom_delete,
            commands::custom_export,
            commands::custom_import,
            commands::shells_list,
            commands::pty_open,
            commands::run_start,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_close,
            commands::history_get,
            commands::history_clear,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the CommandDeck window");
}
