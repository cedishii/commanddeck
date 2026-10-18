//! Application layer: combines the built-in catalog with the user's stored data.
//! Every rule (limits, validation, alias conflicts) is enforced here, never only in the UI.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::catalog::{self, Command, Shell, Source};
use crate::error::{AppError, AppResult, FieldError};
use crate::store::{CustomDraft, Settings, SettingsPatch, Store, now_millis};

mod exec;
pub use exec::{Prepared, SecurityStatus};

/// Seeded on first run: 8 of the default 10 slots, so "Add command" works
/// immediately. Any id missing from the catalog is skipped.
const DEFAULT_HOME: &[&str] = &[
    "cmd.ping",
    "cmd.ipconfig.all",
    "cmd.ipconfig.flushdns",
    "cmd.netstat.ano",
    "cmd.dir",
    "ps.get-process",
    "ps.largest-files",
    "cmd.sfc.scannow",
];

const USER_ALIASES_MAX: usize = 10;
pub const IMPORT_BYTES_MAX: usize = 1_000_000;
pub const IMPORT_COMMANDS_MAX: usize = 500;
const EXPORT_FORMAT: &str = "commanddeck.custom-commands";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandView {
    #[serde(flatten)]
    pub command: Command,
    pub favorite: bool,
    pub on_home: bool,
    pub user_aliases: Vec<String>,
    /// Custom commands only: chains, pipes, spans lines or runs a script.
    pub multi_step: bool,
    /// One-click Run is allowed (see `run_block_reason`).
    pub runnable: bool,
    pub run_blocked_reason: Option<String>,
}

