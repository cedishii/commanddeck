# CommandDeck Testing

Rule: record only results that were actually executed. "Not run" is a valid, honest result.

## Tooling (planned)

| Layer | Tool | Notes |
|---|---|---|
| Frontend unit/component | Vitest + React Testing Library + jsdom | IPC mocked through `src/ipc/` |
| Frontend a11y | axe-core in component tests; manual keyboard pass | |
| Rust unit | `cargo test` | catalog validation, search relevance, risk analyzer, grant binding, redaction |
| Rust integration | `cargo test --test '*'` | spawns real `cmd.exe` / `powershell.exe` under ConPTY in a temp dir |
| End-to-end | WebdriverIO + `tauri-driver` (msedgedriver) | from Phase 3; verify Windows support at that time |
| Static | `tsc --noEmit`, ESLint, `cargo clippy -D warnings`, `cargo fmt --check` | |

## Safety rules for tests

- Destructive behavior is tested **only** against `tempfile` directories, mocks, and fixtures.
- L3 tests assert *classification and refusal/authorization*; they never execute the destructive operation against a real target.
- No test formats a disk, touches System32, edits HKLM, or toggles Defender/firewall on the host.
- Admin-context tests run only when explicitly invoked from an elevated shell (`#[ignore]` by default) and use harmless commands.

## Coverage plan by phase

- **P1:** navigation, resize/min-size, keyboard focus order, shortcuts, SyntaxPreview expand/collapse/copy-canonical, DetailPanel focus return, empty/error states, theme tokens.
- **P2:** schema validation (missing fields, bad shell, duplicate ids/aliases), syntax preservation round-trip, search relevance suite, persistence + recovery from corrupted DB/settings, custom-entry validation, import of malformed files.
- **P3:** each shell starts; echo round-trip; stdout vs stderr; exit codes; long-running + cancel; interactive prompt (`set /p`, `Read-Host`); cwd persistence across commands; resize; session close kills tree; missing executable error; process cleanup after app exit.
- **P4:** elevated vs standard detection; permission-denied surfacing; param injection attempts (`& calc`, `"; Remove-Item`, `$(…)`, `%PATH%`, newline, `^`); grant replay/tamper/expiry; frontend bypass (calling `exec_run` without grant); protected-path canonicalization (`C:\Windows\..\Windows\System32`, `%windir%`, short names, junctions in temp dir); password failure/rate-limit; redaction.
- **P5–6:** malformed settings recovery, restart persistence, shortcut conflicts, production build, Windows 10 VM pass.

## Environment (verified 2026-10-18)

| Item | Result |
|---|---|
| OS | Windows 11 Home, build 26300, x64 |
| Running as | Standard user (not elevated) |
| Node / npm | v24.20.0 / 11.19.0 |
| Bun | installed (not planned for use) |
| git / gh | 2.55.0 / installed |
| WebView2 Runtime | 155.0.4283.62 ✅ |
| Windows PowerShell | 5.1.26100 ✅ |
| PowerShell 7 (pwsh) | **not installed** |
| Rust (rustup/cargo/rustc) | rustup 1.29.1, rustc/cargo 1.99.1 stable-x86_64-pc-windows-msvc ✅ (installed 2026-10-18, user-level) |
| MSVC Build Tools / Windows SDK | VS 2022 Build Tools 17.14.42 (VC x64 tools) + SDK 10.0.26100.0 ✅ (installed 2026-10-18) |
| Free disk on C: | ~732 GB |

Registry versions checked 2026-10-18: tauri 2.12.4, @tauri-apps/cli 2.12.3, @xterm/xterm 6.0.0, react 19.3.1, vite 8.3.4, typescript 7.0.2, tailwindcss 4.3.3, vitest 5.0.5, portable-pty 0.9.0 (last release 2025-02-11), rusqlite 0.40.2, argon2 0.6.0, windows 0.62.2.

## Results log

