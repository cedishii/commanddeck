//! Turning a path argument into the real target it names (SECURITY.md §4).
//!
//! Environment variables are expanded, `.`/`..` resolved, 8.3 short names,
//! symlinks and junctions followed where the path exists, and `\\?\` prefixes
//! removed. Comparison is case-insensitive. A path that can't be resolved
//! (relative to an unknown working directory, UNC, computed at runtime)
//! yields `None`, and callers fail open.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Which shell's syntax the raw argument uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Syntax {
    Cmd,
    PowerShell,
}

/// System locations whose wholesale deletion or re-permissioning breaks Windows
/// or wipes a user's data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Critical {
    DriveRoot,
    Windows,
    System32,
    UsersFolder,
    ProfileRoot,
}

impl Critical {
    pub fn describe(self) -> &'static str {
        match self {
            Self::DriveRoot => "the root of a drive",
            Self::Windows => "the Windows folder",
            Self::System32 => "the Windows system folder",
            Self::UsersFolder => "the folder holding every user's files",
            Self::ProfileRoot => "your whole user folder",
        }
    }
}

/// Expands `%NAME%` (CMD) or `$env:NAME` / `${env:NAME}` / `~` (PowerShell).
/// Unknown variables make the result unknowable, so they return `None`.
pub fn expand(raw: &str, syntax: Syntax) -> Option<String> {
    match syntax {
        Syntax::Cmd => expand_percent(raw),
        Syntax::PowerShell => {
            let mut s = raw.to_string();
            if s == "~" || s.starts_with("~\\") || s.starts_with("~/") {
                let home = std::env::var("USERPROFILE").ok()?;
                s = format!("{home}{}", &s[1..]);
            }
            expand_ps_env(&s)
        }
    }
}

fn expand_percent(raw: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('%')?;
        let name = &after[..end];
        if name.is_empty() {
            out.push('%');
        } else {
            out.push_str(&std::env::var(name).ok()?);
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

fn expand_ps_env(raw: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = raw;
    loop {
        let lower = rest.to_ascii_lowercase();
        let (start, braced) = match (lower.find("$env:"), lower.find("${env:")) {
            (Some(a), Some(b)) if b < a => (b, true),
            (Some(a), _) => (a, false),
            (None, Some(b)) => (b, true),
            (None, None) => break,
        };
        out.push_str(&rest[..start]);
        let after = &rest[start + if braced { 6 } else { 5 }..];
        let len = if braced {
            after.find('}')?
        } else {
            after
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(after.len())
        };
        out.push_str(&std::env::var(&after[..len]).ok()?);
        rest = &after[len + usize::from(braced)..];
    }
    if rest.contains('$') {
        return None; // another variable or expression: computed at runtime
    }
    out.push_str(rest);
    Some(out)
}

/// Resolves a path argument to an absolute, canonical path.
pub fn resolve(raw: &str, syntax: Syntax, cwd: Option<&Path>) -> Option<PathBuf> {
    let unquoted = raw.trim().trim_matches(|c| c == '"' || c == '\'');
    let mut s = expand(unquoted, syntax)?.replace('/', "\\");
    if syntax == Syntax::PowerShell {
        for prefix in ["microsoft.powershell.core\\filesystem::", "filesystem::"] {
            if s.to_ascii_lowercase().starts_with(prefix) {
                s = s[prefix.len()..].to_string();
            }
        }
    }
    // A trailing wildcard targets the folder's contents; classify the folder.
    for suffix in ["\\*.*", "\\*"] {
        if s.len() > suffix.len() && s.ends_with(suffix) {
            s.truncate(s.len() - suffix.len());
            if s.ends_with(':') {
                s.push('\\');
            }
        }
    }
    if s.contains(['*', '?']) || s.starts_with("\\\\") && !s.starts_with("\\\\?\\") {
        return None; // other wildcards, UNC paths
    }
    let s = s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string();
    let bytes = s.as_bytes();
    let has_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let cwd_drive = cwd
        .and_then(|c| c.to_str())
        .map(|c| c[..2.min(c.len())].to_ascii_lowercase());
    let absolute = if has_drive && s[2..].starts_with('\\') {
        PathBuf::from(&s)
    } else if has_drive {
        // "C:" / "C:folder" is relative to that drive's current folder: known only
        // when it's the working folder's drive.
        let cwd = cwd?;
        if cwd_drive.as_deref() != Some(&s[..2].to_ascii_lowercase()) {
            return None;
        }
        cwd.join(&s[2..])
    } else if s.starts_with('\\') {
        // Root-relative: on the working folder's drive, else assumed to be the system drive.
        let drive = match &cwd_drive {
            Some(d) => d.clone(),
            None => std::env::var("SystemDrive").ok()?,
        };
        PathBuf::from(format!("{drive}{s}"))
    } else {
        cwd?.join(&s) // relative: needs a known working folder
    };
    Some(canonical(&absolute))
}

/// Normalizes `..`, then follows links/short names on the longest existing prefix.
fn canonical(path: &Path) -> PathBuf {
    let full = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut existing = full.as_path();
    let mut tail = Vec::new();
    loop {
        if let Ok(c) = std::fs::canonicalize(existing) {
            let mut out = strip_verbatim(&c);
            for part in tail.iter().rev() {
                out.push(part);
            }
            return out;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name.to_owned());
                existing = parent;
            }
            _ => return full,
        }
    }
}

fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix("\\\\?\\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

fn key(p: &Path) -> String {
    let s = p.to_string_lossy().to_lowercase();
    if s.len() > 3 {
        s.trim_end_matches('\\').to_string()
    } else {
        s
    }
}

struct Known {
    windows: String,
    system32: String,
    syswow64: String,
    users: Option<String>,
    profile: Option<String>,
}

fn known() -> &'static Known {
    static KNOWN: OnceLock<Known> = OnceLock::new();
    KNOWN.get_or_init(|| {
        let system32 = canonical(&crate::pty::system_dir());
        let windows = system32
            .parent()
            .map_or_else(|| PathBuf::from(r"C:\Windows"), Path::to_path_buf);
        let profile = std::env::var_os("USERPROFILE").map(|p| canonical(Path::new(&p)));
        Known {
            syswow64: key(&windows.join("SysWOW64")),
            users: profile.as_deref().and_then(Path::parent).map(key),
            profile: profile.as_deref().map(key),
            windows: key(&windows),
            system32: key(&system32),
        }
    })
}

/// Classifies a resolved path that *is* one of the critical locations.
pub fn critical(path: &Path) -> Option<Critical> {
    let k = key(path);
    let known = known();
    if k.len() == 3 && k.ends_with(":\\") {
        Some(Critical::DriveRoot)
    } else if k == known.windows {
        Some(Critical::Windows)
    } else if k == known.system32 || k == known.syswow64 {
        Some(Critical::System32)
    } else if known.users.as_deref() == Some(k.as_str()) {
        Some(Critical::UsersFolder)
    } else if known.profile.as_deref() == Some(k.as_str()) {
        Some(Critical::ProfileRoot)
    } else {
        None
    }
}

