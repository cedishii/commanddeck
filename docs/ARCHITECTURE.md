# CommandDeck Architecture

Status: **Accepted design, not yet implemented** (owner decisions recorded 2026-10-18).

## 1. Overview

```
┌──────────────────────────── Tauri window (WebView2) ────────────────────────────┐
│ Presentation (React/TS)                                                          │
│  Home · CMD · PowerShell · Settings · Search palette · TerminalView (xterm.js)   │
│                    │ typed calls only (src/ipc/*)        ▲ events (output, exit) │
└────────────────────┼─────────────────────────────────────┼───────────────────────┘
                     ▼ Tauri IPC (invoke / Channel)        │
┌──────────────────────────────── Rust backend ────────────┴───────────────────────┐
│ commands/   thin #[tauri::command] handlers: deserialize → validate → delegate    │
│ ── Application layer ──────────────────────────────────────────────────────────── │
│ catalog/    load + validate built-in JSON, merge custom entries, search index     │
│ exec/       structured one-off runs (argv), streaming stdout/stderr, cancel       │
│ pty/        session manager: create / write / resize / kill ConPTY sessions       │
│ ── Security layer ─────────────────────────────────────────────────────────────── │
│ security/   risk analyzer, protected-action policy, authorization grants, argon2  │
│ ── Native integration ─────────────────────────────────────────────────────────── │
│ platform/   token elevation check, shell discovery, path canonicalization, UAC    │
│ ── Persistence ────────────────────────────────────────────────────────────────── │
│ store/      SQLite (rusqlite): settings, quick actions, favorites, custom         │
│             commands, aliases, execution metadata, auth hash                      │
└──────────────────────────────────────────────────────────────────────────────────┘
                     ▼ CreateProcessW / CreatePseudoConsole
              cmd.exe · powershell.exe (5.1) · pwsh.exe (7, if installed)
```

## 2. The two execution paths and how they coexist

CommandDeck deliberately has **two distinct ways** to run things. The UI always makes clear which one is in use.

| | **Catalog run** (Quick Actions, search results, custom entries) | **Terminal session** (CMD / PowerShell pages) |
|---|---|---|
| What it is | One-off process with structured definition | Persistent real shell over ConPTY |
| Input | `program` + `args[]` built from a definition and validated parameters | Raw keystrokes from xterm.js |
| Shell parsing | Avoided where possible (direct exe); PowerShell gets a fixed script, user values via env vars | Full shell semantics: pipes, `&&`, redirection, variables, scripts |
| Risk analysis | Precise: backend knows the operation, targets and arguments | Best-effort only (see SECURITY.md §6) |
| Output | Captured into a result panel (stdout/stderr separated, exit code) | Rendered live in the terminal |
| State | Stateless (cwd chosen per run) | Keeps cwd, env vars, history, loaded modules |

Inside the terminal pages there are two input surfaces over the **same** session:

- **Command bar** (single line above the terminal). On Enter the backend parses the line, runs structural high-impact detection (SECURITY.md §6), and then writes the line plus Enter into the PTY exactly as typed. The text is never modified.
- **Terminal pane** (xterm.js). Keystrokes go straight to ConPTY with no inspection, like any Windows terminal. Required for interactive programs, history recall, tab completion, Ctrl+C.

Bridging actions:

- **"Open in terminal"** on any catalog entry types the command text into the active session's input line **without pressing Enter**, so the user sees and owns it. The terminal page's shell must match the entry's shell; we never translate syntax between shells.
- **"Save as custom command"** from the terminal command bar creates a custom catalog entry (user then reviews its metadata).

## 3. Components

### 3.1 Frontend (`src/`)

- `ipc/` — the **only** place that imports `@tauri-apps/api/core`. Exposes typed functions (`catalog.search()`, `exec.run()`, `pty.open()`…) returning discriminated-union results. Makes the frontend mockable in tests and in browser-only dev mode.
- `components/CommandRow` — `[#] [Description] [Risk/Admin badge] [Syntax preview ⌄] [Action]`.
- `components/SyntaxPreview` — single-line truncated preview with chevron; expanded shows full text with `white-space: pre-wrap`, copy button. Preview text is derived for display only; execute/copy always use the definition's canonical value.
- `components/DetailPanel` — explanation, syntax breakdown, examples, side effects, admin/risk, expected output.
- `components/TerminalView` — xterm.js + fit addon; streams bytes from a Tauri `Channel`.
- `features/search` — Ctrl+K palette; queries the backend index (single source of truth).

### 3.2 Backend (`src-tauri/src/`)

