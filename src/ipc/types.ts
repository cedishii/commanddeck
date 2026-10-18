/**
 * Types mirroring the Rust backend's serialized shapes (src-tauri/src/app.rs,
 * catalog/mod.rs, store/mod.rs). Keep them in sync when the backend changes.
 */

export type Shell = 'cmd' | 'powershell';

/** L1 routine, L2 meaningful change, L3 high-impact (docs/SECURITY.md §3). */
export type RiskLevel = 'L1' | 'L2' | 'L3';

export type CategoryId =
  | 'networking'
  | 'files'
  | 'system-info'
  | 'processes'
  | 'services'
  | 'troubleshooting'
  | 'disk'
  | 'administration'
  | 'security'
  | 'environment'
  | 'windows-config'
  | 'automation';

export type CommandSource = 'builtin' | 'custom';

export interface Placeholder {
  readonly name: string;
  readonly description: string;
}

export interface SyntaxPart {
  readonly part: string;
  readonly meaning: string;
}

export interface CommandDetails {
  readonly whenToUse?: string;
  readonly syntaxParts?: readonly SyntaxPart[];
  readonly expectedOutput?: string;
  readonly sideEffects?: readonly string[];
  readonly cautions?: readonly string[];
}

export interface Command {
  readonly id: string;
  readonly source: CommandSource;
  readonly shell: Shell;
  readonly name: string;
  readonly summary: string;
  readonly category: CategoryId;
  /** Canonical command text. Copy and (later) execution always use this exact value. */
  readonly syntax: string;
  readonly aliases: readonly string[];
  readonly keywords: readonly string[];
  readonly tasks: readonly string[];
  readonly requiresAdmin: boolean;
  /** Built-in: curated. Custom: the user's own declaration, never trusted for authorization. */
  readonly risk: RiskLevel;
  readonly modifies: boolean;
  readonly placeholders: readonly Placeholder[];
  readonly details: CommandDetails;
  readonly sources: readonly string[];
  readonly notes?: string;
}

export interface CommandView extends Command {
  readonly favorite: boolean;
  readonly onHome: boolean;
  readonly userAliases: readonly string[];
  /** Custom commands only: chains, pipes, spans lines or runs a script. */
  readonly multiStep: boolean;
  /** One-click Run allowed (backend policy). Otherwise use "Open in terminal". */
  readonly runnable: boolean;
  readonly runBlockedReason: string | null;
}

export type ShellKind = 'cmd' | 'powershell' | 'pwsh';

export interface ShellInfo {
  readonly id: ShellKind;
  readonly label: string;
  readonly path: string | null;
  readonly available: boolean;
}

export interface SessionInfo {
  readonly sessionId: number;
  readonly pid: number;
  readonly program: string;
}

/** Terminal event; output data is base64 of raw terminal bytes. */
export type PtyEvent = { readonly kind: 'output'; readonly data: string } | { readonly kind: 'exit'; readonly code: number };

export interface QuickAction {
  readonly command: CommandView;
  readonly label: string | null;
  readonly note: string | null;
}

export interface HomeView {
  readonly limit: number;
  readonly items: readonly QuickAction[];
}

export interface SearchResult {
  readonly command: CommandView;
  readonly score: number;
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type QuickActionLimit = 10 | 15;

export type Density = 'comfortable' | 'compact';
export type SearchKey = 'k' | 'p' | 'j';
/** 0 = off, -1 = forever, otherwise days. */
export type RetentionDays = 0 | 7 | 30 | 90 | -1;

export interface Settings {
  readonly theme: ThemePreference;
  readonly quickActionLimit: QuickActionLimit;
  readonly density: Density;
  readonly terminalFontSize: number;
  readonly terminalScreenReader: boolean;
  readonly autoStartSessions: boolean;
  readonly searchShortcut: SearchKey;
  readonly historyRetentionDays: RetentionDays;
}

export type SettingsPatch = Partial<Settings>;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  quickActionLimit: 10,
  density: 'comfortable',
  terminalFontSize: 13,
  terminalScreenReader: false,
  autoStartSessions: true,
  searchShortcut: 'k',
  historyRetentionDays: 30,
};

export interface HistoryEntry {
  readonly id: number;
  readonly commandId: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly name: string;
  readonly shell: Shell | null;
  readonly exists: boolean;
}

export interface CustomDraft {
  readonly shell: Shell;
  readonly name: string;
  readonly summary: string;
  readonly category: CategoryId;
  readonly syntax: string;
  readonly keywords: readonly string[];
  readonly aliases: readonly string[];
  readonly notes: string | null;
  readonly requiresAdmin: boolean;
  readonly modifies: boolean;
  readonly risk: RiskLevel;
  readonly placeholders: readonly Placeholder[];
}

export interface ImportReport {
  readonly imported: number;
}

export interface StartupInfo {
  readonly notice: string | null;
  readonly builtinCount: number;
}

export type ErrorKind = 'notFound' | 'validation' | 'limit' | 'conflict' | 'storage' | 'internal' | 'unavailable';

export interface FieldError {
  readonly field: string;
  readonly message: string;
}
