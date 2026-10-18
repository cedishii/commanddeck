//! Running catalog and custom commands: fill values → analyze → decide what's
//! needed → prepare / authorize / run (SECURITY.md §3–§5, §6.3, §8).

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use serde::Serialize;

use super::{App, run_block_reason};
use crate::catalog::{Command, Risk, Shell};
use crate::error::{AppError, AppResult, FieldError};
use crate::security::grants::{Grants, Needs};
use crate::security::password::{self, Limiter};
use crate::security::{Analyzer, Finding, Syntax};
use crate::store::PasswordPolicy;

const VALUE_MAX: usize = 260;
const PARAMS_MAX: usize = 20;

/// In-memory execution state: pending runs and the password attempt limiter.
#[derive(Default)]
pub struct ExecState {
    grants: Grants,
    limiter: std::sync::Mutex<Limiter>,
}

/// What the UI must show before a run can start.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub prepare_id: String,
    pub command_id: String,
    pub name: String,
    pub shell: Shell,
    /// The exact text that will run (values filled in).
    pub text: String,
    /// Catalog/declared risk, raised by the analyzer, never lowered.
    pub risk: Risk,
    pub findings: Vec<Finding>,
    pub needs_elevation: bool,
    pub needs_confirmation: bool,
    /// Text to type for irreversible operations.
    pub confirm_phrase: Option<String>,
    pub needs_password: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    pub password_set: bool,
    pub policy: PasswordPolicy,
    pub advanced_mode: bool,
}

fn syntax(shell: Shell) -> Syntax {
    match shell {
        Shell::Cmd => Syntax::Cmd,
        Shell::Powershell => Syntax::PowerShell,
    }
}

/// Everything that decides what actually runs. Any difference → re-authorize.
fn binding(shell: Shell, text: &str, cwd: Option<&Path>, elevated: bool) -> String {
    format!("{shell:?}\u{1f}{text}\u{1f}{cwd:?}\u{1f}{elevated}")
}

/// Checks one value for the place it goes. Values are never escaped or
/// rewritten: anything that could change the command's structure is refused.
fn check_value(shell: Shell, quoted: bool, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("Fill this in.".into());
    }
    if value.chars().count() > VALUE_MAX {
        return Err(format!("Use at most {VALUE_MAX} characters."));
    }
    if value.chars().any(char::is_control) {
        return Err("Line breaks and control characters aren't allowed.".into());
    }
    if value.starts_with(['-', '/']) {
        return Err("Can't start with - or / (it would be read as an option).".into());
    }
    let forbidden: &[char] = match (shell, quoted) {
        (Shell::Cmd, true) => &['"', '%', '!', '^'],
        (Shell::Cmd, false) => &[
            '"', '%', '!', '^', '&', '|', '<', '>', ' ', '\t', '(', ')', ',', ';', '=',
        ],
        (Shell::Powershell, true) => &['"', '`', '$', '\u{201c}', '\u{201d}', '\u{201e}'],
        (Shell::Powershell, false) => &[
            '"', '\'', '`', '$', ' ', '\t', ';', '|', '&', '(', ')', '{', '}', '@', '#', ',', '<',
            '>', '\u{2018}', '\u{2019}', '\u{201c}', '\u{201d}', '\u{201e}',
        ],
    };
    if let Some(c) = value.chars().find(|c| forbidden.contains(c)) {
        return Err(format!("The character {c} isn't allowed here."));
    }
    let drive_root =
        value.len() == 3 && value.as_bytes()[0].is_ascii_alphabetic() && value.ends_with(":\\");
    if shell == Shell::Cmd && quoted && value.ends_with('\\') && !drive_root {
        // `\"` would escape the closing quote for most programs (a bare drive root is fine).
        return Err("Remove the \\ at the end.".into());
    }
    Ok(())
}

