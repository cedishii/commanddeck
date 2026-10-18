# CommandDeck — Project Instructions

Canonical, persistent instructions for every coding session on this repository.
Read this file first, every session. Keep it current when project-wide decisions change.

## 1. What CommandDeck is

A Windows desktop **controller** for CMD and PowerShell — the remote, not the TV.
The shells stay the real execution environment; CommandDeck makes them faster to use.

Three equal ways to interact:

1. **Quick Actions** — Home page of the user's top 10 or 15 commands, one click to run.
2. **Command Discovery** — curated local catalog searchable by name, alias, keyword, or plain-language task ("fix internet", "flush dns").
3. **Direct Control** — a genuine, persistent CMD / PowerShell session (ConPTY) where the user types anything.

Philosophy: *"Your commands. Your computer. One convenient control center."*
Freedom first, proportionate safeguards, explanations over restrictions. Never a whitelist, never a nag.

## 2. Ownership

- Cedrick Kaneko is the **sole author and owner**. Use that name in all author/owner metadata (package.json, Cargo.toml, tauri.conf.json, LICENSE if added).
- Never add AI/Claude as author, co-author or contributor anywhere — no `Co-Authored-By` trailers, no "generated with" lines, no credits in files or the app UI.
- Never push, publish, release, deploy, or create a remote repository without explicit approval in that session.
- Never commit secrets, credentials, local paths with personal data, or the user's local database.
- Inspect before overwriting any existing file.

## 3. Confirmed decisions

See `docs/ARCHITECTURE.md` §Decisions for rationale. Status legend: ✅ confirmed, ⏳ proposed / awaiting owner.

D1–D7, D9 and D13 were proposed in Phase 0 and accepted on 2026-10-18 when the owner answered Q1–Q3 and asked to proceed toward Phase 1 without objection.

