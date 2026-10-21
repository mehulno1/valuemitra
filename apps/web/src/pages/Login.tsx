import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState<{ mode: 'verify' | 'enroll'; token: string; qr?: string; secret?: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  };

  const login = () => run(async () => {
    const r = await api.post('/api/auth/login', { email, password });
    if (r.mfa) {
      if (r.mfa === 'enroll') {
        const e = await api.post('/api/auth/mfa/enroll', { mfaToken: r.mfaToken });
        setMfa({ mode: 'enroll', token: r.mfaToken, qr: e.qr, secret: e.secret });
      } else setMfa({ mode: 'verify', token: r.mfaToken });
      return;
    }
    signIn(r);
  });

  const verify = () => run(async () => signIn(await api.post('/api/auth/mfa/verify', { mfaToken: mfa!.token, code })));

  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="panel grid w-full max-w-sm gap-5 p-7">
        <div className="brand"><div className="seal">VM</div><div><b>ValueMitra</b><small>Valuation, start to paid</small></div></div>
        {!mfa ? (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); login(); }}>
            <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            {err && <div className="text-[13px] text-crit">{err}</div>}
            <button className="btn pri justify-center" disabled={busy}>Sign in</button>
          </form>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); verify(); }}>
            {mfa.mode === 'enroll' ? (
              <div className="grid gap-2 text-[13px]">
                <b>Set up two-factor login</b>
                <span className="muted">Valuers and admins sign in with a code from an authenticator app (Google Authenticator, Microsoft Authenticator). Scan this code, then enter the 6 digits it shows.</span>
                {mfa.qr && <img src={mfa.qr} alt="Authenticator QR code" className="mx-auto w-44" />}
                <span className="sub">Or enter this key: <span className="mono break-all">{mfa.secret}</span></span>
              </div>
            ) : (
              <div className="text-[13px]"><b>Two-factor login</b><div className="muted">Enter the 6-digit code from your authenticator app.</div></div>
            )}
            <div className="field"><label htmlFor="code">Code</label><input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></div>
            {err && <div className="text-[13px] text-crit">{err}</div>}
            <div className="btns"><button className="btn pri" disabled={busy}>Verify</button><button type="button" className="btn ghost" onClick={() => { setMfa(null); setCode(''); }}>Back</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
