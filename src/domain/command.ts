/**
 * Domain vocabulary for commands. Shapes come from the backend (src/ipc/types.ts);
 * this module adds presentation labels. Presentation code only ever reads
 * `syntax` as the canonical text. Any shortened preview is a display concern.
 */
import type { CommandView, RiskLevel, Shell } from '../ipc/types';

export type { CategoryId, CommandDetails, RiskLevel, Shell, SyntaxPart } from '../ipc/types';

export type CommandEntry = CommandView;

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
