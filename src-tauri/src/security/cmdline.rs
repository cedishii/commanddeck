//! CMD command-line splitting for analysis (never for execution).
//!
//! Follows cmd.exe's rules closely enough to find each command and its
//! arguments: quotes group text, `^` escapes the next character outside
//! quotes, `&`, `&&`, `||`, `|` and line breaks separate commands, and
//! redirections (`>`, `>>`, `<`, `2>&1`) are removed with their targets.

use super::{Arg, Invocation};

pub fn parse(text: &str) -> Vec<Invocation> {
    let mut out = Vec::new();
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut started = false; // distinguishes "" (an empty quoted token) from nothing
    let mut in_quote = false;
    let mut skip_next_token = false;
    let mut chars = text.chars().peekable();

    let finish_token =
        |tokens: &mut Vec<String>, current: &mut String, started: &mut bool, skip: &mut bool| {
            if *started {
                if *skip {
                    *skip = false;
                } else {
                    tokens.push(std::mem::take(current));
                }
            }
            current.clear();
            *started = false;
        };

    while let Some(c) = chars.next() {
        if in_quote {
            if c == '"' {
                in_quote = false;
            } else if c == '\n' || c == '\r' {
                in_quote = false;
                finish_token(
                    &mut tokens,
                    &mut current,
                    &mut started,
                    &mut skip_next_token,
                );
                push(&mut out, &mut tokens);
            } else {
                current.push(c);
            }
            continue;
        }
        match c {
            '"' => {
                in_quote = true;
                started = true;
            }
            '^' => {
                if let Some(next) = chars.next()
                    && next != '\n'
                    && next != '\r'
                {
                    current.push(next);
                    started = true;
                }
            }
            ' ' | '\t' => finish_token(
                &mut tokens,
                &mut current,
                &mut started,
                &mut skip_next_token,
            ),
            '&' | '|' | '\n' | '\r' => {
                if (c == '&' || c == '|') && chars.peek() == Some(&c) {
                    chars.next();
                }
                finish_token(
                    &mut tokens,
                    &mut current,
                    &mut started,
                    &mut skip_next_token,
                );
                push(&mut out, &mut tokens);
            }
            '>' | '<' => {
                // "2>" / "1>": the digit belongs to the redirection, not the arguments.
                if current.len() == 1 && current.chars().all(|d| d.is_ascii_digit()) {
                    current.clear();
                    started = false;
                } else {
                    finish_token(
                        &mut tokens,
                        &mut current,
                        &mut started,
                        &mut skip_next_token,
                    );
                }
                if chars.peek() == Some(&'>') {
                    chars.next();
                }
                if chars.peek() == Some(&'&') {
                    // 2>&1: the handle number follows directly.
                    chars.next();
                    while chars.peek().is_some_and(char::is_ascii_digit) {
                        chars.next();
                    }
                } else {
                    skip_next_token = true;
                }
            }
            _ => {
                current.push(c);
                started = true;
            }
        }
    }
    finish_token(
        &mut tokens,
        &mut current,
        &mut started,
        &mut skip_next_token,
    );
    push(&mut out, &mut tokens);
    out
}

fn push(out: &mut Vec<Invocation>, tokens: &mut Vec<String>) {
    let mut it = std::mem::take(tokens).into_iter();
    let Some(first) = it.next() else { return };
    // "@" hides echo; "(" opens a group: neither is part of the name.
    let first = first.trim_start_matches(['@', '(']).to_string();
    if first.is_empty() {
        return;
    }
    // "rd/s" style: a switch glued to an internal command's name.
    let (name, glued) = match first.find('/') {
        Some(i) if i > 0 && !first[..i].contains(['\\', ':']) => {
            (first[..i].to_string(), Some(first[i..].to_string()))
        }
        _ => (first, None),
    };
    let args = glued
        .into_iter()
        .chain(it)
        .map(|t| Arg::Value(Some(t)))
        .collect();
    out.push(Invocation::new(&name, args));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(text: &str) -> Vec<(String, Vec<String>)> {
        parse(text)
            .into_iter()
            .map(|i| {
                let args = i
                    .args
                    .iter()
                    .map(|a| match a {
                        Arg::Value(Some(v)) => v.clone(),
                        other => format!("{other:?}"),
                    })
                    .collect();
                (i.name, args)
            })
            .collect()
    }

    fn s(name: &str, args: &[&str]) -> (String, Vec<String>) {
        (name.into(), args.iter().map(|a| (*a).to_string()).collect())
    }

    #[test]
    fn splits_commands_and_keeps_quoted_separators() {
        assert_eq!(
            summary(r#"echo "a & b" && rd /s /q "C:\My Dir" | more || ver & dir"#),
            vec![
                s("echo", &["a & b"]),
                s("rd", &["/s", "/q", r"C:\My Dir"]),
                s("more", &[]),
                s("ver", &[]),
                s("dir", &[]),
            ]
        );
    }

    #[test]
    fn caret_escapes_and_redirections_are_handled() {
        assert_eq!(summary("echo a^&b"), vec![s("echo", &["a&b"])]);
        assert_eq!(
            summary(r"dir C:\ > out.txt 2>&1 & type < in.txt"),
            vec![s("dir", &[r"C:\"]), s("type", &[])]
        );
        assert_eq!(summary("dir 2> err.txt /b"), vec![s("dir", &["/b"])]);
    }

    #[test]
    fn names_are_normalized() {
        assert_eq!(
            summary(r"@C:\Windows\System32\VSSADMIN.EXE delete shadows")[0].0,
            "vssadmin"
        );
        assert_eq!(summary(r"rd/s/q C:\")[0], s("rd", &["/s/q", r"C:\"]));
        assert_eq!(summary("\"format.com\" D:")[0], s("format", &["D:"]));
    }

    #[test]
    fn lines_are_separate_commands_and_blank_input_is_empty() {
        assert_eq!(summary("ver\r\nvol").len(), 2);
        assert!(parse("   ").is_empty());
        assert!(parse("").is_empty());
    }
}
