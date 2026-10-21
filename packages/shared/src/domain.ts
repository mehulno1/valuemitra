// Domain vocabulary shared by API and web.

export const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'docs', label: 'Awaiting documents' },
  { key: 'site', label: 'Site visit' },
  { key: 'draft', label: 'Drafting' },
  { key: 'review', label: 'Ready for review' },
  { key: 'signed', label: 'Signed' },
  { key: 'sent', label: 'Sent' },
  { key: 'billed', label: 'Billed' },
  { key: 'paid', label: 'Paid' },
] as const;
export type Stage = (typeof STAGES)[number]['key'];
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;

export const ROLES = ['coordinator', 'valuer', 'accounts', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  coordinator: 'Coordinator',
  valuer: 'Valuer',
  accounts: 'Accounts',
  admin: 'Admin',
};

export const PERMISSIONS = {
  create: 'Create cases',
  edit: 'Edit details',
  val: 'Set values',
  sign: 'Sign reports',
  bill: 'Billing',
  exp: 'Export data',
  set: 'Settings',
  config: 'Master data & templates',
} as const;
export type Permission = keyof typeof PERMISSIONS;

export const DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  coordinator: ['create', 'edit', 'exp'],
  valuer: ['create', 'edit', 'val', 'sign', 'bill', 'exp', 'set'],
  accounts: ['bill', 'exp'],
  admin: ['create', 'edit', 'exp', 'set', 'config', 'bill'],
};

/** Only a registered valuer can ever hold the sign permission. */
export const canHoldPermission = (role: Role, p: Permission) => p !== 'sign' || role === 'valuer';

export const PROPERTY_TYPES = [
  { key: 'flat', label: 'Flat' },
  { key: 'shop', label: 'Commercial shop' },
  { key: 'office', label: 'Commercial office' },
  { key: 'open_land', label: 'Open land' },
  { key: 'bungalow', label: 'Bungalow' },
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number]['key'];

export const RECEIVED_VIA = ['WhatsApp', 'Email', 'Phone call', 'By hand'] as const;

export type Severity = 'crit' | 'warn' | 'ok' | 'info';
export const SEVERITY_LABEL: Record<Severity, string> = { crit: 'Resolve', warn: 'Look', ok: 'Passed', info: 'Info' };

export type FieldDataType = 'text' | 'longtext' | 'number' | 'area' | 'money' | 'date' | 'enum' | 'boolean' | 'image';

export type ValueSource = 'document' | 'site_sheet' | 'derived' | 'manual' | 'report_edit' | 'valuation' | 'case' | 'firm' | 'evidence';

export const confClass = (c: number | null | undefined) =>
  c === null || c === undefined ? 'x' : c >= 90 ? 'hi' : c >= 75 ? 'md' : 'lo';

export const PHOTO_MIN = 9;
export const PHOTO_MAX = 18;
