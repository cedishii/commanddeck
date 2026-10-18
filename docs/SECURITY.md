# CommandDeck Security Model

Status: **Accepted policy.** Implemented: data layer (§10a), execution (§10b), authorization and elevation (§10c).

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

## 10a. Implemented in Phase 2 (verified)

- **Backend owns all data.** The webview has no SQL, fs, shell or http access; capabilities are `core:default` only.
- **Strict input shapes.** Every IPC input is a typed struct with `deny_unknown_fields`, so a smuggled field (e.g. `{ theme, elevate: true }`) is rejected by the backend. Verified end-to-end in the real app.
- **Validation in Rust, not the form.** Lengths, control characters, per-shell categories, placeholder consistency (`<Name>` declared ↔ used), alias syntax and alias uniqueness per shell, L2/L3 ⇒ modifies, 10/15 limit, the Home limit, and changing a custom command's shell (refused, because it would reinterpret the syntax in another language).
- **Custom commands are untrusted.** Their `risk` is the user's declaration and is shown as such. They carry `source: "custom"` so future execution (Phase 3/4) analyzes them itself and never relies on the label. Chaining, pipes, multiple lines and script calls are labeled **Multi-step** (heuristic, informational).
- **Import** is all-or-nothing, capped at 1 MB and 500 commands, rejects unknown fields, and validates every entry before writing.
- **External links.** The webview can only ask to open source *n* of built-in command *id*. The URL comes from the embedded catalog (all `https://learn.microsoft.com/`), so the UI can't open arbitrary URLs or programs through this path.
- **Resilience.** A damaged database is moved aside (kept, not deleted) and the user is told. A database from a newer version is refused untouched. Malformed settings fall back to defaults, and unreadable custom rows are skipped.
- **Test isolation.** `COMMANDDECK_DATA_DIR` exists only in debug builds (`cfg!(debug_assertions)`), so a release install can't be redirected by an environment variable.
- **History** stores only command ids for copies (no output, no free text), capped at 20, with a "Clear recent commands" control.

## 10b. Implemented in Phase 3 (verified)

- **What the webview can start**: a known shell (`cmd`, `powershell`, `pwsh`, an enum) or a catalog command **by id**. It can't name a program or pass command text to execute. Text typed or sent from the command bar goes into an already-running shell, which is exactly what typing does.
- **One-click Run policy** *(Phase 3; superseded by §10c)* (backend, `app::run_block_reason`): only built-in, L1 (routine), placeholder-free commands. L2/L3, custom, placeholder and multi-line CMD commands are refused by the backend with an explanation; the UI offers "Open in terminal" instead. Admin-only read-only commands may run, and Windows refuses them for a standard user.
- **Open in terminal never executes.** It only fills the command bar; the user presses Enter.
- **Terminal input is not screened, filtered or rewritten** (§6.1). The command bar sends the text with CR line endings, exactly as typing. Structural checks are Phase 4.
- **Process containment**: every process is created suspended and assigned to its own Job Object (KILL_ON_JOB_CLOSE) before its first instruction. Verified: End session killed the shell and its running `ping`; closing the app killed 2 shells, their console hosts and a running child (0 survivors).
- **No elevation**: processes inherit CommandDeck's token. With a standard-user app, shells are standard-user.
- **Std handle isolation**: children get no inherited handles (`bInheritHandles = FALSE`, invalid std handles); they only see the pseudoconsole.
- **Resource limits**: 16 concurrent processes, 1 MB per input write, bounded terminal sizes.
- Output isn't stored anywhere. Only command ids of Runs go into recent history.

## 10c. Implemented in Phase 4

- **Token state** read from Windows (`TokenElevation`) and shown as `Standard user` / `Administrator`. Admin is shown, never warned about.
- **Restart as administrator** relaunches the whole app through UAC (`runas`) after a plain-language confirmation (the whole app gets admin rights; sessions end). Declining UAC leaves the instance running with a message. Only a page name is passed on the command line, and nothing runs after the restart.
- **Admin-needed commands never run unelevated.** One-click Run offers *Restart as administrator* / *Copy command* / *Cancel* instead (backend-enforced in `take_run`). In a terminal, Windows' own "Access is denied" stays visible, and a small hint links to the restart.
- **Command bar** (§6.2): structural detection in Rust (CMD tokenizer, PowerShell AST), one confirmation (*Run anyway* / *Edit* / *Cancel*), the original text sent unchanged, confirmed lines not re-asked in that session, any failure → sent without prompt. Terminal-pane keystrokes are not checked.
- **One-click runs** (§5): `exec_prepare(id, values)` → `exec_authorize(prepareId, typed?, password?)` → `exec_run(prepareId, grant)`. Grants are single use, valid 60 s, and bound to (shell, resolved text, working folder, elevation). `exec_run` re-derives all of it, so skipped steps, replays, forged or swapped ids, and commands edited after confirmation are refused. Tested in Rust (`app::tests`, `security::grants::tests`) and through the real IPC bridge.
- **Risk** = catalog or declared risk, raised to L3 when the analyzer finds a catastrophic operation on a resolved critical target (never lowered). One-click runs are analyzed in their real working folder (the home folder), so `rd /s /q ..` is L3.
- **Values** for placeholders are checked per shell and per position (inside quotes or bare) and refused, never escaped: no quotes, `%`, `!`, `^`, backtick, `$`, smart quotes, control characters, leading `-` or `/`; bare values also exclude spaces and separators.
- **Confirmations**: L3 always (type the first value, or `RUN`); L2 when *Ask before meaningful changes* is on (default) and Advanced Mode is off.
- **Advanced Mode**: no L2 confirmations; multi-step custom commands run with one click; L3 still confirms (+ password per policy). Badge in the header. Turning it on may need the password; turning it off never does.
- **App password** (§8): Argon2id (19 MiB, t=2, p=1, 16-byte salt), constant-time compare, 3 free attempts then 2 s doubling to 5 min. Policy (all on by default): high-impact runs, restart as administrator, enabling Advanced Mode. Changing the password, the policy or removing it always needs the current password. *Reset preferences* keeps security state.
- **Process creation is serialized** (`pty::SPAWN_LOCK`) so no child can inherit another session's pipe handles.

## 11. Known limitations

- Command-bar analysis is structural but incomplete: runtime variables, encoded commands, `Invoke-Expression`, scripts and anything typed in the terminal pane are not covered. It exists to catch mistakes, not adversaries.
- While the app is elevated, everything run through it (including the terminal) has admin rights. Close and reopen the app to return to standard user.
- Protected-path canonicalization cannot follow every indirection (e.g. a script that computes paths at runtime).
- An app password protects only actions taken *through CommandDeck*.
- The password attempt limiter is in memory: restarting the app resets it. That fits a mistake guard; it isn't brute-force protection for the database (which anyone using the Windows account can read).
- The command-bar check runs in the frontend's send path: the terminal pane and the raw `pty_write` channel deliver input unchecked by design (§6.1), so the check guards against mistakes, not against a compromised UI.
- Interactive programs: a line typed into a running `diskpart` (e.g. `clean`) can't be told apart from a command, so it isn't detected. Scripted diskpart (`echo … | diskpart`, `diskpart /s file`) is.
- PowerShell analysis needs `powershell.exe`; if it's missing or slow, PowerShell lines are sent without a check.