/// Fills `<Name>` placeholders with validated values.
pub fn fill(command: &Command, params: &HashMap<String, String>) -> AppResult<String> {
    if params.len() > PARAMS_MAX {
        return Err(AppError::invalid("params", "too many values"));
    }
    let mut errors = Vec::new();
    for key in params.keys() {
        if !command.placeholders.iter().any(|p| &p.name == key) {
            errors.push(FieldError::new(
                format!("params.{key}"),
                "not used by this command",
            ));
        }
    }
    let mut text = command.syntax.clone();
    for p in &command.placeholders {
        let token = format!("<{}>", p.name);
        let field = format!("params.{}", p.name);
        let Some(value) = params.get(&p.name) else {
            errors.push(FieldError::new(&field, "Fill this in."));
            continue;
        };
        // Check every place the value goes (inside "…" or bare).
        let mut start = 0;
        while let Some(i) = command.syntax[start..].find(&token) {
            let at = start + i;
            let quoted = command.syntax[..at].matches('"').count() % 2 == 1;
            if let Err(message) = check_value(command.shell, quoted, value) {
                errors.push(FieldError::new(&field, message));
                break;
            }
            start = at + token.len();
        }
        text = text.replace(&token, value);
    }
    if errors.is_empty() {
        Ok(text)
    } else {
        Err(AppError::Validation(errors))
    }
}

impl App {
    fn now() -> Instant {
        Instant::now()
    }

    /// Verifies the app password if one is set. Rate-limited.
    fn check_password(&self, password: Option<&str>) -> AppResult<()> {
        let Some(hash) = self.with_store(|s| s.security())?.password_hash else {
            return Ok(());
        };
        let mut limiter = self
            .exec
            .limiter
            .lock()
            .map_err(|_| AppError::Internal("limiter lock poisoned".into()))?;
        limiter.check(Self::now())?;
        if password.is_some_and(|p| password::verify(&hash, p)) {
            limiter.succeeded();
            Ok(())
        } else {
            limiter.failed(Self::now());
            Err(AppError::invalid("password", "Wrong password."))
        }
    }

    pub fn prepare(
        &self,
        analyzer: &Analyzer,
        id: &str,
        params: &HashMap<String, String>,
        cwd: Option<&Path>,
        elevated: bool,
    ) -> AppResult<Prepared> {
        let (command, settings, security) = self.with_store(|store| {
            let command = Self::find(&self.all_commands(store)?, id)?.clone();
            Ok((command, store.settings()?, store.security()?))
        })?;
        if let Some(reason) = run_block_reason(&command, security.advanced_mode) {
            return Err(AppError::Conflict(reason.into()));
        }
        let text = fill(&command, params)?;
        let findings = analyzer
            .analyze_in(syntax(command.shell), &text, cwd)
            .findings;
        let risk = if findings.is_empty() {
            command.risk
        } else {
            Risk::L3.max(command.risk)
        };
        let needs_confirmation = risk == Risk::L3
            || (risk == Risk::L2 && settings.confirm_meaningful && !security.advanced_mode);
        let confirm_phrase = (risk == Risk::L3).then(|| {
            command
                .placeholders
                .first()
                .and_then(|p| params.get(&p.name))
                .map_or_else(|| "RUN".to_string(), |v| v.trim().to_string())
        });
        let needs_password =
            risk == Risk::L3 && security.password_hash.is_some() && security.policy.high_impact;
        let needs_elevation = command.requires_admin && !elevated;
        let mut ordered: Vec<(String, String)> =
            params.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        ordered.sort();
        let prepare_id = self.exec.grants.prepare(
            id,
            ordered,
            binding(command.shell, &text, cwd, elevated),
            Needs {
                confirmation: needs_confirmation,
                phrase: confirm_phrase.clone(),
                password: needs_password,
            },
            Self::now(),
        )?;
        Ok(Prepared {
            prepare_id,
            command_id: command.id,
            name: command.name,
            shell: command.shell,
            text,
            risk,
            findings,
            needs_elevation,
            needs_confirmation,
            confirm_phrase,
            needs_password,
        })
    }

