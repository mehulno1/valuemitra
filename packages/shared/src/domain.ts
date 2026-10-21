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
  valuer: ['create', 'edit', 'val', 'sign', 'bill', 'exp', 'set', 'config'],
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

/** GST state codes (place of supply). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};
export const gstStateName = (code: string | null | undefined) => (code ? GST_STATES[code.padStart(2, '0')] ?? code : '');

export const PAY_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash'] as const;

/** Ageing buckets for outstanding invoices, by days since the invoice date. */
export const AGEING_BUCKETS = [
  { key: 'a0', label: '0–30 days', from: 0, to: 30 },
  { key: 'a31', label: '31–60 days', from: 31, to: 60 },
  { key: 'a61', label: '61–90 days', from: 61, to: 90 },
  { key: 'a91', label: 'Over 90 days', from: 91, to: Infinity },
] as const;