/// True for the Windows folder or anything inside it (security-configuration targets).
pub fn within_windows(path: &Path) -> bool {
    let k = key(path);
    let w = &known().windows;
    k == *w || k.starts_with(&format!("{w}\\"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn windir() -> PathBuf {
        crate::pty::system_dir().parent().unwrap().to_path_buf()
    }

    #[test]
    fn env_vars_dotdot_case_and_slashes_resolve_to_the_same_target() {
        for raw in [
            "%SystemRoot%",
            "%windir%\\System32\\..",
            "C:/WINDOWS/",
            "\"%SYSTEMROOT%\"",
        ] {
            let p = resolve(raw, Syntax::Cmd, None).unwrap_or_else(|| panic!("{raw}"));
            assert_eq!(critical(&p), Some(Critical::Windows), "{raw}");
        }
        for raw in ["$env:windir", "${env:SystemRoot}", "'C:\\Windows\\.'"] {
            let p = resolve(raw, Syntax::PowerShell, None).unwrap();
            assert_eq!(critical(&p), Some(Critical::Windows), "{raw}");
        }
        assert_eq!(key(&windir()), known().windows);
    }

    #[test]
    fn roots_profiles_and_system32_are_classified() {
        let c = |raw, s| resolve(raw, s, None).and_then(|p| critical(&p));
        assert_eq!(c("C:\\", Syntax::Cmd), Some(Critical::DriveRoot));
        assert_eq!(c("C:\\*", Syntax::Cmd), Some(Critical::DriveRoot));
        assert_eq!(c("D:\\*.*", Syntax::Cmd), Some(Critical::DriveRoot));
        assert_eq!(c("\\", Syntax::Cmd), Some(Critical::DriveRoot));
        assert_eq!(c("%USERPROFILE%", Syntax::Cmd), Some(Critical::ProfileRoot));
        assert_eq!(c("~", Syntax::PowerShell), Some(Critical::ProfileRoot));
        assert_eq!(
            c("%USERPROFILE%\\..", Syntax::Cmd),
            Some(Critical::UsersFolder)
        );
        assert_eq!(
            c("C:\\Windows\\System32", Syntax::Cmd),
            Some(Critical::System32)
        );
        assert_eq!(
            c("FileSystem::C:\\Windows\\SysWOW64", Syntax::PowerShell),
            Some(Critical::System32)
        );
    }

    #[test]
    fn ordinary_and_unknowable_paths_are_not_critical() {
        let c = |raw, s| resolve(raw, s, None).and_then(|p| critical(&p));
        assert_eq!(c("%TEMP%\\build", Syntax::Cmd), None);
        assert_eq!(c("C:\\Windows\\Temp", Syntax::Cmd), None);
        assert_eq!(c("C:\\Users\\Public\\x", Syntax::Cmd), None);
        assert_eq!(resolve("build", Syntax::Cmd, None), None);
        assert_eq!(resolve("..\\..", Syntax::Cmd, None), None);
        assert_eq!(resolve("\\\\server\\share", Syntax::Cmd, None), None);
        assert_eq!(resolve("%NO_SUCH_VAR_CD%\\x", Syntax::Cmd, None), None);
        assert_eq!(resolve("$dir", Syntax::PowerShell, None), None);
        assert_eq!(resolve("C:\\Win*", Syntax::Cmd, None), None);
    }

    #[test]
    fn relative_paths_resolve_against_a_known_working_folder() {
        let home = PathBuf::from(std::env::var("USERPROFILE").unwrap());
        let drive = home.to_string_lossy()[..2].to_string();
        let c = |raw: &str| resolve(raw, Syntax::Cmd, Some(&home)).and_then(|p| critical(&p));
        assert_eq!(c("."), Some(Critical::ProfileRoot));
        assert_eq!(c(".."), Some(Critical::UsersFolder));
        assert_eq!(c("..\\.."), Some(Critical::DriveRoot));
        assert_eq!(
            c(&drive),
            Some(Critical::ProfileRoot),
            "{drive} = current folder on that drive"
        );
        assert_eq!(c("\\"), Some(Critical::DriveRoot));
        assert_eq!(c("Documents\\old"), None);
        let other = if drive.eq_ignore_ascii_case("Z:") {
            "Y:"
        } else {
            "Z:"
        };
        assert_eq!(
            resolve(other, Syntax::Cmd, Some(&home)),
            None,
            "another drive's current folder is unknown"
        );
        assert_eq!(resolve("..", Syntax::Cmd, None), None);
    }

    #[test]
    fn short_names_and_junctions_are_followed() {
        // "Documents and Settings" is a junction to the Users folder on every Windows install.
        let p = resolve("C:\\Documents and Settings", Syntax::Cmd, None).unwrap();
        assert_eq!(critical(&p), Some(Critical::UsersFolder));
        // 8.3 name of "Program Files" resolves to the long name (when 8.3 names are enabled).
        if let Some(p) = resolve("C:\\PROGRA~1", Syntax::Cmd, None)
            && p.exists()
        {
            assert!(key(&p).ends_with("program files") || key(&p).contains("progra~1"));
        }
    }

    #[test]
    fn within_windows_covers_children_only() {
        assert!(within_windows(
            &resolve("C:\\Windows\\System32\\drivers", Syntax::Cmd, None).unwrap()
        ));
        assert!(!within_windows(
            &resolve("C:\\WindowsApps2", Syntax::Cmd, None).unwrap()
        ));
    }
}
