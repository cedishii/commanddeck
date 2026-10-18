//! Command catalog: built-in definitions (embedded JSON) and validation shared
//! with user-defined custom commands.

pub mod search;

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, FieldError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Shell {
    Cmd,
    Powershell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Risk {
    L1,
    L2,
    L3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    Networking,
    Files,
    SystemInfo,
    Processes,
    Services,
    Troubleshooting,
    Disk,
    Administration,
    Security,
    Environment,
    WindowsConfig,
    Automation,
}

impl Category {
    /// Categories offered per shell. Must match `src/domain/categories.ts`.
    pub fn allowed_for(self, shell: Shell) -> bool {
        use Category::*;
        match shell {
            Shell::Cmd => matches!(
                self,
                Networking
                    | Files
                    | SystemInfo
                    | Processes
                    | Troubleshooting
                    | Disk
                    | Administration
                    | Security
                    | Environment
            ),
            Shell::Powershell => matches!(
                self,
                SystemInfo
                    | Services
                    | Files
                    | Networking
                    | Troubleshooting
                    | Administration
                    | Security
                    | WindowsConfig
                    | Automation
            ),
        }
    }

    /// Words used by search for category matches.
    pub fn search_words(self) -> &'static str {
        use Category::*;
        match self {
            Networking => "networking network",
            Files => "files directories folders",
            SystemInfo => "system information",
            Processes => "processes",
            Services => "processes services",
            Troubleshooting => "troubleshooting",
            Disk => "disk management storage",
            Administration => "administration admin",
            Security => "security diagnostics",
            Environment => "environment configuration",
            WindowsConfig => "windows configuration settings",
            Automation => "automation utilities",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Builtin,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placeholder {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyntaxPart {
    pub part: String,
    pub meaning: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Details {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when_to_use: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub syntax_parts: Vec<SyntaxPart>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_output: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub side_effects: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cautions: Vec<String>,
}

/// How `scripts/verify-catalog.ps1` checks an entry against Windows. Not used for execution.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind", deny_unknown_fields)]
pub enum Program {
    Exe {
        name: String,
        #[serde(default)]
        flags: Vec<String>,
    },
    CmdBuiltin {
        name: String,
        #[serde(default)]
        flags: Vec<String>,
    },
    Cmdlet {
        name: String,
        #[serde(default)]
        parameters: Vec<String>,
    },
}

/// One built-in entry as written in `catalog/*.json` (shell comes from the file).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuiltinEntry {
    id: String,
    name: String,
    summary: String,
    category: Category,
    syntax: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    tasks: Vec<String>,
    requires_admin: bool,
    risk: Risk,
    modifies: bool,
    #[serde(default)]
    placeholders: Vec<Placeholder>,
    #[serde(default)]
    details: Details,
    programs: Vec<Program>,
    sources: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CatalogFile {
    #[serde(rename = "$schema")]
    _schema: Option<String>,
    version: u32,
    shell: Shell,
    commands: Vec<BuiltinEntry>,
}

/// A command as the application uses it, built-in or custom.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    pub id: String,
    pub source: Source,
    pub shell: Shell,
    pub name: String,
    pub summary: String,
    pub category: Category,
    /// Canonical command text. Copied and (later) executed verbatim.
    pub syntax: String,
    pub aliases: Vec<String>,
    pub keywords: Vec<String>,
    pub tasks: Vec<String>,
    pub requires_admin: bool,
    /// Built-in: curated baseline. Custom: the user's declaration, which is never
    /// trusted to lower authorization requirements (docs/SECURITY.md §4).
    pub risk: Risk,
    pub modifies: bool,
    pub placeholders: Vec<Placeholder>,
    pub details: Details,
    pub sources: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

pub const NAME_MAX: usize = 80;
pub const SUMMARY_MAX: usize = 300;
pub const SYNTAX_MAX: usize = 4000;
pub const NOTES_MAX: usize = 1000;
pub const TERM_MAX: usize = 60;
pub const TERMS_MAX: usize = 30;
pub const ALIAS_MAX: usize = 40;

const CMD_JSON: &str = include_str!("../../../catalog/cmd.json");
const POWERSHELL_JSON: &str = include_str!("../../../catalog/powershell.json");

/// Loads and validates the embedded catalog. Any problem is a build defect, so
/// the error lists everything wrong at once.
pub fn load_builtin() -> AppResult<Vec<Command>> {
    let mut commands = Vec::new();
    for (file, json) in [("cmd.json", CMD_JSON), ("powershell.json", POWERSHELL_JSON)] {
        commands.extend(parse_catalog_file(file, json)?);
    }
    let problems = validate_catalog(&commands);
    if problems.is_empty() {
        Ok(commands)
    } else {
        Err(AppError::Validation(problems))
    }
}

fn parse_catalog_file(file: &str, json: &str) -> AppResult<Vec<Command>> {
    let parsed: CatalogFile = serde_json::from_str(json)
        .map_err(|e| AppError::Internal(format!("catalog/{file} is malformed: {e}")))?;
    if parsed.version != 1 {
        return Err(AppError::Internal(format!(
            "catalog/{file}: unsupported version {}",
            parsed.version
        )));
    }
    let shell = parsed.shell;
    let mut problems = Vec::new();
    let commands = parsed
        .commands
        .into_iter()
        .map(|e| {
            if e.programs.is_empty() {
                problems.push(FieldError::new(
                    format!("{}.programs", e.id),
                    "at least one program is required",
                ));
            }
            if e.sources.is_empty() {
                problems.push(FieldError::new(
                    format!("{}.sources", e.id),
                    "at least one source is required",
                ));
            }
            for s in &e.sources {
                if !s.starts_with("https://learn.microsoft.com/") {
                    problems.push(FieldError::new(
                        format!("{}.sources", e.id),
                        "sources must be Microsoft Learn https URLs",
                    ));
                }
            }
            let prefix = match shell {
                Shell::Cmd => "cmd.",
                Shell::Powershell => "ps.",
            };
            if !e.id.starts_with(prefix) {
                problems.push(FieldError::new(
                    format!("{}.id", e.id),
                    format!("built-in ids in this file start with '{prefix}'"),
                ));
            }
            Command {
                id: e.id,
                source: Source::Builtin,
                shell,
                name: e.name,
                summary: e.summary,
                category: e.category,
                syntax: e.syntax,
                aliases: e.aliases,
                keywords: e.keywords,
                tasks: e.tasks,
                requires_admin: e.requires_admin,
                risk: e.risk,
                modifies: e.modifies,
                placeholders: e.placeholders,
                details: e.details,
                sources: e.sources,
                notes: None,
            }
        })
        .collect();
    if problems.is_empty() {
        Ok(commands)
    } else {
        Err(AppError::Validation(problems))
    }
}

/// Cross-entry rules: unique ids, unique aliases per shell, plus per-entry rules.
pub fn validate_catalog(commands: &[Command]) -> Vec<FieldError> {
    let mut problems = Vec::new();
    let mut ids = HashSet::new();
    let mut aliases: HashMap<(Shell, String), &str> = HashMap::new();
    for c in commands {
        if !ids.insert(c.id.as_str()) {
            problems.push(FieldError::new(format!("{}.id", c.id), "duplicate id"));
        }
        if !valid_id(&c.id) {
            problems.push(FieldError::new(
                format!("{}.id", c.id),
                "ids use lowercase letters, digits, '.', '-'",
            ));
        }
        for f in validate_command(c) {
            problems.push(FieldError::new(format!("{}.{}", c.id, f.field), f.message));
        }
        for a in &c.aliases {
            if let Some(other) = aliases.insert((c.shell, a.clone()), &c.id) {
                problems.push(FieldError::new(
                    format!("{}.aliases", c.id),
                    format!("alias '{a}' is also used by {other}"),
                ));
            }
        }
    }
    problems
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '.' || ch == '-')
        && !id.starts_with('.')
        && !id.ends_with('.')
}

fn has_disallowed_control(s: &str, allow_newlines: bool) -> bool {
    s.chars()
        .any(|ch| ch.is_control() && !(allow_newlines && (ch == '\n' || ch == '\t')))
}

fn check_text(
    field: &str,
    value: &str,
    max: usize,
    allow_newlines: bool,
    out: &mut Vec<FieldError>,
) {
    if value.trim().is_empty() {
        out.push(FieldError::new(field, "is required"));
    } else if value.chars().count() > max {
        out.push(FieldError::new(
            field,
            format!("must be at most {max} characters"),
        ));
    } else if has_disallowed_control(value, allow_newlines) {
        out.push(FieldError::new(field, "contains control characters"));
    }
}

/// `<Name>` tokens in syntax. Names start with a letter and contain letters/digits.
pub fn placeholder_names(syntax: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = syntax;
    while let Some(start) = rest.find('<') {
        let after = &rest[start + 1..];
        if let Some(end) = after.find('>') {
            let candidate = &after[..end];
            let mut chars = candidate.chars();
            if chars.next().is_some_and(|c| c.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric())
            {
                if !names.iter().any(|n| n == candidate) {
                    names.push(candidate.to_string());
                }
                rest = &after[end + 1..];
                continue;
            }
        }
        rest = after;
    }
    names
}

/// True when a command line chains or pipes several operations, spans
/// multiple lines, or runs a script. Separators inside quotes don't count.
/// Informational: it labels custom commands so their behavior is visible.
pub fn is_multi_step(shell: Shell, syntax: &str) -> bool {
    if syntax.trim().contains('\n') {
        return true;
    }
    let lower = syntax.to_lowercase();
    let script_markers: &[&str] = match shell {
        Shell::Cmd => &[".bat", ".cmd", "call ", "start "],
        Shell::Powershell => &[".ps1", "invoke-expression", "iex ", "start-process", "& "],
    };
    if script_markers.iter().any(|m| lower.contains(m)) {
        return true;
    }
    let mut quote: Option<char> = None;
    let mut prev = ' ';
    for ch in syntax.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || (shell == Shell::Powershell && ch == '\'') => quote = Some(ch),
            None if ch == '|' || (shell == Shell::Cmd && ch == '&' && prev != '^') => return true,
            None if shell == Shell::Powershell && ch == ';' => return true,
            None => {}
        }
        prev = ch;
    }
    false
}

pub fn valid_alias(alias: &str) -> bool {
    let len = alias.chars().count();
    (1..=ALIAS_MAX).contains(&len)
        && alias
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && alias.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, ' ' | '.' | '_' | '-')
        })
        && !alias.ends_with(' ')
}

