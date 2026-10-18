//! The catastrophic operations CommandDeck can identify reliably (SECURITY.md §6.2).
//!
//! Each rule matches a program or cmdlet plus the parameters that matter and,
//! where a target decides the outcome, the canonical target. Ordinary admin
//! maintenance (sfc, DISM, ipconfig /flushdns, services, deleting ordinary
//! folders) never matches.

use std::collections::HashMap;
use std::path::Path;

use super::paths::{self, Critical, Syntax};
use super::{Arg, Finding, Invocation, cmdline};

const MAX_NESTING: u8 = 2;

/// How to read paths: the shell's syntax, and the working folder when it's known
/// (one-click runs). Without one, relative paths can't be resolved and fail open.
#[derive(Clone, Copy)]
struct Cx<'a> {
    syntax: Syntax,
    cwd: Option<&'a Path>,
}

pub fn check(invocations: &[Invocation], syntax: Syntax, cwd: Option<&Path>) -> Vec<Finding> {
    let mut out = Vec::new();
    check_into(invocations, Cx { syntax, cwd }, 0, &mut out);
    let mut seen = std::collections::HashSet::new();
    out.retain(|f| seen.insert((f.operation.clone(), f.target.clone())));
    out
}

fn check_into(invocations: &[Invocation], cx: Cx<'_>, depth: u8, out: &mut Vec<Finding>) {
    for inv in invocations {
        let name = canonical_name(&inv.name, cx.syntax);
        match (cx.syntax, name) {
            (Syntax::PowerShell, "remove-item") => remove_item(inv, cx, out),
            (Syntax::PowerShell, "format-volume") => disk_cmdlet(inv, out, Disk::Format),
            (Syntax::PowerShell, "clear-disk") => disk_cmdlet(inv, out, Disk::Clear),
            (Syntax::PowerShell, "remove-partition") => disk_cmdlet(inv, out, Disk::RemovePart),
            (Syntax::PowerShell, "set-mppreference") => defender(inv, out),
            (Syntax::PowerShell, "set-netfirewallprofile") => firewall_profile(inv, out),
            (Syntax::Cmd, "rd" | "del") => cmd_delete(inv, cx, out),
            _ => native(name, inv, cx, depth, invocations, out),
        }
    }
}

fn canonical_name(name: &str, syntax: Syntax) -> &str {
    match (syntax, name) {
        (Syntax::PowerShell, "rm" | "del" | "erase" | "rd" | "rmdir" | "ri") => "remove-item",
        (Syntax::Cmd, "rmdir") => "rd",
        (Syntax::Cmd, "erase") => "del",
        _ => name.rsplit('\\').next().unwrap_or(name),
    }
}

// ---- shared helpers -------------------------------------------------------------

/// Arguments as native-program tokens. `None` = computed at runtime.
fn tokens(inv: &Invocation) -> Vec<Option<String>> {
    inv.args
        .iter()
        .flat_map(|a| match a {
            Arg::Value(v) => vec![v.clone()],
            Arg::Param { name, value: None } => vec![Some(format!("-{name}"))],
            Arg::Param {
                name,
                value: Some(v),
            } => vec![v.as_ref().map(|v| format!("-{name}:{v}"))],
        })
        .collect()
}

fn lower(t: &Option<String>) -> String {
    t.as_deref().unwrap_or("").to_lowercase()
}

fn truthy(v: Option<&str>) -> bool {
    v.is_some_and(|v| v.eq_ignore_ascii_case("true") || v == "1")
}

fn falsy(v: Option<&str>) -> bool {
    v.is_some_and(|v| v.eq_ignore_ascii_case("false") || v == "0")
}

fn finding(operation: &str, target: impl Into<String>, consequence: &str) -> Finding {
    Finding {
        operation: operation.into(),
        target: target.into(),
        consequence: consequence.into(),
    }
}

fn critical_target(raw: &str, cx: Cx<'_>) -> Option<(String, Critical)> {
    let path = paths::resolve(raw, cx.syntax, cx.cwd)?;
    let kind = paths::critical(&path)?;
    Some((format!("{} ({})", path.display(), kind.describe()), kind))
}

fn delete_finding(target: String, kind: Critical) -> Finding {
    let consequence = match kind {
        Critical::DriveRoot => {
            "Deletes everything on the drive that it can reach. It can't be undone."
        }
        Critical::Windows | Critical::System32 => {
            "Deletes Windows system files. Windows will stop working and may not start again."
        }
        Critical::UsersFolder | Critical::ProfileRoot => {
            "Deletes documents, desktop, downloads and settings. It can't be undone."
        }
    };
    finding("Delete a folder and everything in it", target, consequence)
}

