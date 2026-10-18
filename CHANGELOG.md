# Changelog

All notable changes to CommandDeck. Format based on Keep a Changelog.

## [Unreleased]

### Added
- 2026-10-18 — Phase 1 desktop foundation: Tauri 2 + React 19 + TypeScript app scaffold; native window (1200×780 default, 900×600 minimum) with strict CSP and minimal capabilities; icons from the owner's logo; navigation `Home · CMD · PowerShell … Settings` with Ctrl+1/2/3/, shortcuts; design tokens with light/dark/system themes (WCAG AA verified by tests); CommandRow, SyntaxPreview (expand/collapse, verbatim copy, hyphen-safe wrapping), DetailPanel (modal, Esc, focus trap and return); loading/empty/error states; CMD and PowerShell library pages with category filters and session placeholders; Settings (theme, shortcuts, about). All data is clearly labeled sample data. 69 frontend tests; NSIS and MSI installers build.
- 2026-10-18 — Phase 0 complete. Development toolchain installed and verified (VS 2022 Build Tools + C++ tools + Windows SDK, Rust 1.99.1 MSVC).
- 2026-10-18 — Owner logo (`assets/brand/commanddeck-logo.png`). Recorded owner decisions: elevation by whole-app restart (D8), terminal / command-bar / Advanced Mode policy (D14), toolchain install policy (D15), logo as icon source (D16). Phase 1 acceptance criteria extended (icons, badge placeholders); Phase 3/4 criteria added for the new decisions.
- 2026-10-18 — Phase 0: project instructions (`CLAUDE.md`), README, architecture, security model, roadmap with Phase 1 acceptance criteria, testing plan with verified environment inventory.
