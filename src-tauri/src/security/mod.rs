//! Structural detection of well-known high-impact operations (SECURITY.md §4, §6.2).
//!
//! parse (shell-aware) → identify the operation (aliases resolved, parameters
//! matched) → resolve its target (paths canonicalized) → report only known
//! catastrophic operations on resolved critical targets. Anything that can't be
//! parsed or resolved produces no finding: detection fails open and is
//! deliberately incomplete. It never changes or blocks the text.

mod cmdline;
pub mod grants;
pub mod password;
pub mod paths;
mod psparse;
mod rules;

use serde::Serialize;

pub use paths::Syntax;
pub use psparse::PsParser;

/// One command found in a line, with its name normalized (lowercase, no
/// folder, no `.exe`/`.com`) and its arguments in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub name: String,
    pub args: Vec<Arg>,
}

impl Invocation {
    pub fn new(raw_name: &str, args: Vec<Arg>) -> Self {
        let name = raw_name.trim_matches(|c| c == '"' || c == '\'');
        let name = name
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(name)
            .to_lowercase();
        let name = [".exe", ".com"]
            .iter()
            .find_map(|ext| name.strip_suffix(ext))
            .map_or_else(|| name.clone(), str::to_string);
        Self { name, args }
    }
}

/// An argument. `None` values are computed at runtime and unknowable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Arg {
    /// PowerShell `-Name` (`value` is set only for the `-Name:value` form).
    Param {
        name: String,
        value: Option<Option<String>>,
    },
    Value(Option<String>),
}

/// A reliably identified high-impact operation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// What was detected, e.g. "Delete a folder and everything in it".
    pub operation: String,
    /// The resolved target, e.g. `C:\Windows (the Windows folder)`.
    pub target: String,
    /// What happens if it runs.
    pub consequence: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub findings: Vec<Finding>,
    /// False when the text couldn't be parsed (then there are no findings).
    pub parsed: bool,
}

#[derive(Default)]
pub struct Analyzer {
    ps: PsParser,
}

impl Analyzer {
    pub fn warm_up_powershell(&self) {
        self.ps.warm_up();
    }

    pub fn analyze(&self, syntax: Syntax, text: &str) -> Analysis {
        self.analyze_in(syntax, text, None)
    }

    /// Like `analyze`, resolving relative paths against `cwd` (known for one-click runs).
    pub fn analyze_in(
        &self,
        syntax: Syntax,
        text: &str,
        cwd: Option<&std::path::Path>,
    ) -> Analysis {
        let invocations = match syntax {
            Syntax::Cmd => Some(cmdline::parse(text)),
            Syntax::PowerShell => self.ps.parse(text),
        };
        match invocations {
            Some(invocations) => Analysis {
                findings: rules::check(&invocations, syntax, cwd),
                parsed: true,
            },
            None => Analysis {
                findings: Vec::new(),
                parsed: false,
            },
        }
    }
}