/// Per-entry rules shared by built-in and custom commands.
pub fn validate_command(c: &Command) -> Vec<FieldError> {
    let mut out = Vec::new();
    check_text("name", &c.name, NAME_MAX, false, &mut out);
    check_text("summary", &c.summary, SUMMARY_MAX, false, &mut out);
    check_text("syntax", &c.syntax, SYNTAX_MAX, true, &mut out);
    if c.syntax != c.syntax.trim() {
        out.push(FieldError::new(
            "syntax",
            "must not start or end with whitespace",
        ));
    }
    if !c.category.allowed_for(c.shell) {
        out.push(FieldError::new(
            "category",
            "is not a category of this shell",
        ));
    }
    if c.risk >= Risk::L2 && !c.modifies {
        out.push(FieldError::new(
            "risk",
            "L2 and L3 commands must be marked as modifying the system",
        ));
    }
    for (field, terms) in [("keywords", &c.keywords), ("tasks", &c.tasks)] {
        if terms.len() > TERMS_MAX {
            out.push(FieldError::new(
                field,
                format!("at most {TERMS_MAX} entries"),
            ));
        }
        for t in terms {
            if t.trim().is_empty()
                || t.chars().count() > TERM_MAX
                || has_disallowed_control(t, false)
            {
                out.push(FieldError::new(
                    field,
                    format!("'{t}' must be 1–{TERM_MAX} plain characters"),
                ));
            }
        }
    }
    if c.aliases.len() > TERMS_MAX {
        out.push(FieldError::new(
            "aliases",
            format!("at most {TERMS_MAX} aliases"),
        ));
    }
    for a in &c.aliases {
        if !valid_alias(a) {
            out.push(FieldError::new("aliases", format!("'{a}' must be lowercase letters, digits, space, '.', '_' or '-' (max {ALIAS_MAX})")));
        }
    }
    let used = placeholder_names(&c.syntax);
    let declared: Vec<&str> = c.placeholders.iter().map(|p| p.name.as_str()).collect();
    for name in &used {
        if !declared.contains(&name.as_str()) {
            out.push(FieldError::new(
                "placeholders",
                format!("<{name}> is used in the syntax but not described"),
            ));
        }
    }
    for name in &declared {
        if !used.iter().any(|u| u == name) {
            out.push(FieldError::new(
                "placeholders",
                format!("<{name}> is described but not used in the syntax"),
            ));
        }
    }
    if let Some(n) = &c.notes
        && (n.chars().count() > NOTES_MAX || has_disallowed_control(n, true))
    {
        out.push(FieldError::new(
            "notes",
            format!("must be at most {NOTES_MAX} plain characters"),
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Command {
        Command {
            id: "cmd.test".into(),
            source: Source::Builtin,
            shell: Shell::Cmd,
            name: "Test".into(),
            summary: "A test.".into(),
            category: Category::Networking,
            syntax: "ping <Host>".into(),
            aliases: vec!["t".into()],
            keywords: vec![],
            tasks: vec![],
            requires_admin: false,
            risk: Risk::L1,
            modifies: false,
            placeholders: vec![Placeholder {
                name: "Host".into(),
                description: "host".into(),
            }],
            details: Details::default(),
            sources: vec![],
            notes: None,
        }
    }

    fn fields(errors: &[FieldError]) -> Vec<&str> {
        errors.iter().map(|e| e.field.as_str()).collect()
    }

    #[test]
    fn builtin_catalog_loads_and_is_valid() {
        let commands = load_builtin().expect("built-in catalog must be valid");
        assert!(
            commands.len() >= 60,
            "expected a useful starter catalog, got {}",
            commands.len()
        );
        assert!(commands.iter().any(|c| c.shell == Shell::Cmd));
        assert!(commands.iter().any(|c| c.shell == Shell::Powershell));
    }

    #[test]
    fn builtin_syntax_is_preserved_verbatim() {
        let commands = load_builtin().unwrap();
        let largest = commands
            .iter()
            .find(|c| c.id == "ps.largest-files")
            .unwrap();
        assert!(
            largest.syntax.contains("|\n    Sort-Object"),
            "newlines and indentation must survive loading"
        );
        assert!(largest.syntax.contains(r#""$env:USERPROFILE\Downloads""#));
        let rd = commands
            .iter()
            .find(|c| c.id == "cmd.rd.recursive")
            .unwrap();
        assert_eq!(rd.syntax, r#"rd /s /q "<Folder>""#);
    }

    #[test]
    fn every_builtin_cites_a_source_and_l3_entries_require_admin_here() {
        for c in load_builtin().unwrap() {
            assert!(!c.sources.is_empty(), "{} has no source", c.id);
            if c.risk == Risk::L3 {
                assert!(
                    c.modifies && c.requires_admin,
                    "{}: L3 entries in the starter set are admin operations",
                    c.id
                );
            }
        }
    }

    #[test]
    fn valid_command_passes() {
        assert!(validate_command(&sample()).is_empty());
    }

    #[test]
    fn detects_undeclared_and_unused_placeholders() {
        let mut c = sample();
        c.syntax = "ping <Target>".into();
        let errors = validate_command(&c);
        assert_eq!(errors.len(), 2, "{errors:?}");
        assert!(fields(&errors).iter().all(|f| *f == "placeholders"));
    }

    #[test]
    fn ignores_angle_brackets_that_are_not_placeholders() {
        assert_eq!(
            placeholder_names("echo a <b-c> < d > <1x> <Ok2>"),
            vec!["Ok2".to_string()]
        );
    }

    #[test]
    fn rejects_empty_oversized_and_control_text() {
        let mut c = sample();
        c.name = "   ".into();
        c.summary = "x".repeat(SUMMARY_MAX + 1);
        c.syntax = "dir\u{0007}".into();
        c.placeholders.clear();
        let f = fields(&validate_command(&c))
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();
        assert!(f.contains(&"name".to_string()));
        assert!(f.contains(&"summary".to_string()));
        assert!(f.contains(&"syntax".to_string()));
    }

    #[test]
    fn rejects_surrounding_whitespace_in_syntax_but_keeps_inner_newlines() {
        let mut c = sample();
        c.syntax = "dir\n    /s".into();
        c.placeholders.clear();
        assert!(validate_command(&c).is_empty());
        c.syntax = " dir".into();
        assert_eq!(fields(&validate_command(&c)), vec!["syntax"]);
    }

    #[test]
    fn rejects_category_of_other_shell_and_inconsistent_risk() {
        let mut c = sample();
        c.category = Category::Automation; // PowerShell-only
        c.risk = Risk::L2;
        c.modifies = false;
        let errors = validate_command(&c);
        let f = fields(&errors);
        assert!(f.contains(&"category"));
        assert!(f.contains(&"risk"));
    }

    #[test]
    fn multi_step_detection() {
        use Shell::*;
        assert!(!is_multi_step(Cmd, "ipconfig /all"));
        assert!(is_multi_step(Cmd, "ipconfig /release && ipconfig /renew"));
        assert!(is_multi_step(Cmd, "dir | findstr log"));
        assert!(is_multi_step(Cmd, "call backup.bat"));
        assert!(
            !is_multi_step(Cmd, r#"echo "a & b""#),
            "separators inside quotes don't count"
        );
        assert!(
            !is_multi_step(Cmd, "echo a ^& b"),
            "escaped & is literal in cmd"
        );
        assert!(is_multi_step(Powershell, "Get-Process; Get-Service"));
        assert!(is_multi_step(Powershell, "Get-Process | Sort-Object CPU"));
        assert!(is_multi_step(Powershell, r"& C:\tools\deploy.ps1"));
        assert!(is_multi_step(Powershell, "Get-Date\nGet-Process"));
        assert!(!is_multi_step(Powershell, "Write-Output 'a; b | c'"));
        assert!(!is_multi_step(Powershell, "Get-ChildItem -Path ."));
    }

    #[test]
    fn alias_rules() {
        assert!(valid_alias("ls"));
        assert!(valid_alias("winsock reset"));
        assert!(!valid_alias("LS"));
        assert!(!valid_alias(""));
        assert!(!valid_alias("a;b"));
        assert!(!valid_alias(&"a".repeat(ALIAS_MAX + 1)));
    }

    #[test]
    fn catalog_detects_duplicate_ids_and_aliases_within_a_shell() {
        let a = sample();
        let mut b = sample();
        b.name = "Other".into();
        let problems = validate_catalog(&[a.clone(), b]);
        assert!(problems.iter().any(|p| p.message == "duplicate id"));
        assert!(problems.iter().any(|p| p.message.contains("alias 't'")));

        // Same alias in a different shell is fine.
        let mut ps = sample();
        ps.id = "ps.test".into();
        ps.shell = Shell::Powershell;
        ps.category = Category::Networking;
        assert!(validate_catalog(&[a, ps]).is_empty());
    }

    #[test]
    fn malformed_catalog_json_is_reported_not_panicking() {
        let err = parse_catalog_file(
            "x.json",
            r#"{"version":1,"shell":"cmd","commands":[{"id":"cmd.x"}]}"#,
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Internal(m) if m.contains("malformed")));
        let err = parse_catalog_file("x.json", r#"{"version":1,"shell":"bash","commands":[]}"#)
            .unwrap_err();
        assert!(matches!(err, AppError::Internal(_)));
    }
}
