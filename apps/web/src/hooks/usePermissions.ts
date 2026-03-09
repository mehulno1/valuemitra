import { useAuthStore } from '../stores/auth.store.js';

export function usePermissions() {
  const role = useAuthStore((s) => s.user?.role ?? '');

  const isAdmin     = role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN';
  const isValuer    = role === 'VALUER' || role === 'ASSISTANT';
  const isViewer    = role === 'VIEWER';
  const isInspector = role === 'INSPECTOR';

  return {
    isAdmin,
    isValuer,
    isViewer,
    isInspector,
    canCreate:  isAdmin || isValuer,
    canEdit:    isAdmin || isValuer,
    canDelete:  isAdmin || isValuer,
    canReview:  isAdmin,
    canDeliver: isAdmin,
  };
}
