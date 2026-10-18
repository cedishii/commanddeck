//! PowerShell command lines parsed by PowerShell's own language parser
//! (`System.Management.Automation.Language.Parser.ParseInput`). The helper
//! process only builds an AST and reports command names and static argument
//! values. It never executes the text it receives.
//!
//! One long-lived, windowless `powershell.exe` serves all requests. Any
//! failure (not installed, timeout, parse errors) returns `None`: the caller
//! fails open.

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;

use super::{Arg, Invocation};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const FIRST_REPLY: Duration = Duration::from_secs(8);
const REPLY: Duration = Duration::from_secs(2);
const MAX_INPUT: usize = 64 * 1024;

/// Reads base64(UTF-8 script) lines; writes one JSON line per request.
/// Values: string constants, $true/$false, numbers, $env:X and $HOME, and
/// strings built only from those. Anything else is null (computed at runtime).
const HELPER: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function V($e) {
  if ($null -eq $e) { return $null }
  if ($e -is [System.Management.Automation.Language.StringConstantExpressionAst]) { return $e.Value }
  if ($e -is [System.Management.Automation.Language.ConstantExpressionAst]) { return [string]$e.Value }
  if ($e -is [System.Management.Automation.Language.VariableExpressionAst]) {
    $p = $e.VariablePath
    if ($p.IsDriveQualified -and $p.DriveName -eq 'env') { return [Environment]::GetEnvironmentVariable($p.UserPath.Substring(4)) }
    switch ($p.UserPath) { 'true' { return 'True' } 'false' { return 'False' } 'HOME' { return $HOME } }
    return $null
  }
  if ($e -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {
    $s = $e.Value
    foreach ($n in $e.NestedExpressions) {
      if ($n -isnot [System.Management.Automation.Language.VariableExpressionAst]) { return $null }
      $v = V $n
      if ($null -eq $v) { return $null }
      $s = $s.Replace($n.Extent.Text, $v)
    }
    return $s
  }
  return $null
}
$in = [Console]::In
while ($null -ne ($line = $in.ReadLine())) {
  try {
    $src = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { [Console]::Out.WriteLine('{"ok":false}'); [Console]::Out.Flush(); continue }
    $cmds = New-Object System.Collections.ArrayList
    foreach ($c in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.CommandAst] }, $true)) {
      $els = New-Object System.Collections.ArrayList
      $name = V $c.CommandElements[0]
      for ($i = 1; $i -lt $c.CommandElements.Count; $i++) {
        $el = $c.CommandElements[$i]
        if ($el -is [System.Management.Automation.Language.CommandParameterAst]) {
          $arg = $null; $has = $null -ne $el.Argument
          if ($has) { $arg = V $el.Argument }
          [void]$els.Add(@{ p = $el.ParameterName; colon = $has; a = $arg })
        } else {
          [void]$els.Add(@{ v = (V $el) })
        }
      }
      [void]$cmds.Add(@{ name = $name; args = $els.ToArray() })
    }
    $json = ConvertTo-Json -InputObject @{ ok = $true; commands = $cmds.ToArray() } -Depth 6 -Compress
    [Console]::Out.WriteLine($json)
  } catch {
    [Console]::Out.WriteLine('{"ok":false}')
  }
  [Console]::Out.Flush()
}
"#;

#[derive(Deserialize)]
struct Reply {
    ok: bool,
    #[serde(default)]
    commands: OneOrMany<RawCommand>,
}

#[derive(Deserialize)]
struct RawCommand {
    name: Option<String>,
    #[serde(default)]
    args: OneOrMany<RawArg>,
}

#[derive(Deserialize)]
struct RawArg {
    p: Option<String>,
    #[serde(default)]
    colon: bool,
    a: Option<String>,
    v: Option<String>,
}

/// Windows PowerShell 5.1's ConvertTo-Json may emit a one-element array as the element itself.
#[derive(Deserialize)]
#[serde(untagged)]
enum OneOrMany<T> {
    Many(Vec<T>),
    One(T),
}

impl<T> Default for OneOrMany<T> {
    fn default() -> Self {
        Self::Many(Vec::new())
    }
}

impl<T> OneOrMany<T> {
    fn into_vec(self) -> Vec<T> {
        match self {
            Self::Many(v) => v,
            Self::One(t) => vec![t],
        }
    }
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
    replies: Receiver<String>,
    answered: bool,
}