// ---- PowerShell parameter binding -------------------------------------------------

const COMMON_SWITCHES: &[&str] = &["verbose", "debug", "whatif", "confirm"];
const COMMON_VALUED: &[&str] = &[
    "erroraction",
    "warningaction",
    "informationaction",
    "errorvariable",
    "warningvariable",
    "informationvariable",
    "outvariable",
    "outbuffer",
    "pipelinevariable",
];

struct Bound {
    /// Full parameter name → value (`None` = computed at runtime). Switches bind "True".
    named: HashMap<&'static str, Option<String>>,
    positional: Vec<Option<String>>,
}

impl Bound {
    fn get(&self, name: &str) -> Option<Option<&str>> {
        self.named.get(name).map(Option::as_deref)
    }

    fn is_true(&self, name: &str) -> bool {
        truthy(self.get(name).flatten())
    }
}

/// Binds like PowerShell for the parameters a rule cares about: exact name or
/// alias, else a unique prefix. Unknown or ambiguous parameters are skipped.
fn bind(
    inv: &Invocation,
    switches: &[&'static str],
    valued: &[&'static str],
    aliases: &[(&str, &'static str)],
) -> Bound {
    let all: Vec<&'static str> = switches
        .iter()
        .chain(valued)
        .chain(COMMON_SWITCHES)
        .chain(COMMON_VALUED)
        .copied()
        .collect();
    let resolve = |given: &str| -> Option<&'static str> {
        if let Some((_, full)) = aliases.iter().find(|(a, _)| *a == given) {
            return Some(full);
        }
        if let Some(exact) = all.iter().find(|n| **n == given) {
            return Some(exact);
        }
        let mut matches = all.iter().filter(|n| n.starts_with(given));
        match (matches.next(), matches.next()) {
            (Some(one), None) => Some(one),
            _ => None,
        }
    };
    let is_switch = |n: &str| switches.contains(&n) || COMMON_SWITCHES.contains(&n);
    let mut bound = Bound {
        named: HashMap::new(),
        positional: Vec::new(),
    };
    let mut args = inv.args.iter().peekable();
    while let Some(arg) = args.next() {
        match arg {
            Arg::Value(v) => bound.positional.push(v.clone()),
            Arg::Param { name, value } => {
                let Some(full) = resolve(name) else { continue };
                let v = match value {
                    Some(v) => v.clone(),
                    None if is_switch(full) => Some("True".into()),
                    None => match args.peek() {
                        Some(Arg::Value(v)) => {
                            let v = v.clone();
                            args.next();
                            v
                        }
                        _ => None,
                    },
                };
                bound.named.insert(full, v);
            }
        }
    }
    bound
}

// ---- PowerShell rules -------------------------------------------------------------

fn remove_item(inv: &Invocation, cx: Cx<'_>, out: &mut Vec<Finding>) {
    let b = bind(
        inv,
        &["recurse", "force", "usetransaction"],
        &[
            "path",
            "literalpath",
            "filter",
            "include",
            "exclude",
            "credential",
            "stream",
        ],
        &[("lp", "literalpath"), ("pspath", "literalpath")],
    );
    if b.is_true("whatif") {
        return;
    }
    let targets = b
        .get("path")
        .into_iter()
        .chain(b.get("literalpath"))
        .chain(b.positional.iter().map(Option::as_deref))
        .flatten();
    for raw in targets {
        if let Some(key) = registry_system_key(raw) {
            out.push(finding(
                "Delete a registry key",
                key,
                "Removes Windows system configuration. Windows may not start.",
            ));
        } else if b.is_true("recurse")
            && let Some((target, kind)) = critical_target(raw, cx)
        {
            out.push(delete_finding(target, kind));
        }
    }
}

enum Disk {
    Format,
    Clear,
    RemovePart,
}

fn disk_cmdlet(inv: &Invocation, out: &mut Vec<Finding>, kind: Disk) {
    let b = bind(
        inv,
        &["force", "removedata", "removeoem", "full"],
        &[
            "driveletter",
            "number",
            "partitionnumber",
            "disknumber",
            "filesystem",
            "newfilesystemlabel",
            "path",
            "objectid",
            "uniqueid",
            "friendlyname",
        ],
        &[],
    );
    if b.is_true("whatif") {
        return;
    }
    let named = |key: &str, label: &str| b.get(key).flatten().map(|v| format!("{label} {v}"));
    match kind {
        Disk::Format => out.push(finding(
            "Format a drive",
            named("driveletter", "drive").unwrap_or_else(|| "a volume".into()),
            "Erases everything on the volume.",
        )),
        Disk::Clear => out.push(finding(
            "Erase a whole disk",
            named("number", "disk")
                .or_else(|| named("friendlyname", "disk"))
                .unwrap_or_else(|| "a disk".into()),
            "Removes every partition and all data on the disk.",
        )),
        Disk::RemovePart => out.push(finding(
            "Delete a partition",
            match (
                b.get("disknumber").flatten(),
                b.get("partitionnumber").flatten(),
            ) {
                (Some(d), Some(p)) => format!("disk {d}, partition {p}"),
                _ => named("driveletter", "drive").unwrap_or_else(|| "a partition".into()),
            },
            "Deletes the partition and everything on it.",
        )),
    }
}

fn defender(inv: &Invocation, out: &mut Vec<Finding>) {
    // Many Set-MpPreference parameters start with "Disable"; require an unambiguous prefix.
    let mut args = inv.args.iter().peekable();
    while let Some(arg) = args.next() {
        let Arg::Param { name, value } = arg else {
            continue;
        };
        let matches = name == "drtm"
            || (name.len() >= 10 && "disablerealtimemonitoring".starts_with(name.as_str()));
        if !matches {
            continue;
        }
        let v = match value {
            Some(v) => v.clone(),
            None => match args.peek() {
                Some(Arg::Value(v)) => v.clone(),
                _ => None,
            },
        };
        if truthy(v.as_deref()) {
            out.push(finding(
                "Turn off Microsoft Defender real-time protection",
                "this PC",
                "Malware is no longer blocked as it arrives.",
            ));
        }
    }
}

fn firewall_profile(inv: &Invocation, out: &mut Vec<Finding>) {
    let b = bind(inv, &["all"], &["enabled", "profile", "name"], &[]);
    if b.is_true("whatif") || !falsy(b.get("enabled").flatten()) {
        return;
    }
    let target = b
        .get("profile")
        .flatten()
        .or_else(|| b.get("name").flatten())
        .map_or_else(
            || "network profiles".to_string(),
            |p| format!("the {p} profile"),
        );
    out.push(finding(
        "Turn off Windows Firewall",
        target,
        "Incoming connections are no longer filtered.",
    ));
}

fn registry_system_key(raw: &str) -> Option<String> {
    let s = raw.trim().trim_matches(|c| c == '"' || c == '\'');
    let s = s.strip_prefix("Microsoft.PowerShell.Core\\").unwrap_or(s);
    let s = s.strip_prefix("Registry::").unwrap_or(s);
    let upper = s.to_ascii_uppercase().replace('/', "\\");
    let rest = ["HKLM:\\", "HKLM\\", "HKEY_LOCAL_MACHINE\\"]
        .iter()
        .find_map(|p| upper.strip_prefix(p))?
        .trim_end_matches('\\');
    (rest == "SYSTEM" || rest.starts_with("SYSTEM\\")).then(|| format!("HKLM\\{rest}"))
}

// ---- CMD rules ----------------------------------------------------------------

/// "/s/q" → ["s", "q"]; only tokens that start with '/'.
fn switches(tokens: &[Option<String>]) -> Vec<String> {
    tokens
        .iter()
        .filter_map(|t| t.as_deref())
        .filter(|t| t.starts_with('/'))
        .flat_map(|t| {
            t.split('/')
                .filter(|s| !s.is_empty())
                .map(str::to_lowercase)
                .collect::<Vec<_>>()
        })
        .collect()
}

/// `rd /s` and `del /s` (both need /s to delete a tree).
fn cmd_delete(inv: &Invocation, cx: Cx<'_>, out: &mut Vec<Finding>) {
    let toks = tokens(inv);
    if !switches(&toks).iter().any(|s| s == "s") {
        return; // without /s neither command deletes a tree
    }
    for raw in toks.iter().flatten().filter(|t| !t.starts_with('/')) {
        if let Some((target, kind)) = critical_target(raw, cx) {
            out.push(delete_finding(target, kind));
        }
    }
}

// ---- native programs (from CMD or PowerShell) -----------------------------------

fn native(
    name: &str,
    inv: &Invocation,
    cx: Cx<'_>,
    depth: u8,
    line: &[Invocation],
    out: &mut Vec<Finding>,
) {
    let toks = tokens(inv);
    let low: Vec<String> = toks.iter().map(lower).collect();
    match name {
        "format" => {
            if let Some(drive) = low.iter().find(|t| is_drive(t)) {
                out.push(finding(
                    "Format a drive",
                    format!("drive {}", drive.trim_end_matches('\\').to_uppercase()),
                    "Erases everything on the drive.",
                ));
            }
        }
        "vssadmin"
            if low.first().is_some_and(|t| t == "delete")
                && low.get(1).is_some_and(|t| t == "shadows") =>
        {
            out.push(shadow_finding());
        }
        "wmic" if low.iter().any(|t| t == "shadowcopy") && low.iter().any(|t| t == "delete") => {
            out.push(shadow_finding());
        }
        "bcdedit" => {
            const WRITES: &[&str] = &[
                "/set",
                "/deletevalue",
                "/delete",
                "/create",
                "/copy",
                "/import",
                "/default",
                "/displayorder",
                "/bootsequence",
                "/toolsdisplayorder",
                "/timeout",
                "/createstore",
                "/mirror",
                "/bootems",
                "/ems",
                "/debug",
                "/hypervisorsettings",
                "/bootdebug",
                "/clean",
            ];
            if low.iter().any(|t| WRITES.contains(&t.as_str())) {
                out.push(finding(
                    "Change the boot configuration",
                    "Windows boot settings",
                    "A wrong value can stop Windows from starting.",
                ));
            }
        }
        "netsh" => {
            let has = |w: &str| low.iter().any(|t| t == w);
            let state_off = low.windows(2).any(|w| w[0] == "state" && w[1] == "off");
            let legacy_off =
                has("firewall") && (has("disable") || has("mode=disable") || has("opmode=disable"));
            if (has("advfirewall") && state_off) || legacy_off {
                out.push(finding(
                    "Turn off Windows Firewall",
                    "network profiles",
                    "Incoming connections are no longer filtered.",
                ));
            }
        }
        "takeown" => {
            let target = low
                .iter()
                .position(|t| t == "/f")
                .and_then(|i| toks.get(i + 1))
                .and_then(|t| t.as_deref());
            if let Some(path) = target.and_then(|raw| paths::resolve(raw, cx.syntax, cx.cwd))
                && paths::within_windows(&path)
            {
                out.push(permissions_finding(
                    "Take ownership of Windows files",
                    &path,
                ));
            }
        }
        "icacls" => {
            const WRITES: &[&str] = &[
                "/grant",
                "/deny",
                "/remove",
                "/setowner",
                "/reset",
                "/restore",
                "/setintegritylevel",
            ];
            let writes = low.iter().any(|t| {
                let base = t.split(':').next().unwrap_or(t);
                WRITES.contains(&base)
                    || t.starts_with("/inheritance")
                    || t.starts_with("/grant")
                    || t.starts_with("/remove")
            });
            let target = toks.first().and_then(|t| t.as_deref());
            if let (true, Some(path)) = (
                writes,
                target.and_then(|raw| paths::resolve(raw, cx.syntax, cx.cwd)),
            ) && paths::within_windows(&path)
            {
                out.push(permissions_finding(
                    "Change permissions on Windows files",
                    &path,
                ));
            }
        }
        "reg" if low.first().is_some_and(|t| t == "delete") => {
            if let Some(key) = toks
                .get(1)
                .and_then(|t| t.as_deref())
                .and_then(registry_system_key)
            {
                out.push(finding(
                    "Delete a registry key",
                    key,
                    "Removes Windows system configuration. Windows may not start.",
                ));
            }
        }
        "diskpart" => {
            // Scripted diskpart: `(echo select disk 1 & echo clean) | diskpart` or `diskpart /s file`.
            let echoed_clean = line.iter().any(|i| {
                i.name == "echo"
                    && tokens(i)
                        .first()
                        .is_some_and(|t| lower(t).starts_with("clean"))
            });
            let script_clean = low
                .iter()
                .position(|t| t == "/s")
                .and_then(|i| toks.get(i + 1))
                .and_then(|t| t.as_deref())
                .and_then(|raw| paths::resolve(raw, cx.syntax, cx.cwd))
                .and_then(|p| {
                    std::fs::metadata(&p)
                        .ok()
                        .filter(|m| m.len() < 64 * 1024)
                        .map(|_| p)
                })
                .and_then(|p| std::fs::read_to_string(p).ok())
                .is_some_and(|s| {
                    s.lines()
                        .any(|l| l.trim().to_lowercase().starts_with("clean"))
                });
            if echoed_clean || script_clean {
                out.push(finding(
                    "Erase a whole disk",
                    "the disk selected in diskpart",
                    "\"clean\" removes every partition and all data on the disk.",
                ));
            }
        }
        "cmd" if depth < MAX_NESTING => {
            // cmd /c "<line>": analyze the nested line as CMD.
            if let Some(i) = low.iter().position(|t| t == "/c" || t == "/k" || t == "/r") {
                let nested: Vec<&str> =
                    toks[i + 1..].iter().flatten().map(String::as_str).collect();
                if nested.len() == toks.len() - i - 1 {
                    check_into(
                        &cmdline::parse(&nested.join(" ")),
                        Cx {
                            syntax: Syntax::Cmd,
                            cwd: cx.cwd,
                        },
                        depth + 1,
                        out,
                    );
                }
            }
        }
        _ => {}
    }
}

fn is_drive(t: &str) -> bool {
    let b = t.as_bytes();
    (b.len() == 2 || (b.len() == 3 && b[2] == b'\\')) && b[0].is_ascii_alphabetic() && b[1] == b':'
}

fn shadow_finding() -> Finding {
    finding(
        "Delete shadow copies",
        "restore points and previous file versions",
        "System Restore points and previous versions of files are removed for good.",
    )
}

fn permissions_finding(operation: &str, path: &Path) -> Finding {
    finding(
        operation,
        path.display().to_string(),
        "Changes who can modify protected Windows files. Updates and repairs can stop working.",
    )
}

#[cfg(test)]
mod tests {
    use super::super::Analyzer;
    use super::*;

    fn analyzer() -> &'static Analyzer {
        static A: std::sync::OnceLock<Analyzer> = std::sync::OnceLock::new();
        A.get_or_init(Analyzer::default)
    }

    fn cmd(line: &str) -> Vec<Finding> {
        check(&cmdline::parse(line), Syntax::Cmd, None)
    }

    fn ps(line: &str) -> Vec<Finding> {
        let a = analyzer().analyze(Syntax::PowerShell, line);
        assert!(a.parsed, "PowerShell couldn't parse: {line}");
        a.findings
    }

    /// Legitimate admin and maintenance work: never a prompt.
    #[test]
    fn false_positive_suite_produces_no_prompt() {
        let temp = std::env::temp_dir();
        let project = std::env::current_dir().unwrap();
        for line in [
            "sfc /scannow".to_string(),
            "DISM /Online /Cleanup-Image /RestoreHealth".into(),
            "ipconfig /flushdns".into(),
            "net stop spooler && net start spooler".into(),
            format!("del /q \"{}\\build.log\"", temp.display()),
            format!("del /s /q \"{}\\cd-test\\*\"", temp.display()),
            "rd /s /q %TEMP%\\cd-old".into(),
            "rd /s /q node_modules".into(),
            "rd /s /q C:\\Windows\\SoftwareDistribution\\Download".into(),
            "del C:\\Windows\\Temp\\*".into(),
            "echo rd /s /q C:\\".into(),
            "bcdedit /enum".into(),
            "vssadmin list shadows".into(),
            "reg query HKLM\\SYSTEM\\CurrentControlSet".into(),
            "reg delete HKCU\\Software\\Old /f".into(),
            "icacls C:\\Windows\\System32".into(),
            "takeown /f %TEMP%\\locked.txt".into(),
            "netsh advfirewall show allprofiles state".into(),
            "format".into(),
            "chkdsk C: /scan".into(),
        ] {
            assert_eq!(cmd(&line), vec![], "{line}");
        }
        for line in [
            "Restart-Service -Name Spooler".to_string(),
            "Get-ChildItem C:\\ -Recurse -Filter *.log".into(),
            format!(
                "Remove-Item -Recurse -Force '{}\\target'",
                project.display()
            ),
            "Remove-Item -Recurse $env:TEMP\\cd-old".into(),
            "Remove-Item C:\\Windows\\Temp\\x.log".into(),
            "Remove-Item -Recurse $dir".into(),
            "Remove-Item -Recurse C:\\ -WhatIf".into(),
            "Set-MpPreference -DisableRealtimeMonitoring $false".into(),
            "Set-MpPreference -ExclusionPath C:\\dev".into(),
            "Set-NetFirewallProfile -Profile Domain -Enabled True".into(),
            "Get-Volume; Get-Disk".into(),
            "Write-Output 'Remove-Item -Recurse C:\\'".into(),
            "Remove-ItemProperty HKCU:\\Software\\X -Name Y".into(),
        ] {
            assert_eq!(ps(&line), vec![], "{line}");
        }
    }

    #[test]
    fn true_positive_suite_produces_one_finding_each() {
        for line in [
            "format D: /q",
            "rd /s /q C:\\",
            "RMDIR /S /Q \"%SystemRoot%\"",
            "rd /s /q %windir%\\System32\\..",
            "rd/s/q C:\\WINDOWS\\system32",
            "del /f /s /q C:\\*",
            "erase /s /q %USERPROFILE%\\*.*",
            "rd /s /q \"C:\\Documents and Settings\"",
            "rd /s /q \\",
            "vssadmin delete shadows /all /quiet",
            "wmic shadowcopy delete",
            "bcdedit /set {current} safeboot minimal",
            "bcdedit /deletevalue {default} bootmenupolicy",
            "netsh advfirewall set allprofiles state off",
            "takeown /f C:\\Windows\\System32\\drivers\\etc\\hosts",
            "icacls C:\\Windows\\System32 /grant Everyone:F /t",
            "reg delete HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip /f",
            "(echo select disk 1 & echo clean) | diskpart",
            "cmd /c \"rd /s /q C:\\\"",
            "ver & rd /s /q C:\\ > nul 2>&1",
        ] {
            assert_eq!(cmd(line).len(), 1, "{line}: {:?}", cmd(line));
        }
        for line in [
            "Remove-Item -Recurse -Force C:\\",
            "rm -r -fo $env:windir",
            "ri C:\\Windows\\System32 -Recurse",
            "del -Recurse ~",
            "Remove-Item -LiteralPath \"$env:USERPROFILE\" -Recurse:$true",
            "Remove-Item -Path ${env:SystemRoot}\\.. -r",
            "Microsoft.PowerShell.Management\\Remove-Item -Recurse C:\\WINDOWS",
            "Get-Date; Remove-Item -Recurse FileSystem::C:\\Windows",
            "Format-Volume -DriveLetter D",
            "Clear-Disk -Number 1 -RemoveData",
            "Remove-Partition -DiskNumber 1 -PartitionNumber 2",
            "Set-MpPreference -DisableRealtimeMonitoring $true",
            "Set-MpPreference -drtm 1",
            "Set-NetFirewallProfile -Profile Domain,Public -Enabled False",
            "Remove-Item -Path HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Foo -Recurse",
            "vssadmin delete shadows /all",
            "bcdedit.exe /set '{current}' testsigning on",
            "cmd /c 'rd /s /q C:\\'",
        ] {
            assert_eq!(ps(line).len(), 1, "{line}: {:?}", ps(line));
        }
    }

    #[test]
    fn findings_name_the_resolved_target() {
        let f = &cmd("rd /s /q %SystemRoot%\\.")[0];
        assert_eq!(f.operation, "Delete a folder and everything in it");
        assert!(
            f.target
                .to_lowercase()
                .contains("windows (the windows folder)"),
            "{}",
            f.target
        );
        assert!(f.consequence.contains("Windows will stop working"));
        let f = &ps("Clear-Disk -Number 3")[0];
        assert_eq!(f.target, "disk 3");
    }

    #[test]
    fn unparseable_powershell_fails_open() {
        let a = analyzer().analyze(Syntax::PowerShell, "Remove-Item -Recurse C:\\ (");
        assert!(!a.parsed);
        assert!(a.findings.is_empty());
    }

    #[test]
    fn diskpart_script_files_are_read() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("wipe.txt");
        std::fs::write(&script, "select disk 9\r\nclean\r\n").unwrap();
        assert_eq!(
            cmd(&format!("diskpart /s \"{}\"", script.display())).len(),
            1
        );
        std::fs::write(&script, "list disk\r\n").unwrap();
        assert!(cmd(&format!("diskpart /s \"{}\"", script.display())).is_empty());
    }
}
