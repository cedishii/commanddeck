# Changelog

All notable changes to CommandDeck. Format based on Keep a Changelog.

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