/// Why a command can't be run with one click, or `None` if it can.
///
/// Risk never blocks a run: it decides what confirmation is needed (`exec`).
/// Free-form custom scripts (chaining, pipes, several lines) run with one
/// click only in Advanced Mode (SECURITY.md §6.3). Elsewhere they open in the
/// terminal, where the user reviews them and presses Enter.
pub fn run_block_reason(c: &Command, advanced_mode: bool) -> Option<&'static str> {
    if c.shell == Shell::Cmd && c.syntax.contains(['\r', '\n']) {
        Some("Multi-line CMD commands can only be run from the terminal.")
    } else if c.source == Source::Custom
        && !advanced_mode
        && catalog::is_multi_step(c.shell, &c.syntax)
    {
        Some(
            "Multi-step custom commands run with one click only in Advanced Mode. Open it in the terminal instead.",
        )
    } else {
        None
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickActionView {
    pub command: CommandView,
    pub label: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeView {
    pub limit: u32,
    pub items: Vec<QuickActionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub command: CommandView,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    #[serde(flatten)]
    pub row: crate::store::HistoryRow,
    pub name: String,
    pub shell: Option<Shell>,
    /// False when the command was deleted since it ran.
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub notice: Option<String>,
    pub builtin_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportFile {
    format: String,
    version: u32,
    commands: Vec<CustomDraft>,
}

pub struct App {
    builtin: Vec<Command>,
    store: Mutex<Store>,
    notice: Option<String>,
    exec: exec::ExecState,
}

impl App {
    pub fn new(builtin: Vec<Command>, store: Store, notice: Option<String>) -> AppResult<App> {
        let app = App {
            builtin,
            store: Mutex::new(store),
            notice,
            exec: exec::ExecState::default(),
        };
        app.with_store(|store| {
            let commands = app.all_commands(store)?;
            let known: HashSet<&str> = commands.iter().map(|c| c.id.as_str()).collect();
            store.prune_missing(&|id| known.contains(id))?;
            if !store.is_seeded()? {
                let ids: Vec<&str> = DEFAULT_HOME
                    .iter()
                    .copied()
                    .filter(|id| known.contains(id))
                    .collect();
                store.replace_quick_actions(&ids)?;
                store.mark_seeded()?;
            }
            Ok(())
        })?;
        Ok(app)
    }

    fn with_store<T>(&self, f: impl FnOnce(&mut Store) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| AppError::Internal("storage lock poisoned".into()))?;
        f(&mut guard)
    }

    fn all_commands(&self, store: &Store) -> AppResult<Vec<Command>> {
        let mut all = self.builtin.clone();
        all.extend(store.custom_commands()?);
        Ok(all)
    }

    fn find<'a>(commands: &'a [Command], id: &str) -> AppResult<&'a Command> {
        commands
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::NotFound(format!("Unknown command '{id}'.")))
    }

    fn user_alias_map(store: &Store) -> AppResult<HashMap<String, Vec<String>>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for (_, alias, id) in store.user_aliases()? {
            map.entry(id).or_default().push(alias);
        }
        Ok(map)
    }

    fn views(store: &Store, commands: Vec<Command>) -> AppResult<Vec<CommandView>> {
        let favorites: HashSet<String> = store.favorites()?.into_iter().collect();
        let home: HashSet<String> = store
            .quick_actions()?
            .into_iter()
            .map(|r| r.command_id)
            .collect();
        let mut aliases = Self::user_alias_map(store)?;
        let advanced = store.security()?.advanced_mode;
        Ok(commands
            .into_iter()
            .map(|c| CommandView {
                favorite: favorites.contains(&c.id),
                on_home: home.contains(&c.id),
                user_aliases: aliases.remove(&c.id).unwrap_or_default(),
                multi_step: c.source == Source::Custom
                    && catalog::is_multi_step(c.shell, &c.syntax),
                runnable: run_block_reason(&c, advanced).is_none(),
                run_blocked_reason: run_block_reason(&c, advanced).map(String::from),
                command: c,
            })
            .collect())
    }

    // ---- catalog ------------------------------------------------------------

    pub fn startup(&self) -> StartupInfo {
        StartupInfo {
            notice: self.notice.clone(),
            builtin_count: self.builtin.len(),
        }
    }

    pub fn list(&self, shell: Option<Shell>) -> AppResult<Vec<CommandView>> {
        self.with_store(|store| {
            let commands = self
                .all_commands(store)?
                .into_iter()
                .filter(|c| shell.is_none_or(|s| c.shell == s))
                .collect();
            Self::views(store, commands)
        })
    }

    pub fn get(&self, id: &str) -> AppResult<CommandView> {
        self.with_store(|store| {
            let commands = self.all_commands(store)?;
            let c = Self::find(&commands, id)?.clone();
            Ok(Self::views(store, vec![c])?.remove(0))
        })
    }

    pub fn search(
        &self,
        query: &str,
        shell: Option<Shell>,
        limit: usize,
    ) -> AppResult<Vec<SearchResult>> {
        if query.chars().count() > 200 {
            return Err(AppError::invalid("query", "must be at most 200 characters"));
        }
        self.with_store(|store| {
            let commands = self.all_commands(store)?;
            let aliases = Self::user_alias_map(store)?;
            let hits = catalog::search::search(&commands, &aliases, query, shell, limit.min(50));
            let scores: Vec<f32> = hits.iter().map(|h| h.score).collect();
            let picked = hits.iter().map(|h| commands[h.index].clone()).collect();
            Ok(Self::views(store, picked)?
                .into_iter()
                .zip(scores)
                .map(|(command, score)| SearchResult { command, score })
                .collect())
        })
    }

    pub fn source_url(&self, id: &str, index: usize) -> AppResult<String> {
        // Only URLs that are part of the built-in catalog are ever opened.
        let c = Self::find(&self.builtin, id)?;
        c.sources
            .get(index)
            .cloned()
            .ok_or_else(|| AppError::NotFound("No such source.".into()))
    }

    // ---- Home -------------------------------------------------------------

    pub fn home(&self) -> AppResult<HomeView> {
        self.with_store(|store| {
            let limit = store.settings()?.quick_action_limit;
            let commands = self.all_commands(store)?;
            let rows = store.quick_actions()?;
            let picked: Vec<Command> = rows
                .iter()
                .filter_map(|r| commands.iter().find(|c| c.id == r.command_id).cloned())
                .collect();
            let views = Self::views(store, picked)?;
            let items = views
                .into_iter()
                .map(|v| {
                    let row = rows.iter().find(|r| r.command_id == v.command.id);
                    QuickActionView {
                        label: row.and_then(|r| r.label.clone()),
                        note: row.and_then(|r| r.note.clone()),
                        command: v,
                    }
                })
                .collect();
            Ok(HomeView { limit, items })
        })
    }

    pub fn home_add(&self, id: &str) -> AppResult<HomeView> {
        self.with_store(|store| {
            Self::find(&self.all_commands(store)?, id)?;
            let limit = store.settings()?.quick_action_limit;
            store.add_quick_action(id, limit)
        })?;
        self.home()
    }

    pub fn home_remove(&self, id: &str) -> AppResult<HomeView> {
        self.with_store(|store| store.remove_quick_action(id))?;
        self.home()
    }

    pub fn home_move(&self, id: &str, to_index: usize) -> AppResult<HomeView> {
        self.with_store(|store| store.move_quick_action(id, to_index))?;
        self.home()
    }

    pub fn home_update(
        &self,
        id: &str,
        label: Option<&str>,
        note: Option<&str>,
    ) -> AppResult<HomeView> {
        self.with_store(|store| store.update_quick_action(id, label, note))?;
        self.home()
    }

    // ---- settings, favorites, recents --------------------------------------

    pub fn settings(&self) -> AppResult<Settings> {
        self.with_store(|store| store.settings())
    }

    pub fn update_settings(&self, patch: &SettingsPatch) -> AppResult<Settings> {
        self.with_store(|store| store.update_settings(patch))
    }

    pub fn reset_preferences(&self) -> AppResult<Settings> {
        self.with_store(|store| {
            store.reset_preferences()?;
            let known: HashSet<String> = self
                .all_commands(store)?
                .into_iter()
                .map(|c| c.id)
                .collect();
            let ids: Vec<&str> = DEFAULT_HOME
                .iter()
                .copied()
                .filter(|id| known.contains(*id))
                .collect();
            store.replace_quick_actions(&ids)?;
            store.mark_seeded()?;
            store.settings()
        })
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> AppResult<CommandView> {
        self.with_store(|store| {
            Self::find(&self.all_commands(store)?, id)?;
            store.set_favorite(id, favorite)
        })?;
        self.get(id)
    }

    pub fn record_recent(&self, id: &str) -> AppResult<()> {
        self.with_store(|store| {
            Self::find(&self.all_commands(store)?, id)?;
            store.record_recent(id, now_millis())
        })
    }

    pub fn recents(&self) -> AppResult<Vec<CommandView>> {
        self.with_store(|store| {
            let commands = self.all_commands(store)?;
            let picked = store
                .recents()?
                .iter()
                .filter_map(|id| commands.iter().find(|c| &c.id == id).cloned())
                .collect();
            Self::views(store, picked)
        })
    }

    pub fn clear_recents(&self) -> AppResult<()> {
        self.with_store(|store| store.clear_recents())
    }

    // ---- run history ------------------------------------------------------------

    pub fn record_run(
        &self,
        id: &str,
        started_at: i64,
        duration_ms: i64,
        exit_code: Option<i64>,
    ) -> AppResult<()> {
        self.with_store(|store| store.record_run(id, started_at, duration_ms, exit_code))
    }

    /// Recent runs, newest first, with the command's current name and shell.
    pub fn history(&self, limit: i64) -> AppResult<Vec<HistoryEntry>> {
        self.with_store(|store| {
            let commands = self.all_commands(store)?;
            Ok(store
                .history(limit.clamp(1, crate::store::HISTORY_MAX_ROWS))?
                .into_iter()
                .map(|row| {
                    let command = commands.iter().find(|c| c.id == row.command_id);
                    HistoryEntry {
                        name: command.map_or_else(|| row.command_id.clone(), |c| c.name.clone()),
                        shell: command.map(|c| c.shell),
                        exists: command.is_some(),
                        row,
                    }
                })
                .collect())
        })
    }

    pub fn clear_history(&self) -> AppResult<()> {
        self.with_store(|store| store.clear_history())
    }

    // ---- aliases --------------------------------------------------------------

    /// Every alias in use for `shell`, with its owner, excluding `except_id`.
    fn aliases_in_use(
        &self,
        store: &Store,
        shell: Shell,
        except_id: Option<&str>,
    ) -> AppResult<HashMap<String, String>> {
        let mut used = HashMap::new();
        for c in self
            .all_commands(store)?
            .iter()
            .filter(|c| c.shell == shell && Some(c.id.as_str()) != except_id)
        {
            for a in &c.aliases {
                used.insert(a.clone(), c.name.clone());
            }
        }
        let commands = self.all_commands(store)?;
        for (s, alias, id) in store.user_aliases()? {
            if s == shell && Some(id.as_str()) != except_id {
                let owner = commands
                    .iter()
                    .find(|c| c.id == id)
                    .map(|c| c.name.clone())
                    .unwrap_or(id);
                used.insert(alias, owner);
            }
        }
        Ok(used)
    }

    fn normalize_aliases(aliases: &[String]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for a in aliases
            .iter()
            .map(|a| a.trim().to_lowercase())
            .filter(|a| !a.is_empty())
        {
            if !out.contains(&a) {
                out.push(a);
            }
        }
        out
    }

    fn check_alias_conflicts(
        field: &str,
        aliases: &[String],
        used: &HashMap<String, String>,
        out: &mut Vec<FieldError>,
    ) {
        for a in aliases {
            if let Some(owner) = used.get(a) {
                out.push(FieldError::new(
                    field,
                    format!("alias '{a}' is already used by \"{owner}\""),
                ));
            }
        }
    }

    pub fn set_user_aliases(&self, id: &str, aliases: &[String]) -> AppResult<CommandView> {
        let aliases = Self::normalize_aliases(aliases);
        self.with_store(|store| {
            let commands = self.all_commands(store)?;
            let c = Self::find(&commands, id)?;
            let mut errors = Vec::new();
            if aliases.len() > USER_ALIASES_MAX {
                errors.push(FieldError::new(
                    "aliases",
                    format!("at most {USER_ALIASES_MAX} personal aliases"),
                ));
            }
            for a in &aliases {
                if !catalog::valid_alias(a) {
                    errors.push(FieldError::new(
                        "aliases",
                        format!("'{a}' must be lowercase letters, digits, space, '.', '_' or '-'"),
                    ));
                }
            }
            let mut used = self.aliases_in_use(store, c.shell, Some(id))?;
            // The command's own built-in aliases are not "personal" ones.
            for a in &c.aliases {
                used.insert(a.clone(), c.name.clone());
            }
            Self::check_alias_conflicts("aliases", &aliases, &used, &mut errors);
            if !errors.is_empty() {
                return Err(AppError::Validation(errors));
            }
            store.replace_user_aliases(c.shell, id, &aliases)
        })?;
        self.get(id)
    }

    // ---- custom commands ------------------------------------------------------

    fn new_custom_id(store: &Store, salt: usize) -> AppResult<String> {
        let base = now_millis() as u64;
        for n in 0..1000u64 {
            let id = format!(
                "custom.{:x}{:02x}",
                base,
                (salt as u64).wrapping_add(n) % 256
            );
            if !store.custom_id_exists(&id)? {
                return Ok(id);
            }
        }
        Err(AppError::Internal(
            "could not allocate a custom command id".into(),
        ))
    }

    /// Validates a draft as a command, including alias conflicts with `used`.
    fn validate_custom(
        draft: CustomDraft,
        id: String,
        used: &HashMap<String, String>,
    ) -> Result<Command, Vec<FieldError>> {
        let mut draft = draft;
        draft.aliases = Self::normalize_aliases(&draft.aliases);
        draft.keywords = draft
            .keywords
            .iter()
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
            .collect();
        let command = draft.into_command(id);
        let mut errors = catalog::validate_command(&command);
        Self::check_alias_conflicts("aliases", &command.aliases, used, &mut errors);
        if errors.is_empty() {
            Ok(command)
        } else {
            Err(errors)
        }
    }

    pub fn custom_create(&self, draft: CustomDraft) -> AppResult<CommandView> {
        let id = self.with_store(|store| {
            let used = self.aliases_in_use(store, draft.shell, None)?;
            let id = Self::new_custom_id(store, 0)?;
            let command =
                Self::validate_custom(draft, id.clone(), &used).map_err(AppError::Validation)?;
            store.insert_custom(&[command])?;
            Ok(id)
        })?;
        self.get(&id)
    }

    pub fn custom_update(&self, id: &str, draft: CustomDraft) -> AppResult<CommandView> {
        self.with_store(|store| {
            let existing = store.custom_commands()?.into_iter().find(|c| c.id == id);
            let existing =
                existing.ok_or_else(|| AppError::NotFound("Custom command not found.".into()))?;
            if existing.shell != draft.shell {
                // Changing shell would silently reinterpret the syntax in another language.
                return Err(AppError::invalid(
                    "shell",
                    "can't be changed; create a new command for the other shell",
                ));
            }
            let used = self.aliases_in_use(store, draft.shell, Some(id))?;
            let command = Self::validate_custom(draft, id.to_string(), &used)
                .map_err(AppError::Validation)?;
            store.update_custom(&command)
        })?;
        self.get(id)
    }

    pub fn custom_delete(&self, id: &str) -> AppResult<()> {
        self.with_store(|store| store.delete_custom(id))
    }

    pub fn custom_export(&self) -> AppResult<String> {
        self.with_store(|store| {
            let commands = store
                .custom_commands()?
                .iter()
                .map(CustomDraft::from_command)
                .collect();
            let file = ExportFile {
                format: EXPORT_FORMAT.into(),
                version: 1,
                commands,
            };
            Ok(serde_json::to_string_pretty(&file)?)
        })
    }

    /// All-or-nothing import. Every entry is validated before anything is written.
    pub fn custom_import(&self, json: &str) -> AppResult<ImportReport> {
        if json.len() > IMPORT_BYTES_MAX {
            return Err(AppError::invalid("file", "is larger than 1 MB"));
        }
        let file: ExportFile = serde_json::from_str(json)
            .map_err(|e| AppError::invalid("file", &format!("is not a CommandDeck export: {e}")))?;
        if file.format != EXPORT_FORMAT || file.version != 1 {
            return Err(AppError::invalid(
                "file",
                "is not a CommandDeck custom-commands export (version 1)",
            ));
        }
        if file.commands.len() > IMPORT_COMMANDS_MAX {
            return Err(AppError::invalid(
                "file",
                &format!("contains more than {IMPORT_COMMANDS_MAX} commands"),
            ));
        }
        self.with_store(|store| {
            let mut used_by_shell: HashMap<Shell, HashMap<String, String>> = HashMap::new();
            for shell in [Shell::Cmd, Shell::Powershell] {
                used_by_shell.insert(shell, self.aliases_in_use(store, shell, None)?);
            }
            let mut commands = Vec::new();
            let mut errors = Vec::new();
            for (i, draft) in file.commands.into_iter().enumerate() {
                let shell = draft.shell;
                let id = Self::new_custom_id(store, i)?;
                let used = used_by_shell.entry(shell).or_default();
                match Self::validate_custom(draft, id, used) {
                    Ok(c) => {
                        for a in &c.aliases {
                            used.insert(a.clone(), c.name.clone());
                        }
                        commands.push(c);
                    }
                    Err(es) => {
                        errors.extend(es.into_iter().map(|e| {
                            FieldError::new(format!("commands[{i}].{}", e.field), e.message)
                        }))
                    }
                }
            }
            let ids: HashSet<&str> = commands.iter().map(|c| c.id.as_str()).collect();
            if ids.len() != commands.len() {
                return Err(AppError::Internal(
                    "duplicate ids generated during import".into(),
                ));
            }
            if !errors.is_empty() {
                return Err(AppError::Validation(errors));
            }
            store.insert_custom(&commands)?;
            Ok(ImportReport {
                imported: commands.len(),
            })
        })
    }
}