| Date | Phase | What ran | Result |
|---|---|---|---|
| 2026-10-18 | 0 | Environment/toolchain inspection (above) | Done. No application tests exist yet. |
| 2026-10-18 | 0 | Toolchain re-inspection: `.cargo`/`.rustup`/scoop/choco paths, VS install dirs, recursive `cl.exe` search, Windows SDK registry keys, Windows Kits dir, `winget list` | Rust, VS/Build Tools, MSVC, Windows SDK all absent. Nothing to reuse. |
| 2026-10-18 | 0 | winget Build Tools install (exit 0); `vswhere` VC-tools query; Windows Kits Lib listing; winget rustup install (exit 0); `rustc`/`cargo --version`; `cargo new` + `cargo run` of a hello-world (in session scratchpad) | All pass. MSVC link works ("Hello, world!", exit 0). |
| 2026-10-18 | 1 | `npm run typecheck` (tsc 6.0.3) | Pass |
| 2026-10-18 | 1 | `npm run lint` (ESLint 10, typescript-eslint strictTypeChecked, react-hooks) | Pass (after fixing 1 error: sync setState in effect in `useAsync`, plus 1 warning) |
| 2026-10-18 | 1 | `npm test`: 8 files, **69 tests** (navigation, shortcuts, focus, SyntaxPreview expand/collapse/copy/wrap, CommandRow, DetailPanel Esc/Tab trap/focus return, Home loading/empty/error/retry, ShellPage filtering, theme incl. corrupted storage, 34 WCAG contrast checks, fixture integrity) | **69/69 pass** |
| 2026-10-18 | 1 | `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test` | Pass (0 Rust tests exist yet; no backend logic in Phase 1) |
| 2026-10-18 | 1 | Browser layout check (Playwright Chromium at 900×600 and 1440×860, light and dark): DOM overflow scan on every page, screenshots | No horizontal overflow; found and fixed 4 bugs (below) |
| 2026-10-18 | 1 | `npm run tauri dev` → native window; Win32 `WM_GETMINMAXINFO` query | Window "CommandDeck" opens; min outer 1143×797 px at 125% = 914×638 logical ⇒ 900×600 client ✅ |
| 2026-10-18 | 1 | Simulated corner drag (SetCursorPos + mouse_event) | **Inconclusive**: hit test confirmed HTBOTTOMRIGHT but synthetic input didn't start a resize. Superseded by the WM_GETMINMAXINFO check |
| 2026-10-18 | 1 | `npm run tauri build` | Pass: `CommandDeck_0.1.0_x64-setup.exe` (1.94 MB), `CommandDeck_0.1.0_x64_en-US.msi` (2.93 MB), exe 8.5 MB |
| 2026-10-18 | 1 | Launch release exe directly (not installed) | Opens with production CSP, renders correctly, no console window, closes cleanly |
| 2026-10-18 | 1 | NSIS installer `/S` (owner approved) | Exit 0. Per-user install to `%LOCALAPPDATA%\CommandDeck`, no UAC; HKCU uninstall entry (CommandDeck 0.1.0, publisher Cedrick Kaneko); Start Menu shortcut; installed exe launches and responds. MSI not run |
| — | 1 | **Not yet run:** MSI install; copy-to-clipboard inside the native WebView2 (tested in jsdom and Chromium only); manual Tab-order pass in the native window; live Windows theme switch | Pending owner OK / manual check |

