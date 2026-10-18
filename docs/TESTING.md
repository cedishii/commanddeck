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

### Bugs found during Phase 1 verification (all fixed)

1. Page title received focus on startup: React StrictMode runs effects twice, consuming the "first render" flag. Fixed by comparing with the previous page. Test: *does not move focus on startup… (regression)*.
2. Global `:focus-visible` (unlayered CSS) overrode Tailwind utilities. Moved base styles into `@layer base`.
3. `sr-only` live regions without a positioned ancestor stretched the document to 1147 px, letting focus/scroll shift the whole app shell under the nav. Fixed with a `relative` wrapper and `html { overflow: hidden }`.
4. Expanded syntax broke lines after hyphens (`-Recurse -` / `File`), which misreads as different parameters. Short tokens are now unbreakable spans with byte-identical text. Test: *keeps short tokens like -File unbreakable (regression)*.

Bugs 2 and 3 are layout/cascade issues that jsdom can't observe (no CSS layout). They were verified by re-measuring in Chromium (document height 600 px = viewport, header at top after focus/scroll) and have no automated test yet. Candidates for the Phase 3 WebdriverIO e2e suite.
