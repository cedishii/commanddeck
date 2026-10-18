//! Offline command search: name, aliases, keywords, plain-language tasks, syntax.
//!
//! Scoring is a weighted token match with IDF (rare words count more), light
//! stemming, a small synonym table for everyday wording ("internet", "app"),
//! a coverage factor (matching all query words beats matching one) and phrase
//! bonuses for exact aliases, syntax and task phrases. Relevance is guarded by
//! the test suite at the bottom of this file.

use std::collections::{HashMap, HashSet};

use super::{Command, Shell};

const STOP_WORDS: &[&str] = &[
    "a", "an", "the", "to", "of", "in", "on", "for", "is", "are", "my", "me", "i", "how", "do",
    "does", "can", "this", "that", "with", "and", "or", "it", "be", "please", "want", "see",
    "show", "view",
];

/// Everyday words mapped to the vocabulary commands are described with.
const SYNONYMS: &[(&str, &[&str])] = &[
    (
        "internet",
        &["network", "connectivity", "connection", "dns", "online"],
    ),
    ("wifi", &["wlan", "wireless"]),
    ("wi-fi", &["wlan", "wireless"]),
    ("app", &["process", "program"]),
    ("application", &["process", "program"]),
    ("program", &["process"]),
    ("kill", &["stop", "end"]),
    ("end", &["stop", "kill"]),
    ("close", &["stop", "kill"]),
    ("delete", &["remove", "del", "erase"]),
    ("remove", &["delete"]),
    ("erase", &["delete", "format"]),
    ("large", &["largest", "big", "size"]),
    ("big", &["largest", "large", "size"]),
    ("huge", &["largest", "large", "size"]),
    ("space", &["size", "free"]),
    ("drive", &["disk", "volume"]),
    ("disk", &["drive", "volume"]),
    ("slow", &["cpu", "memory", "latency"]),
    ("fix", &["repair", "reset", "troubleshoot"]),
    ("repair", &["fix", "reset"]),
    ("reboot", &["restart"]),
    ("directory", &["folder"]),
    ("folder", &["directory"]),
    ("ram", &["memory"]),
    ("antivirus", &["defender"]),
];

const W_ALIAS: f32 = 6.0;
const W_SYNTAX: f32 = 4.0;
const W_NAME: f32 = 3.0;
const W_KEYWORD: f32 = 3.0;
const W_TASK: f32 = 3.0;
const W_SUMMARY: f32 = 1.0;
const W_CATEGORY: f32 = 1.0;
const SYNONYM_FACTOR: f32 = 0.6;
const MIN_SCORE: f32 = 2.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub index: usize,
    pub score: f32,
}

fn stem(word: &str) -> String {
    let w = word;
    let n = w.chars().count();
    if n > 4 && w.ends_with("sses") {
        return w[..w.len() - 2].to_string();
    }
    if n > 4 && w.ends_with("ies") {
        return format!("{}y", &w[..w.len() - 3]);
    }
    if n > 5 && w.ends_with("ing") {
        let base = &w[..w.len() - 3];
        let b = base.as_bytes();
        if b.len() >= 2 && b[b.len() - 1] == b[b.len() - 2] && !b"aeiou".contains(&b[b.len() - 1]) {
            return base[..base.len() - 1].to_string();
        }
        return base.to_string();
    }
    if n > 3 && w.ends_with('s') && !w.ends_with("ss") && !w.ends_with("us") {
        return w[..w.len() - 1].to_string();
    }
    w.to_string()
}

/// Lowercased raw tokens: letters, digits and the joiners used in command syntax.
fn raw_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '-' | '/' | '.' | '_')))
        .map(|t| t.trim_matches(|c| matches!(c, '-' | '.' | '_')))
        .filter(|t| !t.is_empty())
        .map(String::from)
        .collect()
}

/// Index tokens: stemmed raw tokens plus their parts split on '-', '/', '.'
/// (so "Get-Process" also indexes "get" and "process").
fn index_tokens(text: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    for t in raw_tokens(text) {
        for part in t.split(['-', '/', '.']).filter(|p| !p.is_empty()) {
            out.insert(stem(part));
        }
        out.insert(stem(&t));
    }
    out
}

