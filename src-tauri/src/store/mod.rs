//! Local persistence (SQLite). Only the Rust backend touches the database.
//!
//! Schema changes are numbered migrations tracked with `PRAGMA user_version`.
//! A database that can't be opened or fails its integrity check is moved aside
//! (never deleted) and a fresh one is created, so a damaged file can't stop
//! the app from starting.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::catalog::{Category, Command, Risk, Shell, Source};
use crate::error::{AppError, AppResult};

const MIGRATIONS: &[&str] = &[
    // 1: initial schema
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE quick_actions (
         command_id TEXT PRIMARY KEY,
         position INTEGER NOT NULL,
         label TEXT,
         note TEXT
     );
     CREATE TABLE favorites (command_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
     CREATE TABLE recents (command_id TEXT PRIMARY KEY, used_at INTEGER NOT NULL);
     CREATE TABLE custom_commands (
         id TEXT PRIMARY KEY,
         data TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
     );
     CREATE TABLE user_aliases (
         shell TEXT NOT NULL,
         alias TEXT NOT NULL,
         command_id TEXT NOT NULL,
         PRIMARY KEY (shell, alias)
     );",
    // 2: run history (metadata only; output is never stored)
    "CREATE TABLE run_history (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         command_id TEXT NOT NULL,
         started_at INTEGER NOT NULL,
         duration_ms INTEGER NOT NULL,
         exit_code INTEGER
     );
     CREATE INDEX run_history_started ON run_history(started_at);",
];

pub const HISTORY_MAX_ROWS: i64 = 1000;

pub const RECENTS_MAX: usize = 20;

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Comfortable,
    Compact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub quick_action_limit: u32,
    pub density: Density,
    pub terminal_font_size: u32,
    pub terminal_screen_reader: bool,
    pub auto_start_sessions: bool,
    /// Letter used with Ctrl to open search: "k", "p" or "j".
    pub search_shortcut: String,
    /// 0 = don't keep history, -1 = keep forever, otherwise days.
    pub history_retention_days: i64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: Theme::System,
            quick_action_limit: 10,
            density: Density::Comfortable,
            terminal_font_size: 13,
            terminal_screen_reader: false,
            auto_start_sessions: true,
            search_shortcut: "k".into(),
            history_retention_days: 30,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub quick_action_limit: Option<u32>,
    pub density: Option<Density>,
    pub terminal_font_size: Option<u32>,
    pub terminal_screen_reader: Option<bool>,
    pub auto_start_sessions: Option<bool>,
    pub search_shortcut: Option<String>,
    pub history_retention_days: Option<i64>,
}

pub const FONT_SIZES: std::ops::RangeInclusive<u32> = 11..=20;
pub const SEARCH_KEYS: [&str; 3] = ["k", "p", "j"];
pub const RETENTION_DAYS: [i64; 5] = [0, 7, 30, 90, -1];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub id: i64,
    pub command_id: String,
    pub started_at: i64,
    pub duration_ms: i64,
    pub exit_code: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickActionRow {
    pub command_id: String,
    pub label: Option<String>,
    pub note: Option<String>,
}

/// Custom command as stored (JSON in `custom_commands.data`). Shell and id are columns of the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomDraft {
    pub shell: Shell,
    pub name: String,
    pub summary: String,
    pub category: Category,
    pub syntax: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub requires_admin: bool,
    pub modifies: bool,
    pub risk: Risk,
    #[serde(default)]
    pub placeholders: Vec<crate::catalog::Placeholder>,
}

impl CustomDraft {
    pub fn into_command(self, id: String) -> Command {
        Command {
            id,
            source: Source::Custom,
            shell: self.shell,
            name: self.name.trim().to_string(),
            summary: self.summary.trim().to_string(),
            category: self.category,
            syntax: self.syntax,
            aliases: self.aliases,
            keywords: self.keywords,
            tasks: Vec::new(),
            requires_admin: self.requires_admin,
            risk: self.risk,
            modifies: self.modifies,
            placeholders: self.placeholders,
            details: Default::default(),
            sources: Vec::new(),
            notes: self
                .notes
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty()),
        }
    }

    pub fn from_command(c: &Command) -> Self {
        CustomDraft {
            shell: c.shell,
            name: c.name.clone(),
            summary: c.summary.clone(),
            category: c.category,
            syntax: c.syntax.clone(),
            keywords: c.keywords.clone(),
            aliases: c.aliases.clone(),
            notes: c.notes.clone(),
            requires_admin: c.requires_admin,
            modifies: c.modifies,
            risk: c.risk,
            placeholders: c.placeholders.clone(),
        }
    }
}

