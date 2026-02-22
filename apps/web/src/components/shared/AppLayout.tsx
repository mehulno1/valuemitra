import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store.js';
import { useLogout } from '../../api/hooks/useAuth.js';
import { cn } from '../../lib/utils.js';

const navItems = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Assignments', to: '/assignments' },
  { label: 'Clients', to: '/clients' },
  { label: 'Documents', to: '/documents' },
  { label: 'Valuation', to: '/valuation' },
  { label: 'Reports', to: '/reports' },
];

export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const { mutate: logout } = useLogout();

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h1 className="font-bold text-primary text-lg">ValueMitra</h1>
          <p className="text-xs text-muted-foreground truncate">{tenant?.name}</p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t">
          <div className="mb-2">
            <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
            <p className="text-xs text-muted-foreground">{user?.role}</p>
          </div>
          <button
            onClick={() => logout()}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