- `catalog/` — `CommandDefinition` (serde), validation (ids unique, shell valid, params well-formed, risk present), search index (see §5).
- `exec/` — spawns `std::process::Command`/`tokio::process` with explicit absolute paths; `CREATE_NO_WINDOW`; streams lines; cancel = terminate **that child's process tree** via a Job Object (never by name).
- `pty/` — `PtyBackend` trait (`spawn(shell, cwd, size)`, `write`, `resize`, `kill`, `wait`). Sessions keyed by UUID; each in a Job Object with `KILL_ON_JOB_CLOSE` so closing CommandDeck cleans up children.
- `security/` — `RiskAnalyzer` (per-definition rules + argument/target evaluation), `Policy` (user settings: which L2/L3 need confirm/password), `GrantStore` (short-lived single-use authorization tokens bound to a hash of the exact invocation).
- `platform/` — `is_elevated()` via `GetTokenInformation(TokenElevation)`; shell discovery (`%SystemRoot%\System32\cmd.exe`, `…\WindowsPowerShell\v1.0\powershell.exe`, `pwsh.exe` from known install paths/registry); path canonicalization for protected-path checks.
- `store/` — migrations, repositories. DB at `%APPDATA%\CommandDeck\commanddeck.db` (exact path via Tauri `app_data_dir`).

## 4. Catalog definition (draft schema)

```jsonc
{
  "id": "net.ipconfig.all",              // stable, unique
  "shell": "cmd",                         // "cmd" | "powershell" (5.1+) | "pwsh"
  "name": "View network configuration",
  "summary": "Shows every network adapter with IP, DNS, gateway and MAC.",
  "category": "networking",
  "keywords": ["ip address", "dns server", "mac address", "network settings"],
  "aliases": ["ipconfig"],
  "invocation": {                          // what actually runs
    "kind": "exe",                         // "exe" | "cmd-builtin" | "ps-script"
    "program": "%SystemRoot%\\System32\\ipconfig.exe",
    "args": ["/all"]
  },
  "display": "ipconfig /all",              // canonical text for copy & "open in terminal"
  "params": [],                            // typed params: string|path|host|int|enum, with validation rules
  "requiresAdmin": false,
  "risk": "L1",                            // baseline; analyzer may raise per-argument
  "modifies": false,
  "sideEffects": [],
  "expectedOutput": "Per-adapter blocks …",
  "notes": "…",
  "minWindows": "10",
  "sources": ["https://learn.microsoft.com/windows-server/administration/windows-commands/ipconfig"]
}
```

Invocation kinds:

- `exe` — direct `CreateProcess` with argv. Preferred.
- `ps-script` — `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand <fixed script>`; parameter values are passed as environment variables (`CMDDECK_P_<name>`) and read by the script, so user input is **never parsed as PowerShell code**.
- `cmd-builtin` — for built-ins like `dir`, `type`, `del` that have no exe: `cmd.exe /d /s /c <line>`. cmd.exe quoting cannot be made fully safe for arbitrary input (cf. CVE-2024-24576 "BatBadBut"), so params here are restricted to a validated character set and rejected otherwise; where an exe or PowerShell equivalent exists, prefer it.

Every entry lists `sources` used to verify its syntax. No entry ships without verification.

## 5. Search

Local, in-memory index in Rust, built at startup from built-in + custom entries. Scoring (tuned with tests):

1. Exact name/alias/`display` match
2. Prefix match on alias/command token
3. Keyword & task-phrase match (curated `keywords` + `tasks` like "fix internet")
4. Token overlap on summary, weighted by field, with a small stop-word list so generic words ("show", "file") don't flood results
5. Category boost when a query names a category

Results carry `shell`, so the UI groups/labels CMD vs PowerShell. A relevance test suite (`query → expected top-N ids`) guards regressions. Fuzzy (typo-tolerant) matching added only if the tests show a need.

## 6. Terminal integration