| # | Decision | Status |
|---|----------|--------|
| D1 | Tauri 2 desktop app, React 19 + TypeScript (strict) + Vite frontend | ✅ 2026-10-18 |
| D2 | Rust backend owns all process creation, PTY, privilege detection, auth, persistence | ✅ 2026-10-18 |
| D3 | Terminal: xterm.js in the UI, Windows ConPTY in Rust (implemented directly, see D23) | ✅ 2026-10-18 |
| D4 | SQLite via `rusqlite` (bundled), accessed **only** from Rust. No `tauri-plugin-sql`, `-shell`, or `-fs` exposed to the webview | ✅ 2026-10-18 |
| D5 | Built-in catalog = versioned JSON files in `catalog/`, embedded at compile time, schema-validated at load and in tests | ✅ 2026-10-18 |
| D6 | Structured catalog execution uses argv arrays + absolute executable paths; never string-built shell expressions | ✅ 2026-10-18 |
| D7 | Shells: `cmd.exe`, Windows PowerShell 5.1 (baseline, always present), PowerShell 7 (`pwsh.exe`) when detected | ✅ 2026-10-18 |
| D8 | **Elevation = Option A.** App runs as standard user by default. "Restart as administrator" relaunches the **whole app** through UAC, and the UI says so plainly. When a command needs admin and the app is unelevated, explain the options and let the user choose (restart elevated / copy the command for their own admin terminal / cancel). No per-command elevated windows, no elevated helper process for now (helper = future backlog) | ✅ 2026-10-18 |
| D9 | Optional app password hashed with Argon2id; documented as a mistake-guard, not a security boundary | ✅ 2026-10-18 |
| D10 | No network, accounts, telemetry or cloud. Strict CSP. Built-in search is fully offline | ✅ (directive) |
| D11 | Navigation: `Home  CMD  PowerShell ············ Settings` | ✅ (directive) |
| D12 | Three friction levels (L1 routine / L2 meaningful change / L3 high-impact) | ✅ (directive) |
| D13 | Project location `C:\Users\cedri\dev\commanddeck`, local git only | ✅ 2026-10-18 |
| D14 | **Terminal & Advanced Mode policy** (full text: `docs/SECURITY.md` §6): direct terminal input behaves like a normal Windows terminal and is not screened; the command bar does structural (not keyword-only) detection of well-known high-impact operations and shows **one** concise confirmation only when genuinely warranted; nothing is ever rewritten or blocked by a filter; admin ≠ dangerous. Advanced Mode = broad freedom (free-form commands, custom scripts, no medium-risk confirmations) while keeping proportionate safeguards for catastrophic operations the app can **reliably** identify. Never promise perfect detection | ✅ 2026-10-18 |
| D15 | **Toolchain policy:** inspect before installing; never reinstall what exists; show what's missing, the proposed install, disk space and whether admin is needed; ask before system-wide installs or any UAC prompt; prefer user-level Rust (rustup) | ✅ 2026-10-18 |
| D16 | Brand logo provided by owner: `assets/brand/commanddeck-logo.png` (1254×1254, no alpha channel). Source for app/installer icons via `tauri icon` | ✅ 2026-10-18 |
| D20 | Catalog verification = automated checks against the real Windows install (program/cmdlet/parameter/flag existence) + doc URLs resolving + admin probes of harmless read-only commands | ✅ 2026-10-18 (Phase 2) |
| D21 | Personal labels on Home are display-only; personal aliases only affect search | ✅ 2026-10-18 (Phase 2) |
| D22 | First run seeds 8 quick actions (of 10) so adding works immediately | ✅ 2026-10-18 (Phase 2) |
| D23 | **ConPTY directly via the `windows` crate**, not `portable-pty`: processes are created SUSPENDED, put in a KILL_ON_JOB_CLOSE Job Object, then resumed, so no child can escape cleanup. Also avoids a dependency unreleased since Feb 2025. All `unsafe` is confined to `src-tauri/src/pty/conpty.rs` (and, since Phase 4, `platform.rs` for elevation) | ✅ 2026-10-18 (Phase 3) |
| D24 | One-off Runs also use ConPTY (terminal-correct output, colors, Ctrl+C). Consequence: stdout and stderr arrive merged, like in any console | ✅ 2026-10-18 (Phase 3) |
| D25 | ~~Until Phase 4: one-click Run only for built-in, L1, placeholder-free commands~~ Superseded by D30 on 2026-10-19 | ✅ 2026-10-18 (Phase 3) |
| D26 | "Open in terminal" fills the command bar and focuses it; it never sends anything to the shell by itself | ✅ 2026-10-18 (Phase 3) |
| D27 | Terminal keyboard: every key goes to the shell except Ctrl+Shift+K (search), Ctrl+Shift+E (to command bar), Ctrl+Shift+1/2/3 (pages), Ctrl+C with a selection / Ctrl+Shift+C (copy), Ctrl+V / Ctrl+Shift+V (paste). Global shortcuts and dialog key handling ignore events from `[data-terminal]` | ✅ 2026-10-18 (Phase 3) |
| D28 | All pages stay mounted (hidden when inactive) so sessions survive navigation. A shell session starts the first time its page is shown | ✅ 2026-10-18 (Phase 3) |
| D29 | Command-bar check is advisory and runs in the send path: Rust analyzes (CMD tokenizer; PowerShell AST from a long-lived `powershell.exe -NoProfile` helper that never executes), the UI shows one dialog, then sends the original text. Fails open. A confirmed line isn't re-asked in that session | ✅ 2026-10-19 (Phase 4) |
| D30 | One-click runs: `exec_prepare` → `exec_authorize` → `exec_run` (replaces `run_start` and D25). Grants single use, 60 s, bound to (shell, resolved text, working folder, elevation). Risk = max(catalog/declared, L3 if the analyzer finds a catastrophic op). L3 always confirms with a typed phrase (first value, else `RUN`); L2 confirms per the `confirmMeaningful` setting unless Advanced Mode | ✅ 2026-10-19 (Phase 4) |
| D31 | Placeholder values are validated per shell and position (quoted/bare) and **refused, never escaped**: no quotes, `%`, `!`, `^`, backtick, `$`, smart quotes, control chars, leading `-`/`/`; bare values no spaces/separators. One-click runs are analyzed in their real working folder (home), so relative targets count | ✅ 2026-10-19 (Phase 4) |
| D32 | Admin-required commands never run unelevated via one-click Run; the UI offers restart / copy / cancel | ✅ 2026-10-19 (Phase 4) |
| D33 | App password: Argon2id raw API (19 MiB, t=2, p=1), stored under `security.*` settings keys (kept by Reset preferences). Policy toggles (default on): high-impact runs, restart as admin, enabling Advanced Mode; changing password/policy always needs it. In-memory limiter (3 free, then 2 s doubling to 5 min). Advanced Mode persisted; disabling never needs the password | ✅ 2026-10-19 (Phase 4) |
| D34 | All process creation goes through `pty::SPAWN_LOCK` (`pty::spawn_std` for std spawns) to stop pipe-handle inheritance races with ConPTY | ✅ 2026-10-19 (Phase 4) |

