// Change the report format of a case (B3, C5): e.g. an under-construction building drafted in Flat Completed.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, useErrorToast, useToast } from '@/components/ui';
import type { CaseHeader } from './context';

export default function FormatChange({ c, refresh }: { c: CaseHeader; refresh: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const onErr = useErrorToast();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['case-formats', c.id], queryFn: () => api.get<{ templateId: number; name: string; versionId: number; version: number }[]>(`/api/assignments/${c.id}/formats`), enabled: open });
  const set = useMutation({ mutationFn: (templateId: number) => api.post(`/api/assignments/${c.id}/format`, { templateId }), onSuccess: () => { toast('Format changed; the draft uses it from now'); setOpen(false); refresh(); }, onError: onErr });
  if (c.signed_at || !can('edit')) return null;
  return (
    <>
      <button className="linkbtn ml-1" onClick={() => setOpen(true)}>Change</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Report format for this case" actions={<button className="btn ghost" onClick={() => setOpen(false)}>Close</button>}>
        <p className="sub">Formats published for {c.bank_code}, {c.branch_name}. The values already captured carry over; fields only the new format asks for show on Checks.</p>
        <div className="grid gap-2">
          {(list.data ?? []).map((f) => (
            <div key={f.templateId} className="flex items-center justify-between gap-2">
              <span>{f.name} <span className="sub">v{f.version}</span></span>
              {f.name === c.template_name ? <span className="sev ok">In use</span> : <button className="btn sm" disabled={set.isPending} onClick={() => set.mutate(f.templateId)}>Use this format</button>}
            </div>
          ))}
          {list.isLoading && <span className="sub">Loading…</span>}
        </div>
      </Modal>
    </>
  );
}