- ConPTY (`CreatePseudoConsole`, Windows 10 1809+). Both target OS versions support it.
- Output: PTY reader thread → bytes → Tauri `Channel<Vec<u8>>` → xterm.js `write()`. Backpressure via bounded buffer.
- Input: xterm `onData` → `pty_write(session_id, bytes)`.
- Resize: fit addon → `pty_resize(cols, rows)`.
- Lifecycle: open / close / restart session; status (running, exited(code), failed-to-start). Ctrl+C is passed through to the shell (normal console behavior); "Kill session" terminates the Job Object.
- `portable-pty` 0.9.0 is the starting implementation (wezterm's, widely used, but no release since Feb 2025). Phase 3 begins with a spike; if it shows defects (resize, UTF-8, exit status, Win10 behavior), switch the `PtyBackend` impl to direct `windows` crate calls (~300 lines).

## 7. Elevation — decided: Option A (2026-10-18)

Hard constraint: a Medium-integrity process cannot create an elevated child attached to its own ConPTY. Options considered:

- **A. Relaunch elevated** — **chosen.**
- B. Per-command elevated console window — not implemented.
- C. Elevated broker process over an authenticated named pipe — **future backlog**; `platform/elevation.rs` keeps a narrow interface so C can be added without touching callers.

### Behavior

- CommandDeck starts as a standard user. The title bar always shows the current context: `Standard user` or `Administrator` (from `GetTokenInformation(TokenElevation)`).
- **Restart as administrator** (Settings, title-bar menu, and the admin-needed dialog):
  1. A confirmation states plainly: *the entire application will run with administrator rights until you close it*, and that open terminal sessions will end.
  2. If the protected-action policy requires the app password for elevation, it is asked for here.
  3. `ShellExecuteExW` with verb `runas` on CommandDeck's own executable, plus an argument telling the new instance which page to open (no other state passed on the command line).
  4. If UAC is declined or fails, the current instance keeps running and shows "Restart cancelled. Still running as standard user."
  5. If UAC succeeds, the old instance exits after the new one signals it started. Settings, Home, custom commands and history live in SQLite, so they carry over.
- Returning to standard user means closing the app and reopening it normally. Windows provides no reliable de-elevation from an elevated process, and we don't fake one.
- **Command needs admin, app is unelevated.** The backend's prepare step returns `requiresElevation`. The UI shows one dialog explaining why admin is needed, with these choices:
  - **Restart as administrator** (the flow above). The command is *not* auto-run after restart; it's preselected so the user runs it deliberately.
  - **Copy command** to run in their own admin terminal.
  - **Cancel.**

  In a terminal session, an admin-only command simply fails with Windows' own "Access is denied" message. CommandDeck doesn't intercept it, but shows a small non-blocking hint linking to "Restart as administrator".
- Single-instance: the elevated and unelevated instances hand off as above; two instances don't write to the DB at the same time (SQLite WAL + single-instance guard).

## 8. Decisions log

| ID | Decision | Why | Alternatives considered |
|----|----------|-----|-------------------------|
| D1 | Tauri 2 + React + TS | Native, small binary, Rust for OS/security code; React ecosystem for xterm.js | Electron (heavier, Node in main process), WinUI 3/C# (strong native fit, but weaker terminal-component story and you'd lose the web UI skillset) |
| D3 | xterm.js + ConPTY | xterm.js is the de facto terminal renderer (VS Code); ConPTY is the official Windows API | winpty (legacy), pipe-based fake terminal (breaks interactive programs) |
| D4 | rusqlite, backend-only | Keeps persistence behind the security boundary; `tauri-plugin-sql` would let the webview run arbitrary SQL | JSON files (no transactions), plugin-sql |
| D5 | JSON catalog in repo, embedded | Reviewable diffs, schema-validatable, no DB seeding drift | Seeding SQLite |
| D8 | Elevation by whole-app restart (Option A) | Simplest model that keeps real elevated terminals working; no extra privileged process to secure | Per-command elevated window (output not captured), elevated broker (deferred) |
| D9 | Argon2id | Current OWASP-recommended password hash | bcrypt, Windows Hello (possible later add-on) |
| D14 | Structural command-bar detection, unscreened terminal pane | Matches normal terminal behavior; avoids keyword false positives that break legitimate commands | Keystroke interception (unreliable), keyword blocklists (false positives and negatives) |
| D16 | Icons generated from `assets/brand/commanddeck-logo.png` with `tauri icon` | One source of truth for window, taskbar and installer icons | Hand-made .ico files |

| D17 | No router library; page state in `App` | Four fixed pages; a router adds a dependency without benefit | react-router |
| D18 | Native Windows title bar (no custom chrome) | Real desktop behavior (snap, system menu) for free; badges live in the app header instead | Custom draggable title bar |
| D19 | Theme preference in `localStorage` *temporarily* | Settings store (SQLite, backend) doesn't exist until Phase 2; reads/writes wrapped so failures fall back to System | Waiting until Phase 2 for theming |

### Dependencies (Phase 1)

| Package | Why |
|---|---|
| react, react-dom 19 | UI |
| @tauri-apps/api 2 | IPC (used from Phase 2, only inside `src/ipc/`) |
| lucide-react | Consistent icon set, tree-shaken |
| tailwindcss 4 + @tailwindcss/vite | Utility styling over CSS-variable tokens |
| vite 8 + @vitejs/plugin-react | Dev server / bundler (Tauri default) |
| typescript ~6.0.3 | Pinned for typescript-eslint compatibility |
| vitest, jsdom, @testing-library/{react,dom,user-event,jest-dom} | Component tests |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals | Linting (type-aware strict) |
| @tauri-apps/cli | Build, dev and icon tooling |
| Rust: tauri 2, serde, serde_json | Window host. `tauri-plugin-log` from the template was removed as unneeded for now |

Dependencies are added to these tables as they're introduced, with reason.
