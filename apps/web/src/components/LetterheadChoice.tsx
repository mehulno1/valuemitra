// Where the firm's letterhead prints: every page, cover, page 2, nowhere, or chosen pages ("2", "1, 2", "2-4").
// Used by Firm settings → Report layout (the firm default) and by each bank format (which may keep the default).
import { useEffect, useState } from 'react';

const PAGES_RE = /^\s*\d{1,3}(\s*(-|–|to)\s*\d{1,3})?(\s*[,;]\s*\d{1,3}(\s*(-|–|to)\s*\d{1,3})?)*\s*$/;

export function LetterheadChoice({ value, pages, disabled, firmDefault, onSave }: {
  value: string; pages: string; disabled?: boolean; firmDefault?: boolean; onSave: (on: string, pages: string) => void;
}) {
  const [on, setOn] = useState(value);
  const [p, setP] = useState(pages);
  useEffect(() => { setOn(value); setP(pages); }, [value, pages]);
  const ok = PAGES_RE.test(p);
  return (
    <div className="grid gap-2">
      <select value={on} disabled={disabled} onChange={(e) => { setOn(e.target.value); if (e.target.value !== 'custom') onSave(e.target.value, ''); }}>
        {firmDefault && <option value="">Firm default (Settings → Report layout)</option>}
        <option value="all">Every page</option><option value="cover">Cover page only</option><option value="page2">Page 2 only</option>
        <option value="custom">Chosen pages…</option><option value="none">Nowhere (pre-printed paper)</option>
      </select>
      {on === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="inp" style={{ maxWidth: 160 }} value={p} disabled={disabled} placeholder="e.g. 2, or 1, 2, or 2-4" onChange={(e) => setP(e.target.value)} />
          <button type="button" className="btn sm" disabled={disabled || !ok || (on === value && p === pages)} onClick={() => onSave('custom', p.trim())}>Save pages</button>
          {p && !ok && <span className="sub">Page numbers, e.g. 2, or 1, 2, or 2-4</span>}
        </div>
      )}
    </div>
  );
}