## 4. Open questions (do not decide unilaterally)

- **Logo transparency** — the supplied PNG has the dark background baked in (no alpha). Fine for the window icon; a transparent-corner version would look cleaner on the taskbar. Ask the owner before altering their artwork.

## 5. Tech stack & repository layout

Existing (✓) and planned (later phase):

```
commanddeck/
  CLAUDE.md  README.md  CHANGELOG.md
  assets/brand/        ✓ owner-supplied logo (source for generated icons — do not edit without asking)
  docs/                ✓ ARCHITECTURE.md SECURITY.md ROADMAP.md TESTING.md
  catalog/             ✓ built-in commands: cmd.json, powershell.json (embedded into the Rust binary)
    schema/            ✓ catalog.schema.json (editor aid; Rust validation is authoritative)
  scripts/             ✓ verify-catalog.ps1: checks every entry against Windows + Microsoft docs
  src/                 React frontend (presentation only)
    app/               ✓ App shell, context (details/search/editor/toasts/revision), theme, pages
    pages/             ✓ Home, ShellPage (CMD/PowerShell), Settings
    components/        ✓ CommandRow, SyntaxPreview, DetailPanel, SearchPalette, CustomCommandEditor, ui/*
    hooks/             ✓ useAsync, useDialog, useCommandActions, useCopy, useGlobalShortcuts
    ipc/               ✓ the ONLY module that calls Tauri `invoke`: types.ts, client.ts, api.ts
    domain/            ✓ labels/categories for presentation
    styles/            ✓ tokens.css (design tokens), global.css
    test/              ✓ setup, render helpers, fakeBackend (mockIPC)
  src-tauri/src/       Rust backend
    lib.rs             ✓ startup, state, command registration
    commands.rs        ✓ thin #[tauri::command] handlers (Backend state wraps startup errors)
    app.rs             ✓ application layer: every rule (limits, validation, aliases, import)
    error.rs           ✓ AppError → { kind, message, fields? }
    catalog/           ✓ mod.rs (types, load, validation, multi-step), search.rs (ranking)
    store/             ✓ SQLite: migrations, settings, Home, favorites, recents, aliases, custom
    pty/               ✓ mod.rs (shells, command lines, PtyManager, events), conpty.rs (ConPTY + Job Objects; unsafe, with platform.rs)
    platform.rs        ✓ token elevation, launch args, UAC relaunch (second module with `unsafe`)
    security/          ✓ cmdline.rs, psparse.rs (PowerShell AST helper), paths.rs, rules.rs, grants.rs, password.rs
    app/exec.rs        ✓ values → analyze → prepare / authorize / take_run; security settings
  src/terminal/        ✓ XtermView (xterm.js), useTerminalSession, TerminalPanel (+ command bar), RunPanel
  src-tauri/capabilities/  ✓ core:default only
```

Frontend: React 19, TypeScript strict, Vite, Tailwind CSS v4 over CSS-variable tokens, lucide-react icons, @xterm/xterm 6 + addon-fit.
Backend now: Rust stable (MSVC), tauri 2, tauri-plugin-opener (Rust-side only), serde/serde_json, rusqlite (bundled SQLite), thiserror, windows 0.62 (ConPTY/Job Objects/elevation), base64, argon2 0.6 (raw API), getrandom 0.3.
Versions are pinned in lockfiles; verify before upgrading.

