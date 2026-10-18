# CommandDeck Security Model

Status: **Accepted policy, not yet implemented** (owner decisions recorded 2026-10-18).

## 1. Principles

1. **Freedom first.** CommandDeck is a convenience layer over shells the user already has. It never tries to be a whitelist.
2. **Proportionate friction.** The least intrusive safeguard that reasonably addresses a real risk.
3. **Honest guarantees.** We say exactly what is checked and what is not.
4. **Backend authority.** The webview requests; Rust decides. UI checks are UX only.

## 2. Threat model

| In scope | Out of scope |
|---|---|
| The user making a high-impact mistake (wrong target, wrong shell, broad wildcard) | A determined local user — they can open `cmd.exe` directly |
| A malicious/malformed imported custom-command file | Malware already running as the user |
| Injection: user-supplied parameters altering a structured command | Kernel/OS vulnerabilities |
| A compromised or buggy frontend calling backend commands it shouldn't | Physical access / offline disk tampering |
| Secrets leaking into history or logs | |
| Someone at an unlocked PC using CommandDeck's protected actions (if app password set) | |

**Assets:** user files, system integrity (System32, boot config, disks), security protections (Defender, firewall, UAC), the user's command history.

**What CommandDeck cannot do:** prevent an authorized Windows user from running any command outside the app; make arbitrary scripts safe; replace UAC or Windows ACLs.

## 3. Friction levels

| Level | Examples | Behavior |
|---|---|---|
| **L1 Routine** | `ipconfig /all`, `dir`, `Get-Process`, `ping`, `netstat -ano`, `systeminfo` | Run immediately. No dialog. |
| **L2 Meaningful change** | `ipconfig /flushdns`, stop a service, delete a file in a user folder, set env var, `sfc /scannow` | Run, with one concise confirmation **only when the change isn't obvious from the button** (configurable). Shows target + consequence. |
| **L3 High-impact** | `format`, `diskpart clean`, recursive delete of a drive root / Windows / profile root, `bcdedit` writes, `vssadmin delete shadows`, disabling Defender real-time protection / firewall, `takeown`/`icacls` on System32, `reg delete` of HKLM\SYSTEM keys | Explicit confirmation naming the exact target (type-to-confirm for irreversible ones) + app password if the protected-action policy requires it. Refuse if the target can't be determined. |

Admin-required ≠ dangerous. `requiresAdmin` and `risk` are independent fields.

## 4. Risk determination (catalog & custom entries)