pub struct Store {
    conn: Connection,
}

/// Result of opening the store, including a recovery notice for the UI.
pub struct Opened {
    pub store: Store,
    pub recovered: Option<PathBuf>,
}

impl Store {
    pub fn open_in_memory() -> AppResult<Store> {
        let conn = Connection::open_in_memory()?;
        let store = Store { conn };
        store.migrate()?;
        Ok(store)
    }

    /// Opens (or creates) the database at `path`, recovering from a damaged file.
    pub fn open(path: &Path) -> AppResult<Opened> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Storage(format!("cannot create data folder: {e}")))?;
        }
        // A database from a newer CommandDeck is intact; refuse it instead of "recovering" it away.
        if let Some(version) = Self::readable_schema_version(path)
            && version > MIGRATIONS.len() as i64
        {
            return Err(AppError::Storage(format!(
                "Your data was saved by a newer version of CommandDeck (schema {version}). Install that version again; this one supports schema {}.",
                MIGRATIONS.len()
            )));
        }
        match Self::try_open(path) {
            Ok(store) => Ok(Opened {
                store,
                recovered: None,
            }),
            Err(first) => {
                if !path.exists() {
                    return Err(first);
                }
                let backup = path.with_extension(format!("corrupt-{}.db", now_millis()));
                std::fs::rename(path, &backup).map_err(|e| {
                    AppError::Storage(format!(
                        "database is damaged ({first}) and could not be moved aside: {e}"
                    ))
                })?;
                let store = Self::try_open(path)?;
                Ok(Opened {
                    store,
                    recovered: Some(backup),
                })
            }
        }
    }

    /// `user_version` of an existing, readable database file; `None` if absent or unreadable.
    fn readable_schema_version(path: &Path) -> Option<i64> {
        if !path.exists() {
            return None;
        }
        let conn =
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        conn.query_row("PRAGMA user_version", [], |r| r.get(0)).ok()
    }

    fn try_open(path: &Path) -> AppResult<Store> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(AppError::Storage(format!(
                "integrity check failed: {check}"
            )));
        }
        let store = Store { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> AppResult<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        let version = usize::try_from(version)
            .map_err(|_| AppError::Storage("invalid schema version".into()))?;
        if version > MIGRATIONS.len() {
            return Err(AppError::Storage(format!(
                "database was created by a newer CommandDeck (schema {version}); this version supports {}",
                MIGRATIONS.len()
            )));
        }
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            self.conn.execute_batch(&format!(
                "BEGIN; {sql} PRAGMA user_version = {}; COMMIT;",
                i + 1
            ))?;
        }
        Ok(())
    }

    // ---- settings -------------------------------------------------------

    fn setting_raw(&self, key: &str) -> AppResult<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    fn set_setting_raw(&self, key: &str, value: &str) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Stored JSON value for `key`, if present, parseable and accepted by `valid`.
    fn setting<T: serde::de::DeserializeOwned>(
        &self,
        key: &str,
        valid: impl Fn(&T) -> bool,
    ) -> AppResult<Option<T>> {
        Ok(self
            .setting_raw(key)?
            .and_then(|v| serde_json::from_str::<T>(&v).ok())
            .filter(valid))
    }

    fn set_setting<T: Serialize>(&self, key: &str, value: &T) -> AppResult<()> {
        self.set_setting_raw(key, &serde_json::to_string(value)?)
    }

    /// Reads settings. Malformed or out-of-range stored values fall back to defaults.
    pub fn settings(&self) -> AppResult<Settings> {
        let d = Settings::default();
        Ok(Settings {
            theme: self.setting("theme", |_: &Theme| true)?.unwrap_or(d.theme),
            quick_action_limit: self
                .setting("quickActionLimit", |n: &u32| *n == 10 || *n == 15)?
                .unwrap_or(d.quick_action_limit),
            density: self
                .setting("density", |_: &Density| true)?
                .unwrap_or(d.density),
            terminal_font_size: self
                .setting("terminalFontSize", |n: &u32| FONT_SIZES.contains(n))?
                .unwrap_or(d.terminal_font_size),
            terminal_screen_reader: self
                .setting("terminalScreenReader", |_: &bool| true)?
                .unwrap_or(d.terminal_screen_reader),
            auto_start_sessions: self
                .setting("autoStartSessions", |_: &bool| true)?
                .unwrap_or(d.auto_start_sessions),
            search_shortcut: self
                .setting("searchShortcut", |k: &String| {
                    SEARCH_KEYS.contains(&k.as_str())
                })?
                .unwrap_or(d.search_shortcut),
            history_retention_days: self
                .setting("historyRetentionDays", |n: &i64| RETENTION_DAYS.contains(n))?
                .unwrap_or(d.history_retention_days),
        })
    }

    pub fn update_settings(&self, patch: &SettingsPatch) -> AppResult<Settings> {
        if let Some(size) = patch.terminal_font_size {
            if !FONT_SIZES.contains(&size) {
                return Err(AppError::invalid(
                    "terminalFontSize",
                    "must be between 11 and 20",
                ));
            }
            self.set_setting("terminalFontSize", &size)?;
        }
        if let Some(key) = &patch.search_shortcut {
            if !SEARCH_KEYS.contains(&key.as_str()) {
                return Err(AppError::invalid("searchShortcut", "must be k, p or j"));
            }
            self.set_setting("searchShortcut", key)?;
        }
        if let Some(days) = patch.history_retention_days {
            if !RETENTION_DAYS.contains(&days) {
                return Err(AppError::invalid(
                    "historyRetentionDays",
                    "must be off, 7, 30, 90 days or forever",
                ));
            }
            self.set_setting("historyRetentionDays", &days)?;
            self.prune_history(days, now_millis())?;
        }
        if let Some(density) = patch.density {
            self.set_setting("density", &density)?;
        }
        if let Some(v) = patch.terminal_screen_reader {
            self.set_setting("terminalScreenReader", &v)?;
        }
        if let Some(v) = patch.auto_start_sessions {
            self.set_setting("autoStartSessions", &v)?;
        }
        if let Some(limit) = patch.quick_action_limit {
            if limit != 10 && limit != 15 {
                return Err(AppError::invalid("quickActionLimit", "must be 10 or 15"));
            }
            let count = self.quick_actions()?.len();
            if count > limit as usize {
                return Err(AppError::Limit(format!(
                    "Home has {count} quick actions. Remove {} before lowering the limit to {limit}.",
                    count - limit as usize
                )));
            }
            self.set_setting_raw("quickActionLimit", &limit.to_string())?;
        }
        if let Some(theme) = patch.theme {
            self.set_setting_raw("theme", &serde_json::to_string(&theme)?)?;
        }
        self.settings()
    }

    // ---- run history ---------------------------------------------------------

    /// Records a finished run if history is enabled, then applies retention.
    pub fn record_run(
        &self,
        command_id: &str,
        started_at: i64,
        duration_ms: i64,
        exit_code: Option<i64>,
    ) -> AppResult<()> {
        let retention = self.settings()?.history_retention_days;
        if retention == 0 {
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO run_history (command_id, started_at, duration_ms, exit_code) VALUES (?1, ?2, ?3, ?4)",
            params![command_id, started_at, duration_ms, exit_code],
        )?;
        self.prune_history(retention, now_millis())
    }

    /// Deletes entries older than the retention period and keeps at most HISTORY_MAX_ROWS.
    pub fn prune_history(&self, retention_days: i64, now: i64) -> AppResult<()> {
        if retention_days == 0 {
            self.conn.execute("DELETE FROM run_history", [])?;
        } else if retention_days > 0 {
            let cutoff = now - retention_days * 24 * 60 * 60 * 1000;
            self.conn
                .execute("DELETE FROM run_history WHERE started_at < ?1", [cutoff])?;
        }
        self.conn.execute(
            "DELETE FROM run_history WHERE id NOT IN (SELECT id FROM run_history ORDER BY started_at DESC, id DESC LIMIT ?1)",
            [HISTORY_MAX_ROWS],
        )?;
        Ok(())
    }

    pub fn history(&self, limit: i64) -> AppResult<Vec<HistoryRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, command_id, started_at, duration_ms, exit_code FROM run_history ORDER BY started_at DESC, id DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit], |r| {
                Ok(HistoryRow {
                    id: r.get(0)?,
                    command_id: r.get(1)?,
                    started_at: r.get(2)?,
                    duration_ms: r.get(3)?,
                    exit_code: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn clear_history(&self) -> AppResult<()> {
        self.conn.execute("DELETE FROM run_history", [])?;
        Ok(())
    }

    pub fn is_seeded(&self) -> AppResult<bool> {
        Ok(self.setting_raw("seeded")?.as_deref() == Some("true"))
    }

    pub fn mark_seeded(&self) -> AppResult<()> {
        self.set_setting_raw("seeded", "true")
    }

    // ---- quick actions (Home) --------------------------------------------

    pub fn quick_actions(&self) -> AppResult<Vec<QuickActionRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT command_id, label, note FROM quick_actions ORDER BY position, command_id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(QuickActionRow {
                    command_id: r.get(0)?,
                    label: r.get(1)?,
                    note: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn write_order(&mut self, ids: &[String]) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE quick_actions SET position = ?1 WHERE command_id = ?2",
                params![i as i64, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn add_quick_action(&mut self, command_id: &str, limit: u32) -> AppResult<()> {
        let rows = self.quick_actions()?;
        if rows.iter().any(|r| r.command_id == command_id) {
            return Err(AppError::Conflict(
                "This command is already on Home.".into(),
            ));
        }
        if rows.len() >= limit as usize {
            return Err(AppError::Limit(format!(
                "Home is full ({limit} of {limit}). Remove a quick action or raise the limit to 15 in Settings."
            )));
        }
        self.conn.execute(
            "INSERT INTO quick_actions (command_id, position) VALUES (?1, ?2)",
            params![command_id, rows.len() as i64],
        )?;
        Ok(())
    }

    pub fn remove_quick_action(&mut self, command_id: &str) -> AppResult<()> {
        let changed = self.conn.execute(
            "DELETE FROM quick_actions WHERE command_id = ?1",
            [command_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("That command is not on Home.".into()));
        }
        let ids: Vec<String> = self
            .quick_actions()?
            .into_iter()
            .map(|r| r.command_id)
            .collect();
        self.write_order(&ids)
    }

    pub fn move_quick_action(&mut self, command_id: &str, to_index: usize) -> AppResult<()> {
        let mut ids: Vec<String> = self
            .quick_actions()?
            .into_iter()
            .map(|r| r.command_id)
            .collect();
        let from = ids
            .iter()
            .position(|id| id == command_id)
            .ok_or_else(|| AppError::NotFound("That command is not on Home.".into()))?;
        let id = ids.remove(from);
        ids.insert(to_index.min(ids.len()), id);
        self.write_order(&ids)
    }

    pub fn update_quick_action(
        &mut self,
        command_id: &str,
        label: Option<&str>,
        note: Option<&str>,
    ) -> AppResult<()> {
        let clean = |v: Option<&str>, field: &str, max: usize| -> AppResult<Option<String>> {
            match v.map(str::trim).filter(|s| !s.is_empty()) {
                None => Ok(None),
                Some(s) if s.chars().count() > max => Err(AppError::invalid(
                    field,
                    &format!("must be at most {max} characters"),
                )),
                Some(s) if s.chars().any(char::is_control) => {
                    Err(AppError::invalid(field, "contains control characters"))
                }
                Some(s) => Ok(Some(s.to_string())),
            }
        };
        let label = clean(label, "label", crate::catalog::NAME_MAX)?;
        let note = clean(note, "note", crate::catalog::SUMMARY_MAX)?;
        let changed = self.conn.execute(
            "UPDATE quick_actions SET label = ?1, note = ?2 WHERE command_id = ?3",
            params![label, note, command_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("That command is not on Home.".into()));
        }
        Ok(())
    }

    pub fn replace_quick_actions(&mut self, ids: &[&str]) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM quick_actions", [])?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO quick_actions (command_id, position) VALUES (?1, ?2)",
                params![id, i as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Removes rows that reference commands that no longer exist.
    pub fn prune_missing(&mut self, exists: &dyn Fn(&str) -> bool) -> AppResult<()> {
        for table in ["quick_actions", "favorites", "recents", "user_aliases"] {
            let ids: Vec<String> = {
                let mut stmt = self
                    .conn
                    .prepare(&format!("SELECT DISTINCT command_id FROM {table}"))?;
                stmt.query_map([], |r| r.get(0))?
                    .collect::<Result<_, _>>()?
            };
            for id in ids.iter().filter(|id| !exists(id)) {
                self.conn
                    .execute(&format!("DELETE FROM {table} WHERE command_id = ?1"), [id])?;
            }
        }
        let ids: Vec<String> = self
            .quick_actions()?
            .into_iter()
            .map(|r| r.command_id)
            .collect();
        self.write_order(&ids)
    }

    // ---- favorites & recents ----------------------------------------------

    pub fn favorites(&self) -> AppResult<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT command_id FROM favorites ORDER BY created_at, command_id")?;
        let ids = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(ids)
    }

    pub fn set_favorite(&self, command_id: &str, favorite: bool) -> AppResult<()> {
        if favorite {
            self.conn.execute(
                "INSERT OR IGNORE INTO favorites (command_id, created_at) VALUES (?1, ?2)",
                params![command_id, now_millis()],
            )?;
        } else {
            self.conn
                .execute("DELETE FROM favorites WHERE command_id = ?1", [command_id])?;
        }
        Ok(())
    }

    pub fn recents(&self) -> AppResult<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT command_id FROM recents ORDER BY used_at DESC, command_id")?;
        let ids = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(ids)
    }

    pub fn record_recent(&self, command_id: &str, at: i64) -> AppResult<()> {
        self.conn.execute(
            "INSERT INTO recents (command_id, used_at) VALUES (?1, ?2)
             ON CONFLICT(command_id) DO UPDATE SET used_at = excluded.used_at",
            params![command_id, at],
        )?;
        self.conn.execute(
            "DELETE FROM recents WHERE command_id NOT IN (SELECT command_id FROM recents ORDER BY used_at DESC LIMIT ?1)",
            [RECENTS_MAX as i64],
        )?;
        Ok(())
    }

    pub fn clear_recents(&self) -> AppResult<()> {
        self.conn.execute("DELETE FROM recents", [])?;
        Ok(())
    }

    // ---- user aliases -------------------------------------------------------

    pub fn user_aliases(&self) -> AppResult<Vec<(Shell, String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT shell, alias, command_id FROM user_aliases ORDER BY alias")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(shell, alias, id)| {
                let shell: Shell = serde_json::from_value(serde_json::Value::String(shell))?;
                Ok((shell, alias, id))
            })
            .collect()
    }

    pub fn replace_user_aliases(
        &mut self,
        shell: Shell,
        command_id: &str,
        aliases: &[String],
    ) -> AppResult<()> {
        let shell_key = serde_json::to_value(shell)?
            .as_str()
            .unwrap_or_default()
            .to_string();
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM user_aliases WHERE command_id = ?1",
            [command_id],
        )?;
        for a in aliases {
            tx.execute(
                "INSERT INTO user_aliases (shell, alias, command_id) VALUES (?1, ?2, ?3)",
                params![shell_key, a, command_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ---- custom commands -----------------------------------------------------

    pub fn custom_commands(&self) -> AppResult<Vec<Command>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, data FROM custom_commands ORDER BY created_at, id")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        // A row that no longer parses is skipped rather than failing the whole app.
        Ok(rows
            .into_iter()
            .filter_map(|(id, data)| {
                serde_json::from_str::<CustomDraft>(&data)
                    .ok()
                    .map(|d| d.into_command(id))
            })
            .collect())
    }

    pub fn insert_custom(&mut self, commands: &[Command]) -> AppResult<()> {
        let now = now_millis();
        let tx = self.conn.transaction()?;
        for c in commands {
            let data = serde_json::to_string(&CustomDraft::from_command(c))?;
            tx.execute(
                "INSERT INTO custom_commands (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                params![c.id, data, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn update_custom(&self, command: &Command) -> AppResult<()> {
        let data = serde_json::to_string(&CustomDraft::from_command(command))?;
        let changed = self.conn.execute(
            "UPDATE custom_commands SET data = ?1, updated_at = ?2 WHERE id = ?3",
            params![data, now_millis(), command.id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Custom command not found.".into()));
        }
        Ok(())
    }

    pub fn delete_custom(&mut self, id: &str) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        let changed = tx.execute("DELETE FROM custom_commands WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(AppError::NotFound("Custom command not found.".into()));
        }
        for table in ["quick_actions", "favorites", "recents", "user_aliases"] {
            tx.execute(&format!("DELETE FROM {table} WHERE command_id = ?1"), [id])?;
        }
        tx.commit()?;
        let ids: Vec<String> = self
            .quick_actions()?
            .into_iter()
            .map(|r| r.command_id)
            .collect();
        self.write_order(&ids)
    }

    pub fn custom_id_exists(&self, id: &str) -> AppResult<bool> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM custom_commands WHERE id = ?1", [id], |_| {
                Ok(())
            })
            .optional()?
            .is_some())
    }

    // ---- reset ------------------------------------------------------------------

    /// Resets settings and the Home layout. Keeps custom commands, favorites and aliases.
    pub fn reset_preferences(&mut self) -> AppResult<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM settings", [])?;
        tx.execute("DELETE FROM quick_actions", [])?;
        tx.commit()?;
        Ok(())
    }

    #[cfg(test)]
    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    fn ids(s: &Store) -> Vec<String> {
        s.quick_actions()
            .unwrap()
            .into_iter()
            .map(|r| r.command_id)
            .collect()
    }

    #[test]
    fn settings_default_and_update() {
        let s = store();
        assert_eq!(s.settings().unwrap(), Settings::default());
        let updated = s
            .update_settings(&SettingsPatch {
                theme: Some(Theme::Dark),
                quick_action_limit: Some(15),
                density: Some(Density::Compact),
                terminal_font_size: Some(16),
                terminal_screen_reader: Some(true),
                auto_start_sessions: Some(false),
                search_shortcut: Some("p".into()),
                history_retention_days: Some(-1),
            })
            .unwrap();
        assert_eq!(
            updated,
            Settings {
                theme: Theme::Dark,
                quick_action_limit: 15,
                density: Density::Compact,
                terminal_font_size: 16,
                terminal_screen_reader: true,
                auto_start_sessions: false,
                search_shortcut: "p".into(),
                history_retention_days: -1,
            }
        );
    }

    #[test]
    fn malformed_settings_fall_back_to_defaults() {
        let s = store();
        for (key, bad) in [
            ("theme", "{broken"),
            ("quickActionLimit", "12"),
            ("density", "\"tiny\""),
            ("terminalFontSize", "99"),
            ("terminalScreenReader", "\"yes\""),
            ("autoStartSessions", "maybe"),
            ("searchShortcut", "\"x\""),
            ("historyRetentionDays", "3"),
        ] {
            s.set_setting_raw(key, bad).unwrap();
        }
        assert_eq!(s.settings().unwrap(), Settings::default());
    }

    #[test]
    fn invalid_new_settings_are_rejected_without_partial_writes_to_that_key() {
        let s = store();
        for patch in [
            SettingsPatch {
                terminal_font_size: Some(40),
                ..Default::default()
            },
            SettingsPatch {
                search_shortcut: Some("ctrl+alt+del".into()),
                ..Default::default()
            },
            SettingsPatch {
                history_retention_days: Some(5),
                ..Default::default()
            },
        ] {
            assert!(matches!(
                s.update_settings(&patch),
                Err(AppError::Validation(_))
            ));
        }
        assert_eq!(s.settings().unwrap(), Settings::default());
    }

    #[test]
    fn run_history_records_orders_and_clears() {
        let s = store();
        s.record_run("cmd.ping", now_millis() - 2000, 1500, Some(0))
            .unwrap();
        s.record_run("cmd.tasklist", now_millis() - 1000, 40, Some(1))
            .unwrap();
        let h = s.history(10).unwrap();
        assert_eq!(
            h.iter().map(|r| r.command_id.as_str()).collect::<Vec<_>>(),
            ["cmd.tasklist", "cmd.ping"]
        );
        assert_eq!(h[1].exit_code, Some(0));
        assert_eq!(h[1].duration_ms, 1500);
        s.clear_history().unwrap();
        assert!(s.history(10).unwrap().is_empty());
    }

    #[test]
    fn run_history_respects_retention() {
        let s = store();
        let day = 24 * 60 * 60 * 1000;
        s.record_run("old", now_millis() - 40 * day, 1, Some(0))
            .unwrap();
        s.record_run("recent", now_millis() - day, 1, Some(0))
            .unwrap();
        // Default retention is 30 days: the 40-day-old entry is pruned on insert.
        assert_eq!(
            s.history(10)
                .unwrap()
                .iter()
                .map(|r| r.command_id.as_str())
                .collect::<Vec<_>>(),
            ["recent"]
        );

        s.update_settings(&SettingsPatch {
            history_retention_days: Some(0),
            ..Default::default()
        })
        .unwrap();
        assert!(
            s.history(10).unwrap().is_empty(),
            "turning history off deletes it"
        );
        s.record_run("ignored", now_millis(), 1, Some(0)).unwrap();
        assert!(
            s.history(10).unwrap().is_empty(),
            "nothing is recorded while history is off"
        );
    }

    #[test]
    fn run_history_is_capped() {
        let s = store();
        s.update_settings(&SettingsPatch {
            history_retention_days: Some(-1),
            ..Default::default()
        })
        .unwrap();
        for i in 0..(HISTORY_MAX_ROWS + 5) {
            s.conn()
                .execute("INSERT INTO run_history (command_id, started_at, duration_ms, exit_code) VALUES ('x', ?1, 1, 0)", [i])
                .unwrap();
        }
        s.record_run("latest", now_millis(), 1, None).unwrap();
        assert_eq!(
            s.history(HISTORY_MAX_ROWS + 10).unwrap().len() as i64,
            HISTORY_MAX_ROWS
        );
        assert_eq!(s.history(1).unwrap()[0].command_id, "latest");
    }

    #[test]
    fn version_1_databases_are_migrated_with_data_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("commanddeck.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(&format!(
                "BEGIN; {} PRAGMA user_version = 1; COMMIT;",
                MIGRATIONS[0]
            ))
            .unwrap();
            conn.execute(
                "INSERT INTO favorites (command_id, created_at) VALUES ('cmd.ping', 1)",
                [],
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap().store;
        assert_eq!(store.favorites().unwrap(), ["cmd.ping"]);
        store
            .record_run("cmd.ping", now_millis(), 1, Some(0))
            .unwrap();
        assert_eq!(store.history(5).unwrap().len(), 1);
    }

    #[test]
    fn invalid_limit_is_rejected() {
        let s = store();
        let err = s
            .update_settings(&SettingsPatch {
                quick_action_limit: Some(12),
                ..Default::default()
            })
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn quick_actions_add_move_remove_keep_positions_contiguous() {
        let mut s = store();
        for id in ["a", "b", "c", "d"] {
            s.add_quick_action(id, 10).unwrap();
        }
        s.move_quick_action("d", 0).unwrap();
        assert_eq!(ids(&s), ["d", "a", "b", "c"]);
        s.move_quick_action("d", 99).unwrap();
        assert_eq!(ids(&s), ["a", "b", "c", "d"]);
        s.remove_quick_action("b").unwrap();
        assert_eq!(ids(&s), ["a", "c", "d"]);
        let positions: Vec<i64> = s
            .conn()
            .prepare("SELECT position FROM quick_actions ORDER BY position")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(positions, [0, 1, 2]);
    }

    #[test]
    fn quick_action_limit_and_duplicates() {
        let mut s = store();
        for i in 0..10 {
            s.add_quick_action(&format!("c{i}"), 10).unwrap();
        }
        assert!(matches!(
            s.add_quick_action("extra", 10),
            Err(AppError::Limit(_))
        ));
        assert!(matches!(
            s.add_quick_action("c1", 15),
            Err(AppError::Conflict(_))
        ));
        s.add_quick_action("extra", 15).unwrap();
        let err = s
            .update_settings(&SettingsPatch {
                quick_action_limit: Some(10),
                ..Default::default()
            })
            .unwrap_err();
        assert!(matches!(err, AppError::Limit(m) if m.contains("Remove 1")));
    }

    #[test]
    fn quick_action_label_and_note() {
        let mut s = store();
        s.add_quick_action("a", 10).unwrap();
        s.update_quick_action("a", Some("  My ping  "), Some(""))
            .unwrap();
        let row = &s.quick_actions().unwrap()[0];
        assert_eq!(row.label.as_deref(), Some("My ping"));
        assert_eq!(row.note, None);
        assert!(matches!(
            s.update_quick_action("a", Some(&"x".repeat(81)), None),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            s.update_quick_action("zzz", None, None),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn recents_are_ordered_deduplicated_and_capped() {
        let s = store();
        for i in 0..(RECENTS_MAX as i64 + 5) {
            s.record_recent(&format!("c{i}"), i).unwrap();
        }
        s.record_recent("c3", 1000).unwrap();
        let r = s.recents().unwrap();
        assert_eq!(r.len(), RECENTS_MAX);
        assert_eq!(r[0], "c3");
        s.clear_recents().unwrap();
        assert!(s.recents().unwrap().is_empty());
    }

    #[test]
    fn favorites_toggle_idempotently() {
        let s = store();
        s.set_favorite("a", true).unwrap();
        s.set_favorite("a", true).unwrap();
        assert_eq!(s.favorites().unwrap(), ["a"]);
        s.set_favorite("a", false).unwrap();
        assert!(s.favorites().unwrap().is_empty());
    }

    #[test]
    fn prune_removes_references_to_missing_commands() {
        let mut s = store();
        s.add_quick_action("keep", 10).unwrap();
        s.add_quick_action("gone", 10).unwrap();
        s.set_favorite("gone", true).unwrap();
        s.prune_missing(&|id| id == "keep").unwrap();
        assert_eq!(ids(&s), ["keep"]);
        assert!(s.favorites().unwrap().is_empty());
    }

    #[test]
    fn reopening_a_file_database_keeps_data_and_runs_migrations_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("commanddeck.db");
        {
            let mut s = Store::open(&path).unwrap().store;
            s.add_quick_action("a", 10).unwrap();
        }
        let opened = Store::open(&path).unwrap();
        assert!(opened.recovered.is_none());
        assert_eq!(ids(&opened.store), ["a"]);
    }

    #[test]
    fn corrupted_database_file_is_moved_aside_and_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("commanddeck.db");
        std::fs::write(
            &path,
            b"this is not a sqlite database, just garbage bytes................",
        )
        .unwrap();
        let opened = Store::open(&path).unwrap();
        let backup = opened.recovered.expect("recovery must be reported");
        assert!(
            backup.exists(),
            "the damaged file is kept for inspection, not deleted"
        );
        assert!(opened.store.quick_actions().unwrap().is_empty());
    }

    #[test]
    fn newer_schema_is_refused_instead_of_damaged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("commanddeck.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", 99).unwrap();
        }
        let err = Store::open(&path)
            .err()
            .expect("newer schema must be refused");
        assert!(matches!(err, AppError::Storage(m) if m.contains("newer version")));
        assert!(path.exists(), "the newer database must be left untouched");
    }

    #[test]
    fn unreadable_custom_rows_are_skipped() {
        let s = store();
        s.conn()
            .execute("INSERT INTO custom_commands (id, data, created_at, updated_at) VALUES ('custom.x', '{bad', 0, 0)", [])
            .unwrap();
        assert!(s.custom_commands().unwrap().is_empty());
    }
}