| 2026-10-18 | 2 | Admin-requirement probes as standard user (read-only/harmless commands) | No admin: ipconfig /flushdns, Clear-DnsClientCache (both flush the DNS cache, harmless), netsh advfirewall show, Get-Disk, Get-Volume, Get-MpComputerStatus, Get-WinEvent System, Get-LocalGroupMember, Get-NetFirewallProfile, Get-HotFix, Get-NetTCPConnection, whoami /all, net localgroup, sc query, netsh wlan show profiles. **Admin:** fsutil volume diskfree ("Access is denied"), netstat -b ("requires elevation"), manage-bde -status, chkdsk C:, sfc (even `/?`) |
| 2026-10-18 | 2 | `scripts/verify-catalog.ps1` | First run: 3 failures (2 doc URLs 404, sfc flag check impossible without admin). Fixed. **Final: 69 entries, 64 URLs, all pass.** Doc page titles reviewed manually, all match |
| 2026-10-18 | 2 | `cargo test`: catalog validation, search relevance, store, app layer | **51 pass**, 1 ignored (`print_rankings` dev aid) |
| 2026-10-18 | 2 | `cargo clippy --all-targets -D warnings`, `cargo fmt --check` | Pass (after fixing 5 style findings) |
| 2026-10-18 | 2 | `npm test`: 11 files (App, CommandRow, SyntaxPreview, DetailPanel, SearchPalette, CustomCommandEditor, HomePage, ShellPage, theme/Settings, ipc client, tokens) via `mockIPC` fake backend | **106/106 pass** |
| 2026-10-18 | 2 | `npm run typecheck`, `npm run lint` | Pass (after fixing a render-time counter mutation in SearchPalette and a redundant null check) |
| 2026-10-18 | 2 | **Real-app e2e**: `tauri dev` with isolated data + WebView2 profile, driven via Chrome DevTools Protocol; backend contract through the real IPC bridge | All pass: 69 commands; search tops correct; Home seeded; limit/notFound/validation errors with fields; **unknown field `elevate` rejected by backend**; custom create→alias search→export→delete; open_source refuses non-catalog ids |
| 2026-10-18 | 2 | Real-app UI e2e with trusted input (CDP mouse/keyboard): copy, Ctrl+K, typing, Enter, Esc, menus, editor, theme | All pass. **A real click on Copy put `ping google.com` on the Windows clipboard** (closes the Phase 1 open item). No document overflow (780 = viewport). 8 screenshots reviewed |
| 2026-10-18 | 2 | Restart persistence (tauri dev auto-restart after a Rust change, same data dir) | Theme dark, Home 10 items, recents kept across the new process |
| 2026-10-18 | 2 | `npm run tauri build` (0.2.0) | Pass: `CommandDeck_0.2.0_x64-setup.exe` (2.91 MB), `CommandDeck_0.2.0_x64_en-US.msi` (4.19 MB) |
| 2026-10-18 | 2 | Release exe under the **production CSP** (isolated WebView2 profile; the real data folder had no database, so the one created was deleted afterwards) | IPC works: 69 commands, search correct, fresh seed = 8 quick actions, 8 rows rendered. Data folder restored to its prior state |
| 2026-10-18 | 2 | Upgrade the owner's 0.1.0 → 0.2.0 via NSIS `/S` (owner approved; 0.1.0 closed normally first) | Exit 0. One uninstall entry (CommandDeck 0.2.0), exe version 0.2.0, app launches and responds, database created in the app data folder |
| — | 2 | **Not run:** MSI install; human Tab-order pass | Pending |

How the real-app e2e works (repeatable): set `COMMANDDECK_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER` to scratch folders and `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then run `npm run tauri dev`. Then connect to `http://127.0.0.1:9223/json` and evaluate scripts / send `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`. The driver used was a small Node script (Node 24 has built-in WebSocket). It lived in the session scratchpad, so moving it into `tests/e2e/` is a Phase 3 task.

| 2026-10-18 | 3 | Rust ConPTY tests with **real processes** (temp working dirs, harmless commands): cmd output + exit 3, PowerShell Unicode, session state, `set /p` input, resize, kill → job empty, failed launch, manager limits | 12 pass; stable across 5 parallel runs + 1 serial run |
| 2026-10-18 | 3 | `cargo test` total, clippy `-D warnings`, fmt | **64 pass** (1 ignored dev aid); clean |
| 2026-10-18 | 3 | `npm test`: 12 files incl. new Terminal.test (session lifecycle, verbatim keystrokes, command-bar bytes, exit/restart/end, navigation persistence, launch failure, terminal shortcut isolation, collapse/maximize, Open in terminal never sends, Run/Stop/refusal) | **122/122 pass** |
| 2026-10-18 | 3 | Real-app e2e (isolated data + WebView2 profile, trusted CDP keyboard/mouse) | cmd banner + prompt; typed `echo`; Tab completion `dir Doc` → `dir Documents`; ↑ history; Esc clears (also right after Tab and directly before ↑); Ctrl+C stops `ping -t`; command bar runs; PowerShell 5, Unicode `π ✓ é`, `cd`/variables persist; Run `ipconfig /all` exit 0; Open in terminal fills and focuses the command bar without running |
| 2026-10-18 | 3 | OS-level cleanup checks via Win32_Process | End session: cmd + running ping child both gone. App close with busy shells: 5 processes (2 shells, 2 conhosts, ping) → **0 survivors** |
| 2026-10-18 | 3 | Light-theme readability (screenshot) | Found PSReadLine text invisible (ANSI white on white); fixed with `minimumContrastRatio: 4.5`; re-verified readable |
| 2026-10-18 | 3 | `npm run tauri build` (0.3.0) | Pass: setup.exe 3.02 MB, MSI 4.32 MB |
| 2026-10-19 | 5 | `cargo test`, clippy `-D warnings`, fmt | **70 pass** (1 ignored dev aid); clean |
| 2026-10-19 | 5 | `npm run typecheck`, `npm run lint`, `npm test` incl. new SettingsPage.test (density, live font/screen reader, auto-start off, search key incl. in-terminal, history list/clear/retention) | Clean; **130/130 pass** |
| 2026-10-19 | 5 | Real-app e2e (isolated data + WebView2 profile, CDP) | One-click run → history row `exit 0`; density live and restored after reload; Ctrl+K freed / Ctrl+P searches; terminal 13 → 18 px live, same session; settings persisted. **Found:** document 1382 px in a 780 px window on Settings (sr-only radios/thead without a positioned ancestor). Fixed with `relative` on the page container and option labels; re-measured 780 = viewport. No jsdom test possible (layout) |
| 2026-10-18 | 3 | Release exe under the production CSP (`http://tauri.localhost`), isolated WebView2 profile, session-only so no DB writes | CMD prompt streamed over the IPC channel; typed `echo` round-tripped; owner's database not modified |
| — | 3 | **Not run:** PowerShell 7 session (not installed); MSI; human Tab-order pass | Pending |

