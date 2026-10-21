import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ROLE_LABEL } from '@vm/shared';
import { useAuth } from '@/lib/auth';

const NAV: { to: string; label: string; tag?: string; perm?: string; match?: RegExp }[] = [
  { to: '/', label: 'Valuation Assignments', match: /^\/($|cases|new)/ },
  { to: '/quick-estimate', label: 'Quick Estimate', tag: 'Coming soon' },
  { to: '/billing', label: 'Billing & payouts', perm: 'bill' },
  { to: '/analytics', label: 'Reports & analytics' },
  { to: '/data', label: 'Data import & export' },
  { to: '/formats', label: 'Bank formats' },
  { to: '/master', label: 'Master data', perm: 'config' },
  { to: '/settings', label: 'Firm settings' },
];

export function Shell() {
  const { user, signOut, can } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <div className="app">
      <div className="mobilebar">
        <div className="brand"><div className="seal">VM</div><b>ValueMitra</b></div>
        <button className="btn sm" onClick={() => setOpen(true)} aria-label="Open menu">Menu</button>
      </div>
      <aside className={`side ${open ? 'open' : ''}`} onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
        <div className="flex items-center justify-between">
          <div className="brand"><div className="seal">VM</div><div><b>ValueMitra</b><small>{user?.firm_code} · Phase 1</small></div></div>
          {open && <button className="btn sm ghost" onClick={() => setOpen(false)}>Close</button>}
        </div>
        <nav className="nav">
          {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive || n.match?.test(loc.pathname) ? 'on' : '')}>
              <span>{n.label}</span>
              {n.tag && <span className="tag">{n.tag}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <b>{user?.name}</b>
          {user ? ROLE_LABEL[user.role] : ''} · {user?.firm_name}
          <div className="btns mt-2">
            <button className="btn sm ghost" onClick={() => signOut()}>Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
