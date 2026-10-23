import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/** Header data for one case, as returned by GET /api/assignments/:id */
export interface CaseHeader {
  id: number;
  case_no: string;
  borrower_name: string | null;
  property_type: string;
  locality_hint: string | null;
  purpose: string;
  stage: string;
  stage_label: string;
  valuation_applied?: boolean;
  site_received?: boolean;
  created_at: string;
  updated_at: string;
  bank_contact: string | null;
  received_via: string | null;
  bank_ref_no: string | null;
  engineer_id: number | null;
  engineer_name: string | null;
  engineer_phone: string | null;
  report_no: string | null;
  report_rev: number;
  signed_at: string | null;
  sent_at: string | null;
  sent_for_review_at: string | null;
  draft_version: number;
  bank_code: string;
  bank_name: string;
  branch_code: string;
  branch_name: string;
  contact_email: string | null;
  template_name: string | null;
  template_version: number | null;
  personal_data_removed_at: string | null;
  stages: { from_stage: string | null; to_stage: string; created_at: string }[];
}

export interface TabProps {
  c: CaseHeader;
  /** navigate to another tab of this case */
  go: (tab: TabKey) => void;
  /** refetch everything about this case (header, tab data) after a change */
  refresh: () => void;
  locked: boolean;
}

export type TabKey = 'docs' | 'ext' | 'site' | 'mkt' | 'val' | 'chk' | 'rep' | 'out' | 'hist';

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'docs', label: 'Documents' },
  { key: 'ext', label: 'Extracted details' },
  { key: 'site', label: 'Site visit' },
  { key: 'mkt', label: 'Market evidence' },
  { key: 'val', label: 'Valuation' },
  { key: 'chk', label: 'Checks' },
  { key: 'rep', label: 'Report & sign-off' },
  { key: 'out', label: 'Output' },
  { key: 'hist', label: 'History' },
];

/** Query keys are always ['case', id, ...] so one invalidation refreshes the whole workspace. */
export const caseKey = (id: number, ...rest: unknown[]) => ['case', id, ...rest];

export function useCaseRefresh(id: number) {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['case', id] }), [qc, id]);
}