Data lives in `%APPDATA%\com.cedrickkaneko.commanddeck\commanddeck.db`. **Debug builds only:** set `COMMANDDECK_DATA_DIR` to use a throwaway folder for testing (release builds ignore it).

## 6. Security boundaries (summary — full detail in docs/SECURITY.md)

- The webview is **untrusted UI**. It can request; Rust decides. Every execution and authorization check happens in Rust.
- Frontend calls only typed commands in `src/ipc/`. No generic "run this string" command for catalog execution.
- Catalog/custom executions get a backend-computed risk level. Custom metadata can **raise** risk, never lower it below the analyzer's result.
- L3 actions require a single-use, backend-issued authorization bound to the exact (shell, program, args, cwd, elevation) tuple. Any change → re-authorize.
- Direct terminal sessions are the real shell; CommandDeck does not claim to pre-screen raw keystrokes and does not filter, rewrite or block terminal input.
- Command-bar checks are structural (parse → identify operation → resolve target), confirm only reliably identified high-impact operations, and fail open (unparseable ≠ warning).
- Admin rights only come from the user's explicit "Restart as administrator" through UAC. Admin alone never triggers a warning or password.
- Never log secrets. Terminal output is not persisted by default.
- Never test destructive behavior against the real system — use temp dirs, mocks, fixtures.
- Backend inputs use `deny_unknown_fields`: extra fields from the webview are rejected, not ignored.
- Custom commands' declared risk is informational; future execution must analyze them itself (`source: "custom"`).
- Documentation links open only via `catalog_open_source(id, index)`. The webview never passes a URL to open.
- Testing must not touch the owner's real data: use `COMMANDDECK_DATA_DIR` + `WEBVIEW2_USER_DATA_FOLDER` pointed at scratch folders.
- The webview can start only known shells (`ShellKind` enum) and run only catalog commands **by id**. It never supplies a program path or command text to execute. Command-bar and keystroke input goes into an existing session, the same as typing.
- Every process runs in its own Job Object, created suspended and assigned before it starts. "End session", "Stop" and app exit kill the whole tree, and only that tree.
- Rust tests that spawn real processes use `tempfile` working directories and harmless commands only (echo, set, ping 127.0.0.1).

## 7. Coding conventions

Frontend specifics established in Phase 1:
- Colors only through tokens in `src/styles/tokens.css` (consumed via Tailwind theme names like `bg-surface`, `text-muted`). `src/styles/tokens.test.ts` enforces WCAG AA contrast, so add new text/background pairs there.
- Global CSS goes inside `@layer base` so utilities can override it.
- Command syntax text is rendered verbatim. Truncation is CSS-only, and copy/execute use `entry.syntax`. Never derive executable text from display text.
- Data comes only from `src/ipc/api.ts`. Loaders are `useCallback(() => api.x(), [revision])` + `useAsync`. After a mutation call `invalidate()` (bumps `revision`), and every view refetches. `useAsync` keeps showing old data while refetching.
- Dialogs use `useDialog` (initial focus, Tab trap, Esc, focus return). Overflow menus use `ui/Menu`. Never hand-roll focus handling.
- Errors from the backend are `BackendError` (`kind`, `message`, `fields`); forms show `fieldMessage(name)` next to inputs.
- Tests: install `installFakeBackend()` (Tauri `mockIPC`) and use `renderApp()` / `renderWithContext()`. The fake mirrors the contract; real rules are tested in Rust. Scope queries (`within(...)`) because overlays render over pages.
- Absolutely positioned helpers (e.g. `sr-only` live regions) need a `relative` ancestor; otherwise they stretch the document and shift the app shell.

Catalog rules (built-in entries):
- Every entry needs `programs` (how to verify it) and `sources` (Microsoft Learn). Run `scripts/verify-catalog.ps1` after any catalog change; it must pass.
- Admin requirements are verified on a standard-user session where the command is read-only and harmless. Otherwise they come from documentation. Never guess.
- Keep `tasks` as natural phrases people type ("fix internet"); add relevance tests in `catalog/search.rs` for new important queries.