    /// Checks the typed confirmation and password, then issues a single-use grant.
    pub fn authorize(
        &self,
        prepare_id: &str,
        confirmation: Option<&str>,
        password: Option<&str>,
    ) -> AppResult<String> {
        let needs = self.exec.grants.needs(prepare_id, Self::now())?;
        if let Some(phrase) = &needs.phrase {
            let typed = confirmation.unwrap_or("").trim();
            if !typed.eq_ignore_ascii_case(phrase) {
                return Err(AppError::invalid(
                    "confirmation",
                    &format!("Type {phrase} exactly to confirm."),
                ));
            }
        }
        if needs.password {
            self.check_password(password)?;
        }
        self.exec.grants.authorize(prepare_id, Self::now())
    }

    /// Consumes a prepared run and returns the command with its final text,
    /// after re-deriving everything and comparing it with what was prepared.
    pub fn take_run(
        &self,
        prepare_id: &str,
        grant: Option<&str>,
        cwd: Option<&Path>,
        elevated: bool,
    ) -> AppResult<Command> {
        let pending = self.exec.grants.take(prepare_id, grant, Self::now())?;
        let (mut command, security) = self.with_store(|store| {
            let command = Self::find(&self.all_commands(store)?, &pending.command_id)?.clone();
            Ok((command, store.security()?))
        })?;
        if let Some(reason) = run_block_reason(&command, security.advanced_mode) {
            return Err(AppError::Conflict(reason.into()));
        }
        let params: HashMap<String, String> = pending.params.iter().cloned().collect();
        let text = fill(&command, &params)?;
        if binding(command.shell, &text, cwd, elevated) != pending.binding {
            return Err(AppError::Conflict(
                "The command changed after you confirmed it. Start it again.".into(),
            ));
        }
        if command.requires_admin && !elevated {
            return Err(AppError::Conflict(
                "This command needs administrator rights. Restart CommandDeck as administrator, or copy it to your own admin terminal.".into(),
            ));
        }
        self.record_recent(&command.id)?;
        command.syntax = text;
        Ok(command)
    }

    // ---- security settings ----------------------------------------------------

    pub fn security_status(&self) -> AppResult<SecurityStatus> {
        let s = self.with_store(|store| store.security())?;
        Ok(SecurityStatus {
            password_set: s.password_hash.is_some(),
            policy: s.policy,
            advanced_mode: s.advanced_mode,
        })
    }

    /// Sets or changes the password. Changing it needs the current one.
    pub fn set_password(&self, current: Option<&str>, new: &str) -> AppResult<SecurityStatus> {
        self.check_password(current)?;
        let hash = password::hash(new)?;
        self.with_store(|store| store.set_password_hash(Some(&hash)))?;
        self.security_status()
    }

    pub fn remove_password(&self, current: Option<&str>) -> AppResult<SecurityStatus> {
        self.check_password(current)?;
        self.with_store(|store| store.set_password_hash(None))?;
        self.security_status()
    }

    pub fn set_policy(
        &self,
        policy: &PasswordPolicy,
        password: Option<&str>,
    ) -> AppResult<SecurityStatus> {
        self.check_password(password)?;
        self.with_store(|store| store.set_password_policy(policy))?;
        self.security_status()
    }

    /// Turning Advanced Mode on may need the password; turning it off never does.
    pub fn set_advanced_mode(&self, on: bool, password: Option<&str>) -> AppResult<SecurityStatus> {
        if on && self.with_store(|s| s.security())?.policy.advanced_mode {
            self.check_password(password)?;
        }
        self.with_store(|store| store.set_advanced_mode(on))?;
        self.security_status()
    }