fn normalized_phrase(text: &str) -> String {
    raw_tokens(text)
        .iter()
        .filter(|t| !STOP_WORDS.contains(&t.as_str()))
        .map(|t| stem(t))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whole-word phrase containment ("show script" does not contain "ip").
fn contains_words(haystack: &str, needle: &str) -> bool {
    !needle.is_empty() && format!(" {haystack} ").contains(&format!(" {needle} "))
}

struct Doc {
    alias: HashSet<String>,
    syntax: HashSet<String>,
    name: HashSet<String>,
    keyword: HashSet<String>,
    task: HashSet<String>,
    summary: HashSet<String>,
    category: HashSet<String>,
    alias_phrases: Vec<String>,
    task_phrases: Vec<String>,
    keyword_phrases: Vec<String>,
    name_phrase: String,
    syntax_lower: String,
}

impl Doc {
    fn new(c: &Command, user_aliases: &[String]) -> Self {
        let all_aliases: Vec<&String> = c.aliases.iter().chain(user_aliases.iter()).collect();
        let join = |items: &[&String]| {
            items
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        };
        Doc {
            alias: index_tokens(&join(&all_aliases)),
            syntax: index_tokens(&c.syntax),
            name: index_tokens(&c.name),
            keyword: index_tokens(&c.keywords.join(" ")),
            task: index_tokens(&c.tasks.join(" ")),
            summary: index_tokens(&c.summary),
            category: index_tokens(c.category.search_words()),
            alias_phrases: all_aliases.iter().map(|a| normalized_phrase(a)).collect(),
            task_phrases: c.tasks.iter().map(|t| normalized_phrase(t)).collect(),
            keyword_phrases: c.keywords.iter().map(|k| normalized_phrase(k)).collect(),
            name_phrase: normalized_phrase(&c.name),
            syntax_lower: c.syntax.to_lowercase(),
        }
    }

    fn fields(&self) -> [(&HashSet<String>, f32); 7] {
        [
            (&self.alias, W_ALIAS),
            (&self.syntax, W_SYNTAX),
            (&self.name, W_NAME),
            (&self.keyword, W_KEYWORD),
            (&self.task, W_TASK),
            (&self.summary, W_SUMMARY),
            (&self.category, W_CATEGORY),
        ]
    }

    fn all_tokens(&self) -> HashSet<&String> {
        self.fields()
            .iter()
            .flat_map(|(set, _)| set.iter())
            .collect()
    }

    /// Best weighted match of one query term across fields: exact 1.0, prefix 0.7.
    fn term_score(&self, term: &str) -> f32 {
        let mut best = 0.0f32;
        for (set, weight) in self.fields() {
            let m = if set.contains(term) {
                1.0
            } else if term.chars().count() >= 3 && set.iter().any(|t| t.starts_with(term)) {
                0.7
            } else {
                0.0
            };
            best = best.max(m * weight);
        }
        best
    }
}

/// Query word plus its synonyms, all stemmed.
fn expand(word: &str) -> Vec<(String, f32)> {
    let mut out = vec![(stem(word), 1.0)];
    for (key, syns) in SYNONYMS {
        if stem(key) == stem(word) {
            out.extend(syns.iter().map(|s| (stem(s), SYNONYM_FACTOR)));
        }
    }
    out
}

/// Searches `commands`; `user_aliases` maps command id → personal aliases.
/// Returns hits ordered by descending score (ties: catalog order).
pub fn search(
    commands: &[Command],
    user_aliases: &HashMap<String, Vec<String>>,
    query: &str,
    shell: Option<Shell>,
    limit: usize,
) -> Vec<Hit> {
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }
    let words: Vec<String> = raw_tokens(query)
        .into_iter()
        .filter(|t| !STOP_WORDS.contains(&t.as_str()))
        .collect();
    let phrase = normalized_phrase(query);
    let query_lower = query.to_lowercase();
    let no_aliases = Vec::new();

    let candidates: Vec<(usize, Doc)> = commands
        .iter()
        .enumerate()
        .filter(|(_, c)| shell.is_none_or(|s| c.shell == s))
        .map(|(i, c)| {
            (
                i,
                Doc::new(c, user_aliases.get(&c.id).unwrap_or(&no_aliases)),
            )
        })
        .collect();

    // Inverse document frequency over the candidate set.
    let n = candidates.len().max(1) as f32;
    let mut df: HashMap<&String, usize> = HashMap::new();
    for (_, d) in &candidates {
        for t in d.all_tokens() {
            *df.entry(t).or_default() += 1;
        }
    }
    let idf = |term: &str| -> f32 {
        let count = df
            .iter()
            .filter(|(t, _)| t.as_str() == term || (term.len() >= 3 && t.starts_with(term)))
            .map(|(_, c)| *c)
            .max()
            .unwrap_or(0);
        (1.0 + n / (1.0 + count as f32)).ln()
    };

    let mut hits: Vec<Hit> = candidates
        .iter()
        .filter_map(|(index, doc)| {
            let mut total = 0.0f32;
            let mut matched_words = 0usize;
            for word in &words {
                let mut best = 0.0f32;
                for (term, factor) in expand(word) {
                    best = best.max(doc.term_score(&term) * factor * idf(&term));
                }
                if best > 0.0 {
                    matched_words += 1;
                }
                total += best;
            }

            // Phrase bonuses.
            if !phrase.is_empty() {
                if doc.alias_phrases.contains(&phrase) {
                    total += 40.0;
                }
                if doc.syntax_lower == query_lower {
                    total += 50.0;
                } else if query_lower.chars().count() >= 3
                    && doc.syntax_lower.starts_with(&query_lower)
                {
                    total += 15.0;
                }
                if doc.task_phrases.contains(&phrase) {
                    total += 14.0;
                } else if doc
                    .task_phrases
                    .iter()
                    .any(|t| contains_words(t, &phrase) || contains_words(&phrase, t))
                {
                    total += 7.0;
                }
                if doc.keyword_phrases.contains(&phrase) {
                    total += 10.0;
                }
                if contains_words(&doc.name_phrase, &phrase) {
                    total += 8.0;
                }
            }

            if !words.is_empty() {
                let coverage = matched_words as f32 / words.len() as f32;
                total *= 0.4 + 0.6 * coverage;
                if words.len() >= 2 && coverage < 0.5 {
                    total *= 0.3;
                }
            }
            (total >= MIN_SCORE).then_some(Hit {
                index: *index,
                score: total,
            })
        })
        .collect();

    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.index.cmp(&b.index)));
    hits.truncate(limit);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::load_builtin;

    fn ids(query: &str, shell: Option<Shell>, n: usize) -> Vec<String> {
        let commands = load_builtin().unwrap();
        search(&commands, &HashMap::new(), query, shell, n)
            .into_iter()
            .map(|h| commands[h.index].id.clone())
            .collect()
    }

    fn assert_top(query: &str, n: usize, expected: &[&str]) {
        let top = ids(query, None, n);
        for e in expected {
            assert!(
                top.iter().any(|t| t == e),
                "'{query}': expected {e} in top {n}, got {top:?}"
            );
        }
    }

    #[test]
    fn stemming() {
        assert_eq!(stem("processes"), "process");
        assert_eq!(stem("process"), "process");
        assert_eq!(stem("files"), "file");
        assert_eq!(stem("running"), "run");
        assert_eq!(stem("directories"), "directory");
        assert_eq!(stem("status"), "status");
    }

    #[test]
    fn flush_dns_finds_both_shells_with_cmd_first() {
        let top = ids("flush dns", None, 2);
        assert_eq!(top[0], "cmd.ipconfig.flushdns", "{top:?}");
        assert!(top.contains(&"ps.clear-dns-cache".to_string()), "{top:?}");
    }

    #[test]
    fn fix_internet_returns_network_repairs() {
        assert_top(
            "fix internet",
            6,
            &[
                "cmd.netsh.winsock-reset",
                "cmd.ipconfig.flushdns",
                "cmd.ping",
            ],
        );
        let top = ids("fix internet", None, 10);
        assert!(!top.iter().any(|t| t.contains("format")), "{top:?}");
    }

    #[test]
    fn find_large_files() {
        let top = ids("find large files", None, 3);
        assert_eq!(top[0], "ps.largest-files", "{top:?}");
        assert!(top.contains(&"ps.folder-size".to_string()), "{top:?}");
    }

    #[test]
    fn running_applications_returns_cmd_and_powershell_options() {
        let mut top = ids("see running applications", None, 2);
        top.sort();
        assert_eq!(
            top,
            vec!["cmd.tasklist".to_string(), "ps.get-process".to_string()]
        );
    }

    #[test]
    fn exact_names_aliases_and_syntax() {
        assert_top(
            "ipconfig",
            2,
            &["cmd.ipconfig.all", "cmd.ipconfig.flushdns"],
        );
        assert_eq!(
            ids("ipconfig /flushdns", None, 1),
            vec!["cmd.ipconfig.flushdns"]
        );
        assert_eq!(ids("Get-Process", None, 1), vec!["ps.get-process"]);
        assert_eq!(ids("netstat -ano", None, 1), vec!["cmd.netstat.ano"]);
        assert_eq!(ids("uptime", None, 1), vec!["ps.uptime"]);
    }

    #[test]
    fn plain_language_tasks() {
        assert_eq!(ids("delete a folder", None, 1), vec!["cmd.rd.recursive"]);
        assert_top(
            "is the firewall on",
            2,
            &["cmd.netsh.firewall-show", "ps.firewall-profiles"],
        );
        assert_top(
            "kill a frozen program",
            3,
            &["cmd.taskkill.image", "ps.stop-process"],
        );
        assert_top(
            "what is my ip",
            3,
            &["cmd.ipconfig.all", "ps.ip-configuration"],
        );
        assert_top("why can't i run scripts", 2, &["ps.execution-policy-list"]);
        assert_top(
            "how much disk space is left",
            3,
            &["ps.volumes", "cmd.fsutil.diskfree"],
        );
    }

    #[test]
    fn shell_filter_excludes_other_shell() {
        let top = ids("flush dns", Some(Shell::Powershell), 5);
        assert_eq!(top.first().map(String::as_str), Some("ps.clear-dns-cache"));
        assert!(top.iter().all(|t| t.starts_with("ps.")), "{top:?}");
    }

    #[test]
    fn generic_words_do_not_flood_results() {
        assert!(ids("zzqqx", None, 10).is_empty());
        assert!(ids("", None, 10).is_empty());
        assert!(ids("the a of", None, 10).is_empty());
        let dns = ids("dns", None, 10);
        assert!(
            !dns.iter()
                .any(|t| t.contains("format") || t.contains("taskkill")),
            "{dns:?}"
        );
    }

    /// Dev aid: `cargo test print_rankings -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn print_rankings() {
        let commands = load_builtin().unwrap();
        for q in [
            "fix internet",
            "flush dns",
            "find large files",
            "see running applications",
            "dns",
            "delete",
            "kill",
            "network",
            "disk",
            "admin",
            "wifi",
            "slow computer",
            "restart",
            "ip",
            "port",
            "files",
        ] {
            let hits = search(&commands, &HashMap::new(), q, None, 6);
            let row: Vec<String> = hits
                .iter()
                .map(|h| format!("{} ({:.1})", commands[h.index].id, h.score))
                .collect();
            println!("{q:>26} => {}", row.join(", "));
        }
    }

    #[test]
    fn short_queries_match_whole_words_only_regression() {
        // "ip" must not match inside "script" (execution-policy entries).
        let top = ids("ip", None, 10);
        assert!(
            !top.iter().any(|t| t.contains("execution-policy")),
            "{top:?}"
        );
        assert!(
            top.contains(&"cmd.ipconfig.all".to_string())
                || top.contains(&"ps.ip-configuration".to_string()),
            "{top:?}"
        );
        assert!(contains_words("show script execution policy", "script"));
        assert!(!contains_words("show script execution policy", "ip"));
    }

    #[test]
    fn user_aliases_are_searchable() {
        let commands = load_builtin().unwrap();
        let mut aliases = HashMap::new();
        aliases.insert("ps.uptime".to_string(), vec!["howlong".to_string()]);
        let hits = search(&commands, &aliases, "howlong", None, 1);
        assert_eq!(commands[hits[0].index].id, "ps.uptime");
    }
}
