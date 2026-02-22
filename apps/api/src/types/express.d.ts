import { UserRole } from '@valuemitra/shared';

declare global {
  namespace Express {
    interface Request {
      // Set by auth.middleware — available on all authenticated routes
      user?: {
        id: string;
        email: string;
        role: UserRole;
        tenantId: string;
      };
      // Set by tenant.middleware — available on all tenant-scoped routes
      tenant?: {
        id: string;
        name: string;
        firmCode: string;
        planId: string;
      };
    }
  }
}
