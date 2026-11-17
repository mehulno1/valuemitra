// Pickers shared by New assignment and Edit assignment (13 Nov re-test A5–A7): a branch with "+ Add new branch",
// "Sourced by" with "+ Add new name", and report formats named in plain words.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Field, useErrorToast, useToast } from '@/components/ui';

export interface Branch { id: number; bank_id: number; code: string; name: string; bank_code: string; contact_name: string | null; contact_role: string | null }

/** "SBI - Flat Completed" → "SBI – Flat, building completed", with a one-line hint (A7). */
export function formatWords(name: string) {
  const n = name.replace(/\s+-\s+/g, ' – ');
  if (/under\s*construction|\buc\b/i.test(name)) return { label: n.replace(/flat\s*under\s*construction/i, 'Flat, under construction'), hint: 'The building is still being built (no O.C. yet); % of work completed is worked out.' };
  if (/completed/i.test(name)) return { label: n.replace(/flat\s*completed/i, 'Flat, building completed'), hint: 'The building is complete (O.C. received, or occupied).' };
  return { label: n, hint: '' };
}

const NEW = -1;

/** Branch of the chosen bank, or a new one saved to Banks & branches (name, code, contact). */
export function BranchPicker({ bankId, branches, value, onChange }: { bankId: number; branches: Branch[]; value: number; onChange: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const onErr = useErrorToast();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', code: '', contactName: '', contactPhone: '' });
  const add = useMutation({
    mutationFn: () => api.post<{ id: number; name: string }>('/api/branches/quick', { bankId, name: f.name, code: f.code || null, contactName: f.contactName || null, contactPhone: f.contactPhone || null }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['meta'] }); onChange(r.id); setAdding(false); setF({ name: '', code: '', contactName: '', contactPhone: '' }); toast(`Branch ${r.name} added`); },
    onError: onErr,
  });
  const list = branches.filter((b) => b.bank_id === bankId);
  return (
    <>
      <Field label="Branch" hint={!adding && bankId && !list.length ? 'No branches for this bank yet: add one.' : undefined}>
        <select value={adding ? NEW : value} disabled={!bankId} onChange={(e) => { const v = Number(e.target.value); if (v === NEW) setAdding(true); else { setAdding(false); onChange(v); } }}>
          {!list.length && !adding && <option value={0}>Choose or add a branch</option>}
          {list.map((b) => <option key={b.id} value={b.id}>{b.name}{b.code && b.code !== b.name.toUpperCase() ? ` (${b.code})` : ''}</option>)}
          <option value={NEW}>+ Add new branch</option>
        </select>
      </Field>
      {adding && (
        <div className="field full rounded-lg border border-line bg-sunk p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Branch name"><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kalyan" /></Field>
            <Field label="Branch code" hint="Optional"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. 01234" /></Field>
            <Field label="Contact name" hint="Optional"><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
            <Field label="Contact phone" hint="Optional"><input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
          </div>
          <div className="btns mt-2">
            <button type="button" className="btn pri sm" disabled={f.name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Save branch</button>
            <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Cancel</button>
            <span className="sub">Saved to Firm settings → Banks & branches; the report prints this name.</span>
          </div>
        </div>
      )}
    </>
  );
}

/** Who sourced the case for the firm (A6): a master list with "+ Add new name". Records only; never printed. */
export function SourcedByPicker({ value, onChange }: { value: number; onChange: (id: number) => void }) {
  const qc = useQueryClient();
  const onErr = useErrorToast();
  const list = useQuery({ queryKey: ['case-sources'], queryFn: () => api.get<{ id: number; name: string }[]>('/api/case-sources') });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post<{ id: number; name: string }>('/api/case-sources', { name }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['case-sources'] }); onChange(r.id); setAdding(false); setName(''); },
    onError: onErr,
  });
  return (
    <Field label="Sourced by" hint={adding ? undefined : 'Who brought the case to the firm. Kept for records; not printed in the bank report.'}>
      {adding ? (
        <div className="flex gap-2">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the person or agency" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (name.trim().length >= 2) add.mutate(); } }} />
          <button type="button" className="btn pri sm" disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Add</button>
          <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <select value={value} onChange={(e) => { const v = Number(e.target.value); if (v === NEW) setAdding(true); else onChange(v); }}>
          <option value={0}>Not recorded</option>
          {(list.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={NEW}>+ Add new name</option>
        </select>
      )}
    </Field>
  );
}
