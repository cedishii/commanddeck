# CommandDeck Roadmap

Legend: ☐ not started · ◐ in progress · ☑ done **and verified**

## Phase 0 — Discovery & planning ☑ (2026-10-18)

- ☑ Inspect environment and confirm the project is new (2026-10-18)
- ☑ Verify toolchains (see TESTING.md §Environment)
- ☑ Propose architecture, execution model, safety model
- ☑ Write CLAUDE.md, README, ARCHITECTURE, SECURITY, ROADMAP, TESTING, CHANGELOG
- ☑ Owner answered Q1–Q3; decisions D8 (elevation = whole-app restart), D14 (terminal/Advanced Mode policy), D15 (toolchain policy) recorded in CLAUDE.md, ARCHITECTURE.md, SECURITY.md (2026-10-18)
- ☑ Owner logo added at `assets/brand/commanddeck-logo.png` (D16)
- ☑ Toolchain re-inspected 2026-10-18: Rust, VS Build Tools, C++ workload, Windows SDK all absent; install plan presented
- ☑ Owner approved the toolchain install (2026-10-18)
- ☑ VS 2022 Build Tools 17.14.42 + C++ tools + Windows SDK 10.0.26100 and rustc/cargo 1.99.1 (MSVC) installed. Verified with `vswhere`, version checks, and a compiled-and-run Rust test program

**Exit:** owner confirmation recorded in CLAUDE.md §3 ✅; toolchain verified ✅. The first Tauri template build moves to the start of Phase 1 (criterion 1).

## Phase 1 — Desktop application foundation ☑ (2026-10-18)

Verification status, 2026-10-18 (details in TESTING.md):

| # | Status | Evidence |
|---|---|---|
| 1 | ☑ | `tauri dev` and the release exe both open a native window titled "CommandDeck" (Win32 process/window query, screenshots) |
| 2 | ☑ | App.test (order, aria-current), screenshots |
| 3 | ☑ | `WM_GETMINMAXINFO` reports min outer size 914×638 logical = 900×600 client. No horizontal overflow on any page at 900 px or 1440 px (DOM measurement, Chromium) |
| 4 | ☑ | Tests: Ctrl+1/2/3/, shortcuts, focus to page title, dialog Tab trap, Esc. All controls are native buttons (Enter/Space). Focus ring visible in screenshot. A manual Tab-order pass inside the native window is still recommended |
| 5–7 | ☑ | CommandRow / SyntaxPreview / DetailPanel tests incl. canonical-copy and focus-return tests, screenshots |
| 8 | ☑ | 34 contrast assertions (both themes) pass. System theme followed via `prefers-color-scheme` (tested with mock; live OS theme switch not yet observed) |
| 9–10 | ☑ | HomePage/ShellPage state tests; "Sample data" badge; `src/fixtures/sample.ts` |
| 11 | ☑ | typecheck, lint, 69 tests, fmt, clippy, cargo test pass; NSIS + MSI produced; NSIS installer run with owner approval (per-user, no UAC) and the installed app launches |
| 12 | ☑ | Icons generated from the logo; title-bar icon observed. Taskbar/installer icon not visually checked |
| 13 | ☑ | Header badge "Privilege: not checked yet" plus Advanced Mode slot (in the app header; native title bar kept, see D18) |
| 14 | ☑ | This table, TESTING.md, CHANGELOG |

Scope: scaffold Tauri 2 + React + TS; app shell; nav; four pages; design tokens; CommandRow, SyntaxPreview, DetailPanel; keyboard accessibility. Data comes from a clearly labeled `SAMPLE` fixture in the frontend — no execution yet.

**Acceptance criteria (all must be verified):**