/// True for commands the user created. Their declared risk is informational only.
pub fn is_custom(c: &Command) -> bool {
    c.source == Source::Custom
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Category, Risk, load_builtin};

    fn app() -> App {
        App::new(
            load_builtin().unwrap(),
            Store::open_in_memory().unwrap(),
            None,
        )
        .unwrap()
    }

    fn draft(name: &str) -> CustomDraft {
        CustomDraft {
            shell: Shell::Powershell,
            name: name.into(),
            summary: "Lists git branches.".into(),
            category: Category::Automation,
            syntax: "git branch --all".into(),
            keywords: vec!["git".into()],
            aliases: vec!["gb".into()],
            notes: None,
            requires_admin: false,
            modifies: false,
            risk: Risk::L1,
            placeholders: vec![],
        }
    }

    #[test]
    fn first_run_seeds_default_home_once() {
        let a = app();
        let home = a.home().unwrap();
        assert_eq!(home.limit, 10);
        assert_eq!(home.items.len(), 8, "first run leaves room to add commands");
        assert_eq!(home.items[0].command.command.id, "cmd.ping");
        a.home_remove("cmd.ping").unwrap();
        // Re-creating App over the same store must not re-seed.
        let store = a.store.into_inner().unwrap();
        let again = App::new(load_builtin().unwrap(), store, None).unwrap();
        assert_eq!(again.home().unwrap().items.len(), 7);
    }

    #[test]
    fn home_rejects_unknown_commands_and_enforces_limit() {
        let a = app();
        assert!(matches!(a.home_add("cmd.nope"), Err(AppError::NotFound(_))));
        a.home_add("ps.test-port").unwrap();
        a.home_add("ps.system-errors").unwrap();
        assert!(matches!(a.home_add("cmd.tree"), Err(AppError::Limit(_))));
        a.update_settings(&SettingsPatch {
            quick_action_limit: Some(15),
            ..Default::default()
        })
        .unwrap();
        let home = a.home_add("cmd.tree").unwrap();
        assert_eq!(home.items.last().unwrap().command.command.id, "cmd.tree");
        assert!(home.items.last().unwrap().command.on_home);
    }

    #[test]
    fn home_labels_do_not_change_the_command() {
        let a = app();
        let home = a
            .home_update("cmd.ping", Some("Is Google up?"), Some("my note"))
            .unwrap();
        let item = &home.items[0];
        assert_eq!(item.label.as_deref(), Some("Is Google up?"));
        assert_eq!(item.command.command.name, "Check network connectivity");
        assert_eq!(item.command.command.syntax, "ping google.com");
    }

    #[test]
    fn custom_command_lifecycle_and_cleanup() {
        let a = app();
        let created = a.custom_create(draft("Git branches")).unwrap();
        let id = created.command.id.clone();
        assert!(id.starts_with("custom."));
        assert_eq!(created.command.source, Source::Custom);
        assert_eq!(a.search("gb", None, 1).unwrap()[0].command.command.id, id);

        a.update_settings(&SettingsPatch {
            quick_action_limit: Some(15),
            ..Default::default()
        })
        .unwrap();
        a.home_add(&id).unwrap();
        a.set_favorite(&id, true).unwrap();

        let mut changed = draft("Git branches (all)");
        changed.syntax = "git branch -a".into();
        assert_eq!(
            a.custom_update(&id, changed).unwrap().command.syntax,
            "git branch -a"
        );

        a.custom_delete(&id).unwrap();
        assert!(matches!(a.get(&id), Err(AppError::NotFound(_))));
        assert!(
            !a.home()
                .unwrap()
                .items
                .iter()
                .any(|i| i.command.command.id == id)
        );
    }

    #[test]
    fn custom_command_validation_reports_fields() {
        let a = app();
        let mut bad = draft("");
        bad.syntax = "run <Thing>".into();
        bad.aliases = vec!["dir".into()]; // built-in PowerShell alias of Get-ChildItem
        let Err(AppError::Validation(errors)) = a.custom_create(bad) else {
            panic!("expected validation error")
        };
        let fields: Vec<&str> = errors.iter().map(|e| e.field.as_str()).collect();
        assert!(fields.contains(&"name"));
        assert!(fields.contains(&"placeholders"));
        assert!(fields.contains(&"aliases"), "{errors:?}");
    }

    #[test]
    fn custom_shell_cannot_be_changed() {
        let a = app();
        let id = a.custom_create(draft("Git branches")).unwrap().command.id;
        let mut other = draft("Git branches");
        other.shell = Shell::Cmd;
        other.category = Category::Files;
        assert!(matches!(
            a.custom_update(&id, other),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn declared_safe_custom_entries_are_marked_custom() {
        let a = app();
        let mut d = draft("Wipe");
        d.syntax = "Format-Volume -DriveLetter D".into();
        d.risk = Risk::L1; // user claims it's routine
        let c = a.custom_create(d).unwrap();
        assert!(
            is_custom(&c.command),
            "execution policy must treat this as unanalyzed custom input"
        );
    }

    #[test]
    fn user_aliases_validate_and_conflict_check() {
        let a = app();
        let v = a
            .set_user_aliases("ps.uptime", &["HowLong".into(), "howlong".into()])
            .unwrap();
        assert_eq!(v.user_aliases, ["howlong"]);
        assert!(matches!(
            a.set_user_aliases("ps.volumes", &["howlong".into()]),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            a.set_user_aliases("ps.volumes", &["ls".into()]),
            Err(AppError::Validation(_))
        ));
        // Same alias in the other shell is allowed.
        a.set_user_aliases("cmd.systeminfo", &["howlong".into()])
            .unwrap();
        assert!(matches!(
            a.set_user_aliases("ps.volumes", &["bad;alias".into()]),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn export_import_round_trip_is_all_or_nothing() {
        let a = app();
        a.custom_create(draft("Git branches")).unwrap();
        let exported = a.custom_export().unwrap();

        let b = app();
        assert_eq!(b.custom_import(&exported).unwrap().imported, 1);
        // Importing again collides on alias "gb": nothing is written.
        let Err(AppError::Validation(errors)) = b.custom_import(&exported) else {
            panic!("expected conflict")
        };
        assert!(errors[0].field.starts_with("commands[0]."));
        assert_eq!(
            b.list(None)
                .unwrap()
                .iter()
                .filter(|c| is_custom(&c.command))
                .count(),
            1
        );
    }

    #[test]
    fn import_rejects_malformed_and_oversized_input() {
        let a = app();
        assert!(matches!(
            a.custom_import("not json"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            a.custom_import(r#"{"format":"other","version":1,"commands":[]}"#),
            Err(AppError::Validation(_))
        ));
        let big = "x".repeat(IMPORT_BYTES_MAX + 1);
        assert!(matches!(
            a.custom_import(&big),
            Err(AppError::Validation(_))
        ));
        let unknown_field = r#"{"format":"commanddeck.custom-commands","version":1,"commands":[{"shell":"cmd","name":"x","summary":"y","category":"files","syntax":"dir","requiresAdmin":false,"modifies":false,"risk":"L1","elevate":true}]}"#;
        assert!(matches!(
            a.custom_import(unknown_field),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn source_urls_come_only_from_the_builtin_catalog() {
        let a = app();
        assert!(
            a.source_url("cmd.ping", 0)
                .unwrap()
                .starts_with("https://learn.microsoft.com/")
        );
        assert!(a.source_url("cmd.ping", 5).is_err());
        let id = a.custom_create(draft("Git branches")).unwrap().command.id;
        assert!(a.source_url(&id, 0).is_err());
    }

    #[test]
    fn recents_track_existing_commands_only() {
        let a = app();
        a.record_recent("cmd.tree").unwrap();
        a.record_recent("cmd.ping").unwrap();
        assert!(a.record_recent("cmd.missing").is_err());
        let r: Vec<String> = a
            .recents()
            .unwrap()
            .into_iter()
            .map(|v| v.command.id)
            .collect();
        assert_eq!(r, ["cmd.ping", "cmd.tree"]);
    }

    #[test]
    fn reset_preferences_restores_defaults_but_keeps_custom_commands() {
        let a = app();
        a.custom_create(draft("Git branches")).unwrap();
        a.update_settings(&SettingsPatch {
            quick_action_limit: Some(15),
            theme: Some(crate::store::Theme::Dark),
            terminal_font_size: Some(18),
            ..Default::default()
        })
        .unwrap();
        a.home_remove("cmd.ping").unwrap();
        let s = a.reset_preferences().unwrap();
        assert_eq!(s, Settings::default());
        assert_eq!(a.home().unwrap().items.len(), 8);
        assert_eq!(
            a.list(None)
                .unwrap()
                .iter()
                .filter(|c| is_custom(&c.command))
                .count(),
            1
        );
    }

    // ---- prepare / authorize / run (SECURITY.md §5) ---------------------------

    fn analyzer() -> crate::security::Analyzer {
        crate::security::Analyzer::default()
    }

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect()
    }

    fn cmd_draft(name: &str, syntax: &str, risk: Risk) -> CustomDraft {
        CustomDraft {
            shell: Shell::Cmd,
            syntax: syntax.into(),
            aliases: vec![],
            category: Category::Administration,
            risk,
            modifies: risk != Risk::L1,
            ..draft(name)
        }
    }

    #[test]
    fn routine_runs_start_without_confirmation_and_are_single_use() {
        let a = app();
        let p = a
            .prepare(&analyzer(), "cmd.ipconfig.all", &values(&[]), None, false)
            .unwrap();
        assert_eq!(p.risk, Risk::L1);
        assert!(!p.needs_confirmation && !p.needs_password && !p.needs_elevation);
        assert_eq!(p.text, "ipconfig /all");
        let c = a.take_run(&p.prepare_id, None, None, false).unwrap();
        assert_eq!(c.syntax, "ipconfig /all");
        assert!(
            a.take_run(&p.prepare_id, None, None, false).is_err(),
            "replay"
        );
        assert_eq!(a.recents().unwrap()[0].command.id, "cmd.ipconfig.all");
    }

    #[test]
    fn meaningful_changes_need_a_grant_unless_turned_off() {
        let a = app();
        let p = a
            .prepare(
                &analyzer(),
                "cmd.shutdown.restart-now",
                &values(&[]),
                None,
                false,
            )
            .unwrap();
        assert_eq!(p.risk, Risk::L2);
        assert!(p.needs_confirmation && p.confirm_phrase.is_none());
        assert!(
            matches!(
                a.take_run(&p.prepare_id, None, None, false),
                Err(AppError::Conflict(_))
            ),
            "skipping authorize is rejected"
        );
        let p = a
            .prepare(
                &analyzer(),
                "cmd.shutdown.restart-now",
                &values(&[]),
                None,
                false,
            )
            .unwrap();
        let grant = a.authorize(&p.prepare_id, None, None).unwrap();
        assert!(a.take_run(&p.prepare_id, Some(&grant), None, false).is_ok());

        a.update_settings(&SettingsPatch {
            confirm_meaningful: Some(false),
            ..Default::default()
        })
        .unwrap();
        let p = a
            .prepare(
                &analyzer(),
                "cmd.shutdown.restart-now",
                &values(&[]),
                None,
                false,
            )
            .unwrap();
        assert!(!p.needs_confirmation);
    }

    #[test]
    fn values_raise_risk_when_the_target_is_critical() {
        let a = app();
        let p = a
            .prepare(
                &analyzer(),
                "cmd.rd.recursive",
                &values(&[("Folder", "C:\\Users\\Public\\old-build")]),
                None,
                false,
            )
            .unwrap();
        assert_eq!(p.risk, Risk::L2);
        assert!(p.findings.is_empty());

        let p = a
            .prepare(
                &analyzer(),
                "cmd.rd.recursive",
                &values(&[("Folder", "C:\\Windows")]),
                None,
                false,
            )
            .unwrap();
        assert_eq!(p.risk, Risk::L3);
        assert_eq!(p.findings.len(), 1);
        assert_eq!(p.confirm_phrase.as_deref(), Some("C:\\Windows"));
        assert_eq!(p.text, "rd /s /q \"C:\\Windows\"");
        let e = a.authorize(&p.prepare_id, Some("yes"), None).unwrap_err();
        assert!(matches!(e, AppError::Validation(_)));
        let grant = a
            .authorize(&p.prepare_id, Some(" c:\\windows "), None)
            .unwrap();
        // Authorized, but nothing runs here: take_run only returns the command.
        assert!(a.take_run(&p.prepare_id, Some(&grant), None, false).is_ok());
    }

    #[test]
    fn relative_values_are_judged_in_the_real_working_folder() {
        // One-click runs start in the home folder, so ".." there is C:\Users.
        let a = app();
        let home = std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap());
        let rd = |folder: &str| {
            a.prepare(
                &analyzer(),
                "cmd.rd.recursive",
                &values(&[("Folder", folder)]),
                Some(&home),
                false,
            )
            .unwrap()
        };
        assert_eq!(rd("..").risk, Risk::L3);
        assert_eq!(rd(".").risk, Risk::L3);
        assert_eq!(rd("C:\\").risk, Risk::L3);
        assert_eq!(rd("old-build").risk, Risk::L2);
    }

    #[test]
    fn a_command_edited_after_authorization_is_rejected() {
        let a = app();
        let id = a
            .custom_create(cmd_draft("Restart", "shutdown /r /t 0", Risk::L2))
            .unwrap()
            .command
            .id;
        let p = a
            .prepare(&analyzer(), &id, &values(&[]), None, false)
            .unwrap();
        let grant = a.authorize(&p.prepare_id, None, None).unwrap();
        a.custom_update(&id, cmd_draft("Restart", "shutdown /r /t 60", Risk::L2))
            .unwrap();
        let e = a
            .take_run(&p.prepare_id, Some(&grant), None, false)
            .unwrap_err();
        assert!(e.to_string().contains("changed after you confirmed"), "{e}");
    }

    #[test]
    fn the_working_folder_and_elevation_are_part_of_the_binding() {
        let a = app();
        let dir = std::path::Path::new("C:\\");
        let p = a
            .prepare(
                &analyzer(),
                "cmd.ipconfig.all",
                &values(&[]),
                Some(dir),
                false,
            )
            .unwrap();
        assert!(a.take_run(&p.prepare_id, None, None, false).is_err());
        let p = a
            .prepare(&analyzer(), "cmd.ipconfig.all", &values(&[]), None, false)
            .unwrap();
        assert!(a.take_run(&p.prepare_id, None, None, true).is_err());
    }

    #[test]
    fn admin_commands_need_elevation_and_never_run_unelevated() {
        let a = app();
        let p = a
            .prepare(&analyzer(), "cmd.netstat.b", &values(&[]), None, false)
            .unwrap();
        assert!(p.needs_elevation);
        let e = a.take_run(&p.prepare_id, None, None, false).unwrap_err();
        assert!(e.to_string().contains("administrator"), "{e}");
        let p = a
            .prepare(&analyzer(), "cmd.netstat.b", &values(&[]), None, true)
            .unwrap();
        assert!(!p.needs_elevation);
        assert!(a.take_run(&p.prepare_id, None, None, true).is_ok());
    }

    #[test]
    fn password_guards_high_impact_runs_and_security_settings() {
        let a = app();
        a.set_password(None, "open sesame").unwrap();
        assert!(a.security_status().unwrap().password_set);
        let params = values(&[("Folder", "C:\\")]);
        let p = a
            .prepare(&analyzer(), "cmd.rd.recursive", &params, None, false)
            .unwrap();
        assert!(p.needs_password);
        let wrong = a.authorize(&p.prepare_id, Some("C:\\"), Some("nope"));
        assert!(matches!(wrong, Err(AppError::Validation(_))));
        let missing = a.authorize(&p.prepare_id, Some("C:\\"), None);
        assert!(missing.is_err());
        let grant = a
            .authorize(&p.prepare_id, Some("C:\\"), Some("open sesame"))
            .unwrap();
        assert!(a.take_run(&p.prepare_id, Some(&grant), None, false).is_ok());

        // Changing the password or policy needs the current password.
        assert!(a.set_password(Some("nope"), "new secret").is_err());
        assert!(
            a.set_policy(
                &crate::store::PasswordPolicy {
                    high_impact: false,
                    ..Default::default()
                },
                None
            )
            .is_err()
        );
        a.set_policy(
            &crate::store::PasswordPolicy {
                high_impact: false,
                ..Default::default()
            },
            Some("open sesame"),
        )
        .unwrap();
        let p = a
            .prepare(&analyzer(), "cmd.rd.recursive", &params, None, false)
            .unwrap();
        assert!(
            !p.needs_password && p.needs_confirmation,
            "L3 still confirms"
        );
        assert!(a.check_restart_allowed(None).is_err());
        assert!(a.check_restart_allowed(Some("open sesame")).is_ok());
        assert!(a.remove_password(None).is_err());
        a.remove_password(Some("open sesame")).unwrap();
        assert!(a.check_restart_allowed(None).is_ok());
    }

    #[test]
    fn wrong_passwords_are_rate_limited() {
        let a = app();
        a.set_password(None, "open sesame").unwrap();
        for _ in 0..4 {
            let _ = a.check_restart_allowed(Some("bad"));
        }
        let e = a.check_restart_allowed(Some("open sesame")).unwrap_err();
        assert!(matches!(e, AppError::Limit(_)), "{e:?}");
    }

    #[test]
    fn advanced_mode_skips_l2_confirmations_and_allows_scripts_but_keeps_l3() {
        let a = app();
        let script = a
            .custom_create(cmd_draft(
                "Renew",
                "ipconfig /release && ipconfig /renew",
                Risk::L2,
            ))
            .unwrap();
        assert!(!script.runnable);
        assert!(
            a.prepare(&analyzer(), &script.command.id, &values(&[]), None, false)
                .is_err()
        );

        a.set_password(None, "open sesame").unwrap();
        assert!(
            a.set_advanced_mode(true, None).is_err(),
            "password required"
        );
        a.set_advanced_mode(true, Some("open sesame")).unwrap();
        assert!(a.get(&script.command.id).unwrap().runnable);
        let p = a
            .prepare(&analyzer(), &script.command.id, &values(&[]), None, false)
            .unwrap();
        assert!(!p.needs_confirmation, "no L2 confirmation in Advanced Mode");
        let p = a
            .prepare(
                &analyzer(),
                "cmd.rd.recursive",
                &values(&[("Folder", "C:\\")]),
                None,
                false,
            )
            .unwrap();
        assert!(p.needs_confirmation && p.needs_password, "L3 kept");
        // Turning it off never needs the password.
        a.set_advanced_mode(false, None).unwrap();
        assert!(!a.security_status().unwrap().advanced_mode);
    }

    #[test]
    fn resetting_preferences_keeps_security_state() {
        let a = app();
        a.set_password(None, "open sesame").unwrap();
        a.set_advanced_mode(true, Some("open sesame")).unwrap();
        a.reset_preferences().unwrap();
        let s = a.security_status().unwrap();
        assert!(s.password_set && s.advanced_mode);
    }

    #[test]
    fn history_shows_current_names_and_survives_deleted_commands() {
        let a = app();
        let custom = a.custom_create(draft("Git branches")).unwrap().command.id;
        a.record_run("cmd.ping", now_millis() - 10, 120, Some(0))
            .unwrap();
        a.record_run(&custom, now_millis(), 5, Some(1)).unwrap();
        a.custom_delete(&custom).unwrap();
        let h = a.history(10).unwrap();
        assert_eq!(h[0].name, custom);
        assert!(!h[0].exists);
        assert_eq!(h[1].name, "Check network connectivity");
        assert_eq!(h[1].shell, Some(Shell::Cmd));
        a.clear_history().unwrap();
        assert!(a.history(10).unwrap().is_empty());
    }

    #[test]
    fn search_query_length_is_bounded() {
        let a = app();
        assert!(a.search(&"x".repeat(201), None, 10).is_err());
    }
}