### Bugs found during Phase 3 verification (all fixed)

1. Rust closures captured only the raw `HANDLE` field (not the `Send` wrapper) under Rust 2021 precise capture → compile error. Fixed by moving the whole wrapper into the thread.
2. Dialog focus trap and global shortcuts would have stolen Tab / Ctrl+K / Ctrl+1 from the shell. Both now ignore events from inside `[data-terminal]`. Covered by tests.
3. Light theme made some PSReadLine syntax colors invisible. Contrast floor added.
4. Duplicate `id="page-title"` once all pages stayed mounted; replaced with `focusPageTitle()` on the visible page.
5. A one-shot fake-backend failure was consumed by Settings (child effects run before the parent's). Added `failAlways` for startup-failure tests.

Investigated and not a bug: a line reading `dir Documentsecho hello…` was left over from an aborted script run, and history recalled it correctly.

### Bugs found during Phase 2 verification (all fixed)

1. Search: "ip" ranked execution-policy entries because phrase bonuses used substring matching ("scr**ip**t"). Now whole-word matching. Regression test `short_queries_match_whole_words_only_regression`.
2. A database from a newer app version would have been treated as corrupt and moved aside, looking like data loss after a downgrade. Now refused untouched with a clear message. Test `newer_schema_is_refused_instead_of_damaged`.
3. A startup failure would have crashed the app (Tauri setup error). Now the window opens with an explanation. Test *shows a clear error screen when the backend could not start*.
4. `useAsync` flashed a loading state on every refresh. Now it keeps showing the previous data while refetching.
5. First run filled Home to 10 of 10, which disabled "Add command" immediately. Now seeds 8. Rust tests updated.
6. Test isolation: a dev instance with debugging flags failed against the running installed app's WebView2 profile (0x8007139F). Resolved by isolating `WEBVIEW2_USER_DATA_FOLDER`; the owner's running app was not touched.

### Bugs found during Phase 1 verification (all fixed)

1. Page title received focus on startup: React StrictMode runs effects twice, consuming the "first render" flag. Fixed by comparing with the previous page. Test: *does not move focus on startup… (regression)*.
2. Global `:focus-visible` (unlayered CSS) overrode Tailwind utilities. Moved base styles into `@layer base`.
3. `sr-only` live regions without a positioned ancestor stretched the document to 1147 px, letting focus/scroll shift the whole app shell under the nav. Fixed with a `relative` wrapper and `html { overflow: hidden }`.
4. Expanded syntax broke lines after hyphens (`-Recurse -` / `File`), which misreads as different parameters. Short tokens are now unbreakable spans with byte-identical text. Test: *keeps short tokens like -File unbreakable (regression)*.

Bugs 2 and 3 are layout/cascade issues that jsdom can't observe (no CSS layout). They were verified by re-measuring in Chromium (document height 600 px = viewport, header at top after focus/scroll) and have no automated test yet. Candidates for the Phase 3 WebdriverIO e2e suite.