1. `npm run tauri dev` opens a native window titled "CommandDeck" (not a browser tab).
2. Nav bar shows `Home  CMD  PowerShell` on the left and `Settings` on the right; the active page is visually and `aria-current` indicated.
3. Window min size enforced (proposed 900×600); layout has no horizontal scroll or overlap from 900 px to full-screen width.
4. Keyboard: Tab/Shift+Tab reaches every interactive element in logical order with a visible focus ring; Ctrl+1/2/3 switch pages, Ctrl+, opens Settings; Enter/Space activate rows and chevrons.
5. CommandRow renders `[#] [Description] [Risk/Admin badge] [Syntax preview] [Action]`.
6. SyntaxPreview: long syntax truncates to one line with a chevron; expanding shows full text wrapped, quoting/indentation preserved, Copy button; collapsing restores; the row keeps its position. A unit test asserts that the copied value equals the canonical syntax, never the preview string.
7. DetailPanel opens from a row (click or Enter) and closes with Esc, returning focus to the row.
8. Light and dark themes via tokens; system theme followed by default. Text contrast ≥ 4.5:1 (checked).
9. Empty, loading and error states exist for the Home list and are reachable in tests.
10. Sample data is visibly marked as sample in the UI and in code (`src/fixtures/sample.ts`).
11. `npm run typecheck`, `npm run lint`, `npm test`, `cargo clippy -D warnings`, `cargo test` all pass; `npm run tauri build` produces an installer (`.msi`/NSIS) that launches.
12. App, taskbar and installer icons are generated from `assets/brand/commanddeck-logo.png` via `tauri icon`. The logo also appears in the nav bar at small size.
13. App header has a placeholder slot for the privilege badge (`Standard user` / `Administrator`) and the Advanced Mode badge, labeled as not yet wired (real detection is Phase 4).
14. Results recorded in TESTING.md; CHANGELOG updated.

## Phase 2 — Command catalog & discovery ☑ (2026-10-18)

Scope as planned: structured JSON catalog with verified starter entries, backend search with a relevance suite, Ctrl+K palette, favorites/aliases/recents, Home 10/15 with add/remove/reorder/rename, custom entries with validation and import, SQLite persistence. These criteria were written out at the start of the phase.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Catalog is structured data separate from the UI, embedded and validated at startup | ☑ | `catalog/*.json`, `load_builtin()`, Rust tests incl. malformed JSON |
| 2 | 40–60+ starter entries across both shells, each verified against Windows and cited docs | ☑ | 69 entries (36 CMD, 33 PS). `verify-catalog.ps1` all pass (programs, flags, cmdlets, parameters, 64 URLs); titles reviewed; admin needs probed |
| 3 | Search by name, alias, keyword, task phrase, category; CMD/PS distinguished; relevant results first | ☑ | Relevance suite (10 tests). Real-app e2e: "flush dns", "fix internet", "find large files", "see running applications" |
| 4 | Ctrl+K palette, keyboard-driven, works with shortcuts and terminal-safe design | ☑ | SearchPalette tests (7) + real-key e2e in the native window |
| 5 | Favorites, recents, personal aliases | ☑ | Rust + UI tests; e2e recents after real copy |
| 6 | Home: 10/15 limit, add/remove/reorder/rename without deleting catalog entries | ☑ | Rust store/app tests; HomePage tests (10); e2e limit error |
| 7 | Custom commands: create/edit/delete/search, validation, import/export, can't gain trust from labels | ☑ | Rust app tests (validation, shell lock, import all-or-nothing, oversized/malformed/unknown-field); editor tests; e2e create→search→delete |
| 8 | Local persistence that survives restart and recovers from damage | ☑ | Rust file-DB tests (reopen, corrupt → moved aside, newer schema refused); e2e restart kept theme/Home/recents |
| 9 | Syntax preserved verbatim end to end | ☑ | Rust test (newlines, quotes, `$env:`), UI copy tests, real Windows clipboard check |
| 10 | All checks pass; release build produces installers | ☑ | See TESTING.md 2026-10-18 Phase 2 rows |

Not in scope / deferred: typo-tolerant search, catalog entries with runnable parameters (Phase 3 invocation), installing 0.2.0 over the owner's 0.1.0 (needs owner OK).

