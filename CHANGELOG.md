# Changelog

All notable changes to CommandDeck. Format based on Keep a Changelog.

## [0.5.0] — 2026-10-19 (Phases 4 and 5)

### Added — Phase 4: safety checks and administrator mode
- The header shows whether CommandDeck runs as a standard user or as administrator. **Restart as administrator** relaunches the whole app through Windows' permission prompt, after explaining what that means. Nothing runs automatically afterwards.
- Commands that need administrator rights offer *Restart as administrator*, *Copy command* or *Cancel* instead of failing. A terminal that shows "Access is denied" gets a small hint.
- The command bar asks once before a short list of well-known operations that can wreck Windows or your files (formatting, wiping disks, deleting a drive, the Windows folder or your user folder, deleting restore points, changing boot settings, turning off Defender or the firewall, and more). It looks at what the command does and where, not at words. *Run anyway* sends exactly what you typed. Ordinary admin work never asks.
- One-click Run now works for commands that change things and for commands with values to fill in (values are checked, never altered), and for your own commands. Meaningful changes ask once (can be turned off). High-impact runs ask you to type the target.
- **Advanced Mode**: no confirmations for meaningful changes, and your own multi-step commands and scripts run with one click. High-impact operations still ask.
- Optional **app password** (Argon2id) for high-impact runs, restarting as administrator and turning on Advanced Mode. Wrong attempts slow down.

### Fixed
- A terminal could miss its exit when another process started at the same moment (handle inheritance race). All process creation is now serialized.
- Form errors no longer change a field's accessible name (screen readers read the label, then the error).

## Phase 5: settings & refinement (included in 0.5.0)

### Added
- Density setting (comfortable / compact).
- Terminal settings: font size (11–20 px) and screen reader support, both applied to open terminals without restarting them; option to not start sessions automatically (a Start session button appears instead).
- Choice of search shortcut: Ctrl+K, Ctrl+P or Ctrl+J (Ctrl+Shift+same letter inside a terminal). All hints and the shortcut list follow the choice.
- Run history in Settings: one-click runs with exit code, duration and time. Only metadata is kept, never output. Keep for 7, 30 or 90 days, forever, or off; clear at any time.

### Changed
- Reset preferences also resets the new settings. Run history is kept.

### Fixed
- Settings page no longer makes the whole window scroll (hidden form helpers escaped the scroll area).

## [0.3.0] — 2026-10-18 (Phase 3: terminal & running commands)

### Added
- Real CMD and Windows PowerShell sessions on their pages (Windows ConPTY + xterm.js). History, Tab completion, prompts, colors and Ctrl+C behave like a normal console. Restart, end, clear, collapse and maximize. Sessions survive switching pages.
- Command bar under each terminal: type or review a command and press Enter. It's sent exactly as typed.
- "Open in terminal" for every command. It fills the command bar of the right shell without running it.
- One-click Run for routine built-in commands, with live output, exit code, Stop and Run again. Commands that change the system, need values, or are custom open in the terminal instead (until Phase 4 adds confirmations).
- Every shell and run lives in its own Windows Job Object. Ending it, or closing CommandDeck, stops everything it started.
- PowerShell 7 is offered automatically if installed.
- Terminal color palettes for light and dark themes, with a minimum contrast so program output stays readable.

## [0.2.0] — 2026-10-18 (Phase 2: catalog & discovery)

### Added
- Built-in catalog of 69 commands (36 CMD, 33 PowerShell) with plain-language explanations, syntax breakdowns, side effects, cautions and Microsoft Learn sources. Each is verified against Windows by `scripts/verify-catalog.ps1`, and admin requirements were checked on a standard-user session.
- Offline search in Rust: names, aliases, keywords, task phrases ("fix internet"), synonyms, shell filter; relevance test suite.
- Ctrl+K search palette with recents and favorites, keyboard navigation, copy (Ctrl+Enter) and add-to-Home (Alt+Enter).
- SQLite persistence (backend-only): settings, Home order with personal labels, favorites, recent commands, personal aliases, custom commands. Recovers from a damaged database and refuses databases from newer versions.
- Home management: add, remove, reorder, rename; 10 or 15 quick actions.
- Custom commands: create, edit, delete, search; validation with per-field messages; Multi-step label; export/import by paste.
- Settings: quick-action limit, export/import, clear recents, reset preferences; theme now stored in the database.
- Documentation links open in the browser through the backend (catalog URLs only).

### Changed
- Phase 1 sample data removed; all data comes from the backend.
- First run seeds 8 quick actions so adding works immediately.

## [0.1.0] — 2026-10-18 (Phases 0–1)

### Added
- 2026-10-18 — Phase 1 desktop foundation: Tauri 2 + React 19 + TypeScript app scaffold; native window (1200×780 default, 900×600 minimum) with strict CSP and minimal capabilities; icons from the owner's logo; navigation `Home · CMD · PowerShell … Settings` with Ctrl+1/2/3/, shortcuts; design tokens with light/dark/system themes (WCAG AA verified by tests); CommandRow, SyntaxPreview (expand/collapse, verbatim copy, hyphen-safe wrapping), DetailPanel (modal, Esc, focus trap and return); loading/empty/error states; CMD and PowerShell library pages with category filters and session placeholders; Settings (theme, shortcuts, about). All data is clearly labeled sample data. 69 frontend tests; NSIS and MSI installers build.
- 2026-10-18 — Phase 0 complete. Development toolchain installed and verified (VS 2022 Build Tools + C++ tools + Windows SDK, Rust 1.99.1 MSVC).
- 2026-10-18 — Owner logo (`assets/brand/commanddeck-logo.png`). Recorded owner decisions: elevation by whole-app restart (D8), terminal / command-bar / Advanced Mode policy (D14), toolchain install policy (D15), logo as icon source (D16). Phase 1 acceptance criteria extended (icons, badge placeholders); Phase 3/4 criteria added for the new decisions.
- 2026-10-18 — Phase 0: project instructions (`CLAUDE.md`), README, architecture, security model, roadmap with Phase 1 acceptance criteria, testing plan with verified environment inventory.
