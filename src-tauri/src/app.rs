//! Application layer: combines the built-in catalog with the user's stored data.
//! Every rule (limits, validation, alias conflicts) is enforced here, never only in the UI.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::catalog::{self, Command, Shell, Source};
use crate::error::{AppError, AppResult, FieldError};
use crate::store::{CustomDraft, Settings, SettingsPatch, Store, now_millis};

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
}

impl App {
    pub fn new(builtin: Vec<Command>, store: Store, notice: Option<String>) -> AppResult<App> {
        let app = App {
            builtin,
            store: Mutex::new(store),
            notice,
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
        Ok(commands
            .into_iter()
            .map(|c| CommandView {
                favorite: favorites.contains(&c.id),
                on_home: home.contains(&c.id),
                user_aliases: aliases.remove(&c.id).unwrap_or_default(),
                multi_step: c.source == Source::Custom
                    && catalog::is_multi_step(c.shell, &c.syntax),
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

    #[test]
    fn search_query_length_is_bounded() {
        let a = app();
        assert!(a.search(&"x".repeat(201), None, 10).is_err());
    }
}