## Phase 3 — Native terminal integration ☑ (2026-10-18)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Evaluate the PTY approach | ☑ | Direct ConPTY chosen over portable-pty (D23): suspended start + Job Object, maintenance |
| 2 | Real cmd.exe and Windows PowerShell sessions in the app; persistent state | ☑ | Real-app e2e: banner + prompt; `set`/`cd`/variables persist; PS 5, Unicode `π ✓ é` |
| 3 | Keystrokes reach the shell unmodified: history, Tab completion, prompts, Ctrl+C | ☑ | e2e with trusted CDP input: `dir Doc`+Tab → `Documents`, ↑ recall, Esc clears, Ctrl+C stops `ping -t`; Rust test for `set /p` input |
| 4 | Only documented app shortcuts intercepted while a terminal has focus | ☑ | Tests: Ctrl+K / Ctrl+1 go to the shell; Ctrl+Shift+E / Ctrl+Shift+K handled |
| 5 | Command bar writes exactly the typed text | ☑ | `commandBarInput` tests; UI test of exact bytes; real-app e2e |
| 6 | Output, exit status, long-running commands, cancellation, restart/close | ☑ | Rust tests (exit codes 3/7/0, kill); UI tests; e2e Run `ipconfig /all` exit 0, Stop |
| 7 | Session cleanup kills the whole tree; nothing orphaned on app exit | ☑ | Rust job test (0 active after kill); OS-level e2e: End session and app close, 0 survivors |
| 8 | Failed launches handled | ☑ | Rust test (missing exe → error); UI test ("Couldn't start: …") |
| 9 | "Open in terminal" bridge; one-off structured runner clearly distinct from sessions | ☑ | UI tests + e2e: command bar filled, focused, not executed; Run drawer with live output |
| 10 | Checks and release build pass | ☑ | See TESTING.md Phase 3 rows |

Deferred: PowerShell 7 session test (not installed here), terminal tabs, screen-reader mode, Phase 4 command-bar checks. Original scope notes follow.

PTY spike (portable-pty vs direct ConPTY) → session manager with Job Objects; xterm.js view; cmd, powershell 5.1, pwsh 7 (if found); resize, UTF-8, exit status, restart/close, Ctrl+C passthrough; "Open in terminal" bridge; structured one-off runner with streamed output and cancel.

Key criteria from D14: terminal-pane keystrokes reach the shell unmodified (verified with history recall, tab completion, PSReadLine, `Read-Host`, `set /p`, Ctrl+C). The command bar writes exactly the typed text into the PTY (byte-for-byte test). Only the documented app shortcuts are intercepted while the terminal has focus.

## Phase 4 — Security & authorization ☐

Privilege detection; risk analyzer with path canonicalization; prepare/authorize/run grant flow; protected-action policy; optional Argon2id password with rate limiting; command-bar structural detection; Advanced Mode; elevation workflow; bypass tests.

Key criteria from D8/D14:
- **Restart as administrator:** the dialog states the whole app becomes elevated and sessions end. Declining UAC leaves the current instance running with a clear message. Accepting hands off to the elevated instance with settings intact. The title bar shows the true token state. A command is never auto-run after restart.
- **Admin-needed dialog:** offers restart / copy / cancel. Being admin alone never prompts.
- **Command bar:** a false-positive suite of legitimate admin and maintenance commands (`sfc /scannow`, `DISM … /RestoreHealth`, `ipconfig /flushdns`, `Restart-Service`, `del` in a temp dir, `Remove-Item -Recurse` on a project folder) produces **no** prompt. A true-positive suite (format, diskpart clean, recursive delete of root/Windows/System32/profile via aliases, env vars, `..` and short names) produces **one** prompt. Unparseable lines are sent without prompt. Sent bytes equal typed bytes.
- **Advanced Mode:** no L2 confirmations; free-form custom scripts run; L3 identified operations still confirm; badge visible; password gate only if configured.

## Phase 5 — Settings & refinement ☐

Appearance/density; shortcut customization (no conflicts with terminal input); execution preferences; history retention & redaction; reset preferences; accessibility pass; recovery from malformed settings.

## Phase 6 — Integration & regression ☐

Full test matrix incl. standard vs. admin contexts, Windows 10 VM check, failure scenarios, production build verification.

## Phase 7 — Release preparation ☐

Docs completion, security review, installer verification, known-issues list, release instructions. **No publishing without explicit approval.**

## Backlog / ideas (not committed)

- Elevated helper/broker process (ARCHITECTURE §7 option C) — owner flagged as a possible future improvement
- Windows Hello as an alternative to the app password
- Multiple terminal tabs per shell
- Catalog export/import sharing format