impl Drop for Helper {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct PsParser {
    helper: Mutex<Option<Helper>>,
}

impl PsParser {
    /// Starts the helper ahead of the first request (e.g. when a PowerShell page opens).
    pub fn warm_up(&self) {
        if let Ok(mut guard) = self.helper.lock()
            && guard.is_none()
        {
            *guard = spawn();
        }
    }

    /// Commands in `script`, or `None` if it couldn't be parsed or the helper failed.
    pub fn parse(&self, script: &str) -> Option<Vec<Invocation>> {
        if script.len() > MAX_INPUT {
            return None;
        }
        let mut guard = self.helper.lock().ok()?;
        if guard.is_none() {
            *guard = spawn();
        }
        let helper = guard.as_mut()?;
        let line = base64::engine::general_purpose::STANDARD.encode(script.as_bytes());
        let sent = writeln!(helper.stdin, "{line}").and_then(|()| helper.stdin.flush());
        let wait = if helper.answered { REPLY } else { FIRST_REPLY };
        let reply = match sent.ok().map(|()| helper.replies.recv_timeout(wait)) {
            Some(Ok(reply)) => reply,
            Some(Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected)) | None => {
                *guard = None; // kill; a fresh helper starts next time
                return None;
            }
        };
        helper.answered = true;
        let reply: Reply = serde_json::from_str(&reply).ok()?;
        if !reply.ok {
            return None;
        }
        Some(
            reply
                .commands
                .into_vec()
                .into_iter()
                .filter_map(|c| {
                    let name = c.name?;
                    let args = c
                        .args
                        .into_vec()
                        .into_iter()
                        .map(|a| match a.p {
                            Some(p) => Arg::Param {
                                name: p.to_ascii_lowercase(),
                                value: a.colon.then_some(a.a),
                            },
                            None => Arg::Value(a.v),
                        })
                        .collect();
                    Some(Invocation::new(&name, args))
                })
                .collect(),
        )
    }
}

fn spawn() -> Option<Helper> {
    let program = crate::pty::shell_path(crate::pty::ShellKind::Powershell)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(
        HELPER
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<u8>>(),
    );
    let mut child = crate::pty::spawn_std(
        Command::new(program)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &encoded,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW),
    )
    .ok()?;

    let stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let (tx, replies) = channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    Some(Helper {
        child,
        stdin,
        replies,
        answered: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parser() -> &'static PsParser {
        static P: std::sync::OnceLock<PsParser> = std::sync::OnceLock::new();
        P.get_or_init(PsParser::default)
    }

    #[test]
    fn reports_names_parameters_and_static_values() {
        let cmds = parser()
            .parse("Remove-Item -Recurse -Path:$env:windir 'C:\\x' -Force:$false; Get-Process | Stop-Process")
            .unwrap();
        let names: Vec<_> = cmds.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["remove-item", "get-process", "stop-process"]);
        let windir = std::env::var("windir").unwrap();
        assert_eq!(
            cmds[0].args,
            vec![
                Arg::Param {
                    name: "recurse".into(),
                    value: None
                },
                Arg::Param {
                    name: "path".into(),
                    value: Some(Some(windir))
                },
                Arg::Value(Some("C:\\x".into())),
                Arg::Param {
                    name: "force".into(),
                    value: Some(Some("False".into()))
                },
            ]
        );
    }

    #[test]
    fn expandable_strings_and_runtime_values() {
        let cmds = parser()
            .parse("ri \"$env:SystemRoot\\System32\" -r; ri \"$x\\y\" ; ri (Get-Location)")
            .unwrap();
        let root = std::env::var("SystemRoot").unwrap();
        assert_eq!(
            cmds[0].name, "ri",
            "aliases are resolved by the rules, not the parser"
        );
        assert_eq!(
            cmds[0].args[0],
            Arg::Value(Some(format!("{root}\\System32")))
        );
        assert_eq!(cmds[1].args[0], Arg::Value(None));
        assert_eq!(cmds[2].args[0], Arg::Value(None));
    }

    #[test]
    fn nothing_is_executed_and_parse_errors_return_none() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("ran.txt");
        let script = format!("New-Item -ItemType File -Path '{}'", marker.display());
        assert!(parser().parse(&script).is_some());
        assert!(!marker.exists());
        assert!(parser().parse("Remove-Item 'unterminated").is_none());
        assert!(parser().parse("if (").is_none());
        // Still healthy afterwards; unicode survives the round trip.
        let cmds = parser().parse("Write-Output 'π ✓ é'").unwrap();
        assert_eq!(cmds[0].args[0], Arg::Value(Some("π ✓ é".into())));
    }
}