    /// Password gate for "Restart as administrator", if the policy asks for it.
    pub fn check_restart_allowed(&self, password: Option<&str>) -> AppResult<()> {
        if self.with_store(|s| s.security())?.policy.restart_as_admin {
            self.check_password(password)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Placeholder, Source};

    fn cmd_with(shell: Shell, syntax: &str, names: &[&str]) -> Command {
        let mut c = crate::catalog::load_builtin().unwrap().remove(0);
        c.shell = shell;
        c.syntax = syntax.into();
        c.source = Source::Builtin;
        c.placeholders = names
            .iter()
            .map(|n| Placeholder {
                name: (*n).into(),
                description: String::new(),
            })
            .collect();
        c
    }

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect()
    }

    fn field_errors(e: AppError) -> Vec<String> {
        match e {
            AppError::Validation(f) => f
                .into_iter()
                .map(|f| format!("{}: {}", f.field, f.message))
                .collect(),
            other => vec![format!("{other:?}")],
        }
    }

    #[test]
    fn values_fill_every_occurrence() {
        let c = cmd_with(
            Shell::Cmd,
            r#"robocopy "<Source>" "<Destination>" /E & echo <Source>"#,
            &["Source", "Destination"],
        );
        // Bare occurrence of Source forbids spaces even though the quoted one allows them.
        let e = fill(
            &c,
            &params(&[("Source", "C:\\my src"), ("Destination", "D:\\b")]),
        )
        .unwrap_err();
        assert_eq!(
            field_errors(e),
            ["params.Source: The character   isn't allowed here."]
        );
        let t = fill(
            &c,
            &params(&[("Source", "C:\\src"), ("Destination", "D:\\b c")]),
        )
        .unwrap();
        assert_eq!(t, r#"robocopy "C:\src" "D:\b c" /E & echo C:\src"#);
    }

    #[test]
    fn injection_attempts_are_refused_not_escaped() {
        let cmd = cmd_with(Shell::Cmd, r#"del "<File>""#, &["File"]);
        for bad in [
            r#"x" & rd /s /q C:\ & ""#,
            "%COMSPEC%",
            "a^b",
            "line\nbreak",
            "/s",
            "C:\\dir\\",
            "!x!",
        ] {
            assert!(fill(&cmd, &params(&[("File", bad)])).is_err(), "{bad:?}");
        }
        let bare = cmd_with(Shell::Cmd, "format <Drive>: /Q", &["Drive"]);
        for bad in ["E: /Y", "E&calc", "E|x", "(E)"] {
            assert!(fill(&bare, &params(&[("Drive", bad)])).is_err(), "{bad:?}");
        }
        let ps = cmd_with(
            Shell::Powershell,
            r#"Remove-Item -Path "<Path>""#,
            &["Path"],
        );
        for bad in ["$(calc)", "a`\"; calc", "x\u{201d}; calc", "-Recurse"] {
            assert!(fill(&ps, &params(&[("Path", bad)])).is_err(), "{bad:?}");
        }
        let ps_bare = cmd_with(Shell::Powershell, "Stop-Process -Name <Name>", &["Name"]);
        for bad in ["a;calc", "a b", "@(1)", "'x'", "$x"] {
            assert!(
                fill(&ps_bare, &params(&[("Name", bad)])).is_err(),
                "{bad:?}"
            );
        }
        assert_eq!(
            fill(&ps_bare, &params(&[("Name", "notepad")])).unwrap(),
            "Stop-Process -Name notepad"
        );
    }

    #[test]
    fn missing_and_unknown_values_are_reported_per_field() {
        let c = cmd_with(Shell::Cmd, r#"del "<File>""#, &["File"]);
        let e = fill(&c, &params(&[("Other", "x")])).unwrap_err();
        let mut errs = field_errors(e);
        errs.sort();
        assert_eq!(
            errs,
            [
                "params.File: Fill this in.",
                "params.Other: not used by this command"
            ]
        );
    }
}