- TypeScript `strict: true`, no `any` without a comment explaining why. Prefer discriminated unions for IPC results.
- Rust: `thiserror` for error enums, no `unwrap()`/`expect()` in non-test code paths that handle user input or OS calls. `cargo clippy -- -D warnings` clean.
- Small focused modules; presentation components contain no execution or security logic.
- Catalog data lives in `catalog/`, never inside components.
- Every meaningful bug fix gets a regression test.
- Add a dependency only after checking it is maintained, necessary, and license-compatible; note it in ARCHITECTURE.md.
- Commit messages: imperative, concise; no AI attribution trailers.

## 8. Commands (only list commands that actually work)

All run from the repo root. In terminals opened before Rust was installed, prefix with `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path";`.

| Purpose | Command |
|---------|---------|
| Install deps | `npm install` |
| Dev app (native window, hot reload) | `npm run tauri dev` |
| Frontend only in a browser (no Tauri APIs) | `npm run dev` → http://localhost:1420 |
| Frontend tests | `npm test` (Vitest, jsdom) |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Rust format check | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Production build + installers | `npm run tauri build` → `src-tauri/target/release/bundle/{nsis,msi}/` |
| Verify catalog against Windows + docs | `powershell -NoProfile -File scripts/verify-catalog.ps1` (`-SkipNetwork` to skip URL checks) |
| Print search rankings (tuning aid) | `cargo test --manifest-path src-tauri/Cargo.toml print_rankings -- --ignored --nocapture` |
| Isolated dev run for e2e (debug only) | set `COMMANDDECK_DATA_DIR`, `WEBVIEW2_USER_DATA_FOLDER` to scratch dirs and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then `npm run tauri dev`; drive via Chrome DevTools Protocol (see TESTING.md) |
| Regenerate icons from the logo | `npx tauri icon assets/brand/commanddeck-logo.png`, then delete the generated `android/`, `ios/` and `icon.icns` (Windows-only app) |

## 8a. Pinned / notable versions

- **TypeScript pinned `~6.0.3`**, not 7.x: `typescript-eslint` 8.71 supports `<6.1.0` only. Revisit when typescript-eslint supports TS 7.
- React 19.3, Vite 8.3, Tailwind 4.3 (CSS-first config in `src/styles/global.css`), Vitest 5, ESLint 10 + typescript-eslint `strictTypeChecked`, lucide-react 1.x (icon `Home` is `House`).
- Rust 1.99 stable MSVC, tauri 2.12, edition 2024.

## 9. Phases (definitions & exit criteria in docs/ROADMAP.md)

0 Discovery & planning → 1 Desktop foundation → 2 Catalog & discovery → 3 Native terminal → 4 Security & authorization → 5 Settings & refinement → 6 Integration & regression → 7 Release prep.
A phase is complete only when its acceptance criteria are **verified** (tests run, app observed), not when code exists.

## 10. Current status

