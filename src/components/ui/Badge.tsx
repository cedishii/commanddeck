import { ShieldAlert, ShieldCheck, ShieldEllipsis, UserCog } from 'lucide-react';
import type { ReactNode } from 'react';
import { RISK_DESCRIPTION, RISK_LABEL, SHELL_LABEL, type RiskLevel, type Shell } from '../../domain/command';

const base = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap';

function Chip({ className, title, children }: { className: string; title?: string; children: ReactNode }) {
  return (
    <span className={`${base} ${className}`} title={title}>
      {children}
    </span>
  );
}

const RISK_STYLE: Record<RiskLevel, string> = {
  L1: 'bg-risk1-bg text-risk1-fg',
  L2: 'bg-risk2-bg text-risk2-fg',
  L3: 'bg-risk3-bg text-risk3-fg',
};

const RISK_ICON: Record<RiskLevel, typeof ShieldCheck> = {
  L1: ShieldCheck,
  L2: ShieldEllipsis,
  L3: ShieldAlert,
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const Icon = RISK_ICON[risk];
  return (
    <Chip className={RISK_STYLE[risk]} title={RISK_DESCRIPTION[risk]}>
      <Icon aria-hidden size={13} />
      {RISK_LABEL[risk]}
    </Chip>
  );
}

export function AdminBadge() {
  return (
    <Chip className="bg-admin-bg text-admin-fg" title="Needs administrator rights. Windows will refuse it in a standard-user context.">
      <UserCog aria-hidden size={13} />
      Admin
    </Chip>
  );
}

export function ShellBadge({ shell }: { shell: Shell }) {
  return <Chip className="border border-border text-muted">{SHELL_LABEL[shell]}</Chip>;
}

export function MultiStepBadge() {
  return (
    <Chip className="border border-border text-muted" title="Runs several operations (chaining, pipes, multiple lines) or a script.">
      Multi-step
    </Chip>
  );
}

export function CustomBadge() {
  return (
    <Chip className="border border-dashed border-border text-muted" title="Your own command. Its risk level is your declaration and is not analyzed by CommandDeck yet.">
      Custom
    </Chip>
  );
}