- Each built-in entry has a curated baseline risk.
- The backend `RiskAnalyzer` re-evaluates with the actual arguments: e.g. "Delete folder" is L2 for `%TEMP%\foo`, L3 for `C:\`, `C:\Windows`, `%USERPROFILE%`.
- Path targets are canonicalized before evaluation: environment variables expanded, `..` resolved, 8.3 short names and `\\?\` prefixes normalized, symlinks/junctions resolved where possible, case-insensitive compare. A literal "System32" string search is **not** the mechanism.
- Custom entries: analyzer classifies the command (exe identity, known destructive verbs, chaining/redirection presence, script invocation). The user may raise risk but **never lower it below the analyzer result**. A label like "safe" grants nothing.
- Custom entries that chain commands, redirect, or invoke scripts are flagged "multi-step / script" in the UI.

## 5. Authorization flow (L2/L3 catalog runs)

1. Frontend calls `exec_prepare(definition_id, params)`.
2. Backend validates params, resolves the exact invocation, computes risk, returns `{risk, target_summary, requirements}` and, if no confirmation is needed, runs.
3. If confirmation/password needed: frontend shows the dialog → `exec_authorize(prepare_id, confirmation, password?)` → backend verifies and issues a single-use grant bound to `hash(shell, program, args, cwd, elevation)`, valid ≤ 60 s.
4. `exec_run(prepare_id, grant)` — backend re-derives the invocation and checks the hash. Any difference → rejected, re-authorize.

A frontend that skips steps, replays a grant, or edits arguments after authorization is rejected by the backend. These bypass cases are explicit Phase 4 tests.

## 6. Terminal sessions, command bar and Advanced Mode — decided 2026-10-18

### 6.1 Direct terminal input (terminal pane)

- The CMD/PowerShell pages host the **real shell** over ConPTY. Keystrokes go straight to it.
- With arrow-key history, tab completion, PSReadLine, aliases, scripts and here-strings, CommandDeck **cannot reliably know** what a raw keystroke stream will execute. So terminal-pane input is **not screened, filtered, rewritten or blocked**. This is the same as opening cmd.exe or PowerShell yourself, and the UI says so once, plainly, in the session info (not as a recurring warning).
- Goal: behave as close to a normal Windows terminal as practical. When the terminal has focus, keys go to the shell. CommandDeck reserves only a minimal, configurable set of app shortcuts and documents them.
- Windows permissions (ACLs, UAC) apply as usual. Errors such as "Access is denied" come from Windows and are shown as-is.

### 6.2 Command bar (structural detection)

On Enter, the backend analyzes the line **before** writing it, unchanged, into the PTY:

1. **Parse with shell-aware rules.**
   - CMD: tokenize respecting quotes and `^` escapes; split on `&`, `&&`, `||`, `|`; note redirections.
   - PowerShell: parse with PowerShell's own language parser (`System.Management.Automation.Language.Parser.ParseInput`, AST only, nothing executed) in a long-lived helper or the session's host. The cmdlet name, parameters and arguments come from the AST.
2. **Identify the operation, not words in the text.** Resolve aliases (`rm`, `del`, `ri`, `rd`, `rmdir` → delete operations), match the executable or cmdlet plus the parameters that matter (e.g. `-Recurse`, `/s`, `/q`, `clean`, `/delete`).
3. **Resolve targets.** Expand environment variables that are already known, canonicalize paths (§4), and classify the target: drive root, Windows directory, System32, boot configuration, a whole physical disk, the user-profile root, or the security configuration.
4. **Decide.** Confirm only when a **known catastrophic operation** is applied to a **resolved critical target**. Examples: formatting a volume, `diskpart` clean, recursive delete of a drive root / Windows / System32 / profile root, deleting shadow copies, `bcdedit` writes, turning off Defender real-time protection or the firewall, taking ownership of or resetting ACLs on System32.
5. **Fail open.** If parsing fails, the target can't be resolved, or nothing matches, the line is sent with no prompt. An unparseable line is not a warning.

Rules:

- Exactly **one** concise confirmation per line: what was detected, the target, the consequence. Buttons: **Run anyway** / **Edit** / **Cancel**. No retype-to-confirm in the command bar unless the owner enables it.
- The line is never modified, and nothing is blocked solely by a filter. "Run anyway" always sends the original text.
- `requiresAdmin` alone never triggers a confirmation. Ordinary admin maintenance (e.g. `sfc /scannow`, `DISM /RestoreHealth`, `ipconfig /flushdns`, restarting a service) runs with no prompt.
- The same unchanged line is not re-confirmed again within the session after the user confirmed it once; any edit triggers a fresh check.
- Detection is deliberately incomplete: variables computed at runtime, scripts, encoded commands, `Invoke-Expression`, etc. are not followed. The docs and the session info say this.

### 6.3 Advanced Mode

A clearly visible mode (badge in the title bar). Turning it on requires the app password only if the owner configured that in the protected-action policy.

| | Standard mode | Advanced Mode |
|---|---|---|
| Terminal pane | Unscreened real shell | Same |
| Command bar | §6.2 detection; L2 confirmations per user preference | §6.2 detection for reliably identified catastrophic operations only; **no L2 confirmations** |
| Catalog / custom runs | Structured entries with validated params; L2 confirmations per preference | Also **free-form custom commands and custom scripts** (multi-line, chaining, redirection) as one-off runs; no L2 confirmations |
| L3 catastrophic operations (reliably identified) | Confirmation (+ password if policy) | Confirmation (+ password if policy). Kept on purpose, proportionate |
| Restart as administrator | Available (UAC) | Available (UAC) |

In both modes, the built-in catalog is a convenience, never a whitelist.

Free-form custom scripts can't be fully analyzed. They are labeled "script / multi-step". Detection applies to what can be parsed, and anything it can't follow is run without prompting rather than blocked.

## 7. Administrator privileges

- Detected with `GetTokenInformation(TokenElevation)` (and `TokenElevationType` for split-token info). Shown in the title bar: `Standard user` / `Administrator`.
- Elevation is always explicit and user-initiated through UAC (`ShellExecuteEx` verb `runas`). Never bypassed, never silent.
- App does not elevate itself by default. The only path to admin rights is **Restart as administrator**, which elevates the **entire application** for as long as it runs. The confirmation dialog says exactly that (ARCHITECTURE.md §7).
- When a command needs admin and the app is unelevated, the user is told why and chooses: restart elevated, copy the command, or cancel. Nothing auto-runs after a restart.
- Being admin never by itself triggers a password prompt or a warning.

## 8. Application password

- Optional. Hash: Argon2id (memory-hard; parameters per OWASP guidance, stored with salt in SQLite). Never stored or logged in plaintext; compared in constant time.
- Protects (configurable): L3 actions, starting elevated sessions/relaunching elevated, enabling Advanced Mode, changing security settings, disabling the password.
- Rate-limited attempts with backoff.
- **Limitation (stated in UI and docs):** it is a guard against mistakes and casual use of an unlocked session. Anyone with access to the Windows account can delete the database or use other terminals. It is not a substitute for Windows account security or UAC.
- Recovery: forgetting it → "Reset security settings" requires deleting app data (documented); this intentionally doesn't unlock anything Windows wouldn't already allow.

## 9. Webview hardening

- Tauri capabilities grant only CommandDeck's own commands; no shell, fs, http, or sql plugins.
- Strict CSP: no remote scripts, no `eval`, `connect-src` limited to IPC.
- No remote content loaded. No telemetry.

## 10. History & logging

- Stored: timestamp, shell, entry id or command text (catalog/command-bar only), exit code, duration, elevation.
- Not stored by default: terminal output; raw terminal keystrokes.
- Redaction before storage: values of params marked `secret`, and patterns such as `-Password`, `-Credential`, `ConvertTo-SecureString`, `/p:`, `password=`, bearer tokens, connection strings.
- Retention setting (off / 7 / 30 / 90 days / forever), one-click clear.

## 11. Known limitations

- Command-bar analysis is structural but incomplete: runtime variables, encoded commands, `Invoke-Expression`, scripts and anything typed in the terminal pane are not covered. It exists to catch mistakes, not adversaries.
- While the app is elevated, everything run through it (including the terminal) has admin rights. Close and reopen the app to return to standard user.
- Protected-path canonicalization cannot follow every indirection (e.g. a script that computes paths at runtime).
- An app password protects only actions taken *through CommandDeck*.
