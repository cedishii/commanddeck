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
| D3 | Terminal: xterm.js in the UI, Windows ConPTY in Rust behind a `PtyBackend` trait (start with `portable-pty`, fall back to direct `windows`-crate ConPTY) | ✅ 2026-10-18 |
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

## 4. Open questions (do not decide unilaterally)

- **Logo transparency** — the supplied PNG has the dark background baked in (no alpha). Fine for the window icon; a transparent-corner version would look cleaner on the taskbar. Ask the owner before altering their artwork.

## 5. Tech stack & repository layout (planned)

```
commanddeck/
  CLAUDE.md  README.md  CHANGELOG.md
  assets/brand/    owner-supplied logo (source for generated icons — do not edit without asking)
  docs/            ARCHITECTURE.md SECURITY.md ROADMAP.md TESTING.md
  catalog/         built-in command definitions (JSON) + schema
    schema/command.schema.json
    cmd/*.json  powershell/*.json
  src/             React frontend (presentation only)
    app/           shell, routing, providers, global shortcuts
    pages/         Home, Cmd, PowerShell, Settings
    components/    CommandRow, SyntaxPreview, DetailPanel, TerminalView, ui/*
    features/      search, quickActions, customCommands, settings (UI state + hooks)
    ipc/           the ONLY module that calls Tauri `invoke`; typed wrappers
    styles/        tokens.css (design tokens), global.css
  src-tauri/       Rust backend
    src/
      commands/    #[tauri::command] handlers — thin, validate & delegate
      catalog/     load, validate, search index
      exec/        structured one-off execution (argv), output streaming
      pty/         PtyBackend trait, ConPTY session manager
      security/    risk classification, policy, authorization tokens, auth (argon2)
      platform/    privilege detection, shell discovery, path resolution
      store/       SQLite migrations & repositories
    capabilities/  Tauri capability files (minimal permissions)
  tests/           cross-layer fixtures; e2e/ (later)
```

Frontend: React 19, TypeScript strict, Vite, Tailwind CSS v4 over CSS-variable tokens, lucide-react icons, @xterm/xterm + addon-fit.
Backend: Rust stable (MSVC), tauri 2, serde, tokio, rusqlite (bundled), argon2, windows crate, portable-pty.
Versions are pinned in lockfiles once scaffolded; verify before upgrading.

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

## 7. Coding conventions

Frontend specifics established in Phase 1:
- Colors only through tokens in `src/styles/tokens.css` (consumed via Tailwind theme names like `bg-surface`, `text-muted`). `src/styles/tokens.test.ts` enforces WCAG AA contrast, so add new text/background pairs there.
- Global CSS goes inside `@layer base` so utilities can override it.
- Command syntax text is rendered verbatim. Truncation is CSS-only, and copy/execute use `entry.syntax`. Never derive executable text from display text.
- Pages take data loaders as props (`src/data/`) so tests can inject loading/empty/error. Phase 2 swaps the sample loaders for `src/ipc/`.
- Sample data lives only in `src/fixtures/sample.ts`, ids prefixed `sample.`, and the UI labels it "Sample data".
- Absolutely positioned helpers (e.g. `sr-only` live regions) need a `relative` ancestor; otherwise they stretch the document and shift the app shell.

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
- **Phase 1 complete and verified 2026-10-18** (ROADMAP.md table, TESTING.md). All UI data is `SAMPLE` fixtures. No execution, search, persistence, terminal or privilege detection yet.
- v0.1.0 is installed per-user on the owner's PC (`%LOCALAPPDATA%\CommandDeck`; uninstall via Apps & Features).
- Local git only, no remote. First commit made at the end of Phase 1 with owner approval.
- **Next: Phase 2** (catalog JSON + schema in Rust, verified starter entries, search, favorites/Home 10/15, custom entries, SQLite). Start with a short plan and confirm with the owner.
- Environment (verified 2026-10-18): Windows 11 build 26300 x64, Node 24.20.0, npm 11.19.0, git 2.55, WebView2 155, Windows PowerShell 5.1, **VS 2022 Build Tools 17.14.42** (`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`, VC x64 tools), **Windows SDK 10.0.26100.0**, **rustup 1.29.1 / rustc + cargo 1.99.1 stable-x86_64-pc-windows-msvc** (user-level, `%USERPROFILE%\.cargo\bin` on user PATH; clippy and rustfmt included). Not installed: PowerShell 7 (optional).
- Terminals opened before the Rust install won't have cargo on PATH. Open a new terminal or VS Code window.

## 11. Known issues / limitations

- Phase 1 unverified items: MSI install, clipboard copy inside native WebView2, manual Tab-order pass in the native window, live OS theme switch.
- Rust has no tests yet (no backend logic until Phase 2).
- Programmatic `MoveWindow`/`SetWindowPos` bypasses min size (normal Windows behavior). Verify min size via `WM_GETMINMAXINFO`, not by moving the window.

- `portable-pty` latest release is 0.9.0 (Feb 2025); maintenance risk — mitigated by the `PtyBackend` trait.
- An unelevated process cannot host an elevated ConPTY child directly; therefore elevated terminals require restarting the whole app as administrator (D8). Restarting ends open terminal sessions.
- While elevated, Windows UIPI blocks drag-and-drop from a non-elevated Explorer into the app.
- Raw terminal input cannot be reliably risk-analyzed (history recall, tab completion, PSReadLine, scripts).

## 12. Session continuity protocol

**Start of session:** read this file → read relevant docs/ (ARCHITECTURE, SECURITY, ROADMAP, TESTING) → `git status` + `git log --oneline -15` → identify last verified milestone, failures, pending decisions → continue from the repo's actual state.

**End of meaningful session:** summarize what was implemented; list significant files; report tests/builds actually run with results; report failures honestly; update ROADMAP.md, CHANGELOG.md, TESTING.md results, and §10 here; state the next recommended task.

Never rely on chat history alone. Never mark work complete without verification. Never fabricate test results.
