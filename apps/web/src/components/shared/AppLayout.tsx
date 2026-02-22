import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, Users, FileText,
  Calculator, BarChart3, LogOut,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store.js';
import { useLogout } from '../../api/hooks/useAuth.js';
import { cn } from '../../lib/utils.js';
import { Avatar, AvatarFallback } from '../ui/avatar.js';

const navItems = [
  { label: 'Dashboard',   to: '/dashboard',   icon: LayoutDashboard },
  { label: 'Assignments', to: '/assignments',  icon: ClipboardList   },
  { label: 'Clients',     to: '/clients',      icon: Users           },
  { label: 'Documents',   to: '/documents',    icon: FileText        },
  { label: 'Valuation',   to: '/valuation',    icon: Calculator      },
  { label: 'Reports',     to: '/reports',      icon: BarChart3       },
];

export default function AppLayout() {
  const user   = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const { mutate: logout } = useLogout();

  const initials = user?.fullName
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?';

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h1 className="font-bold text-primary text-lg">ValueMitra</h1>
          <p className="text-xs text-muted-foreground truncate">{tenant?.name}</p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.fullName}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {user?.role?.toLowerCase().replace('_', ' ')}
            </p>
          </div>
          <button
            onClick={() => logout()}
            title="Sign out"
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
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
