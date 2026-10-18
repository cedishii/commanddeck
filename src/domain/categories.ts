import type { CategoryId, Shell } from './command';

export interface Category {
  readonly id: CategoryId;
  readonly label: string;
}

const LABELS: Record<CategoryId, string> = {
  networking: 'Networking',
  files: 'Files and Directories',
  'system-info': 'System Information',
  processes: 'Processes',
  services: 'Processes and Services',
  troubleshooting: 'Troubleshooting',
  disk: 'Disk Management',
  administration: 'Administration',
  security: 'Security and Diagnostics',
  environment: 'Environment and Configuration',
  'windows-config': 'Windows Configuration',
  automation: 'Automation Utilities',
};

const ORDER: Record<Shell, readonly CategoryId[]> = {
  cmd: [
    'networking',
    'files',
    'system-info',
    'processes',
    'troubleshooting',
    'disk',
    'administration',
    'security',
    'environment',
  ],
  powershell: [
    'system-info',
    'services',
    'files',
    'networking',
    'troubleshooting',
    'administration',
    'security',
    'windows-config',
    'automation',
  ],
};

export function categoriesFor(shell: Shell): readonly Category[] {
  return ORDER[shell].map((id) => ({ id, label: LABELS[id] }));
}

export function categoryLabel(id: CategoryId): string {
  return LABELS[id];
}
