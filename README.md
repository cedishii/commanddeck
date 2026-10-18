# CommandDeck

A Windows desktop controller for CMD and PowerShell.

> **Status:** 0.2.0 (Phase 2). The command library, search, Home quick actions, favorites and custom commands work and are saved locally. **Running commands and live terminal sessions come in Phase 3.** Until then, copy a command and paste it into your own terminal.

CommandDeck makes the Windows command line easier to use without replacing it:

- **Quick Actions** — your top 10 or 15 commands on the Home page, one click away.
- **Command Discovery** — search a curated, offline library by name or by what you want to do ("flush dns", "see running applications").
- **Direct Control** — a real, persistent CMD or PowerShell session inside the app.

Safety is proportionate: routine commands just run, meaningful changes get a short confirmation, and only high-impact operations (formatting disks, wiping system folders, disabling security protections) need explicit authorization. See [docs/SECURITY.md](docs/SECURITY.md) for exactly what is and isn't guaranteed.

## Prerequisites (development)

- Windows 10 (1809+) or Windows 11, x64
- Node.js 20+ and npm
- Rust stable, MSVC toolchain (`rustup`)
- Visual Studio 2022 Build Tools: "Desktop development with C++" + Windows 10/11 SDK
- Microsoft Edge WebView2 Runtime (preinstalled on Windows 11)
- Optional: PowerShell 7 (`pwsh`) — used when present; Windows PowerShell 5.1 is always supported

## Development

```powershell
npm install            # once
npm run tauri dev      # run the desktop app with hot reload
npm test               # frontend tests
npm run typecheck; npm run lint
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build    # release build + NSIS and MSI installers in src-tauri/target/release/bundle/
```

Keyboard: `Ctrl+K` search, `Ctrl+1` Home, `Ctrl+2` CMD, `Ctrl+3` PowerShell, `Ctrl+,` Settings, `Esc` closes panels and dialogs. In search: `Enter` details, `Ctrl+Enter` copy, `Alt+Enter` add to Home.

After changing `catalog/*.json`, run `powershell -NoProfile -File scripts/verify-catalog.ps1`. It checks every entry against this Windows installation and the cited documentation.

Your data is stored in `%APPDATA%\com.cedrickkaneko.commanddeck\commanddeck.db`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)
- [Testing](docs/TESTING.md)
- [Changelog](CHANGELOG.md)

## Author

Cedrick Kaneko
