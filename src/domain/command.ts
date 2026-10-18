/**
 * Domain types for command entries.
 *
 * In Phase 2 these mirror the catalog JSON schema served by the Rust backend
 * (docs/ARCHITECTURE.md §4). Presentation code only ever reads `syntax` as the
 * canonical text. Any shortened preview is a display concern.
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

export interface CommandEntry {
  readonly id: string;
  readonly shell: Shell;
  readonly name: string;
  readonly summary: string;
  readonly category: CategoryId;
  /** Canonical command text. Copy and (later) execution always use this exact value. */
  readonly syntax: string;
  readonly requiresAdmin: boolean;
  readonly risk: RiskLevel;
  readonly modifies: boolean;
  readonly details?: CommandDetails;
}

export const SHELL_LABEL: Record<Shell, string> = {
  cmd: 'CMD',
  powershell: 'PowerShell',
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  L1: 'Routine',
  L2: 'Changes system',
  L3: 'High impact',
};

export const RISK_DESCRIPTION: Record<RiskLevel, string> = {
  L1: 'Read-only or routine. Runs without confirmation.',
  L2: 'Makes a meaningful change. May ask for a short confirmation.',
  L3: 'Potentially destructive or hard to undo. Requires explicit confirmation.',
};