- **Phase 0 complete (2026-10-18).** Docs written, owner decisions recorded (D8, D14–D16), toolchain installed with owner approval and verified.
- **Phase 1 complete and verified 2026-10-18.**
- **Phase 2 complete and verified 2026-10-18** (ROADMAP.md table, TESTING.md): 69 verified built-in commands, Rust search, SQLite persistence, Home management, favorites, recents, personal aliases, custom commands with import/export, Ctrl+K palette. Version 0.2.0.
- v0.2.0 is installed per-user on the owner's PC (`%LOCALAPPDATA%\CommandDeck`), upgraded in place from 0.1.0 with owner approval on 2026-10-18. The owner's real data now lives in `%APPDATA%\com.cedrickkaneko.commanddeck\commanddeck.db`. Never test against it.
- Commit only with owner approval.
- **Phase 3 complete and verified 2026-10-18** (ROADMAP.md table, TESTING.md): real cmd.exe / Windows PowerShell sessions over ConPTY with xterm.js, command bar, Open in terminal, one-click Run for L1 built-ins, process-tree cleanup. Version 0.3.0 (built; install needs owner OK).
- **Phase 4 complete and verified 2026-10-19** (ROADMAP.md table, TESTING.md): privilege detection, Restart as administrator, admin-needed dialog, structural command-bar checks, prepare/authorize/run grants with value validation, Advanced Mode, optional Argon2id password. Accepting a real UAC prompt is not yet verified (needs the owner). Version 0.5.0 (Phases 4 + 5).
- **Phase 5 complete and verified 2026-10-19** (ROADMAP.md table, TESTING.md): density, terminal font size / screen reader / auto-start, search shortcut choice, run history with retention, reset, malformed-settings recovery. Backend was pushed as WIP `bffb541`; frontend finished 2026-10-19.
- Repo is public at github.com/cedishii/commanddeck (MIT). Pushing still needs explicit owner approval each session.
- **Next: Phase 6** (integration & regression: test matrix incl. a real elevated session, Windows 10 VM check, failure scenarios, production build). Ask the owner before starting it.
- Environment (verified 2026-10-18): Windows 11 build 26300 x64, Node 24.20.0, npm 11.19.0, git 2.55, WebView2 155, Windows PowerShell 5.1, **VS 2022 Build Tools 17.14.42** (`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`, VC x64 tools), **Windows SDK 10.0.26100.0**, **rustup 1.29.1 / rustc + cargo 1.99.1 stable-x86_64-pc-windows-msvc** (user-level, `%USERPROFILE%\.cargo\bin` on user PATH; clippy and rustfmt included). Not installed: PowerShell 7 (optional).
- Terminals opened before the Rust install won't have cargo on PATH. Open a new terminal or VS Code window.

## 11. Known issues / limitations

- Unverified: MSI install, manual Tab-order pass in the native window by a human, live OS theme switch while running, PowerShell 7 (`pwsh`) sessions (not installed on the dev PC; detection is tested).
- Terminals: stdout and stderr are merged (ConPTY). ConPTY's win32-input-mode isn't used (xterm.js speaks plain VT), so a few rare key combinations may differ from Windows Terminal. One session per shell page (no tabs yet). xterm's screen-reader mode is a setting (off by default).
- Command-bar detection is deliberately incomplete (SECURITY.md §11): runtime values, scripts, encoded commands and lines typed into interactive programs (e.g. `clean` inside diskpart) aren't followed.
- Unverified: accepting a real UAC prompt for Restart as administrator (the relaunch/handoff code is tested up to `ShellExecuteExW`).
- Programs choose ANSI colors blindly. The terminal enforces minimumContrastRatio 4.5 so text stays readable in both themes, which slightly alters some program colors.
- e2e test gotcha: xterm.js has its own hidden `<textarea>`. Select the command bar by its label, not `textarea`.
- Search has no typo tolerance (e.g. "ipconfg" finds nothing). Add only if relevance tests show a need.
- Multi-step detection for custom commands is heuristic and informational (labels, never blocks).
- Two CommandDeck instances with different WebView2 arguments can't share a profile folder (WebView2 0x8007139F). Isolate test instances with `WEBVIEW2_USER_DATA_FOLDER`.
- Programmatic `MoveWindow`/`SetWindowPos` bypasses min size (normal Windows behavior). Verify min size via `WM_GETMINMAXINFO`, not by moving the window.

- An unelevated process cannot host an elevated ConPTY child directly; therefore elevated terminals require restarting the whole app as administrator (D8). Restarting ends open terminal sessions.
- While elevated, Windows UIPI blocks drag-and-drop from a non-elevated Explorer into the app.
- Raw terminal input cannot be reliably risk-analyzed (history recall, tab completion, PSReadLine, scripts).

## 12. Session continuity protocol

**Start of session:** read this file → read relevant docs/ (ARCHITECTURE, SECURITY, ROADMAP, TESTING) → `git status` + `git log --oneline -15` → identify last verified milestone, failures, pending decisions → continue from the repo's actual state.

**End of meaningful session:** summarize what was implemented; list significant files; report tests/builds actually run with results; report failures honestly; update ROADMAP.md, CHANGELOG.md, TESTING.md results, and §10 here; state the next recommended task.

Never rely on chat history alone. Never mark work complete without verification. Never fabricate test results.
