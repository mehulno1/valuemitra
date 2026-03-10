import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, UserX } from 'lucide-react';
import { useUsers, useCreateUser, useDeactivateUser } from '../../api/hooks/useUsers.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PageHeader } from '../../components/shared/PageHeader.js';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';

const ROLE_LABELS: Record<string, string> = {
  TENANT_ADMIN: 'Admin',
  VALUER:       'Valuer',
  REVIEWER:     'Reviewer',
  INSPECTOR:    'Inspector',
  VIEWER:       'Viewer',
};

const createUserSchema = z.object({
  fullName:  z.string().min(2, 'Full name required'),
  email:     z.string().email('Valid email required'),
  password:  z.string().min(8, 'Minimum 8 characters'),
  role:      z.string().min(1, 'Role required'),
  phone:     z.string().optional(),
  ibbiRegNo: z.string().optional(),
});
type CreateUserForm = z.infer<typeof createUserSchema>;

export default function UsersPage() {
  const { isAdmin } = usePermissions();
  const { data: users, isLoading, isError } = useUsers();
  const createUser     = useCreateUser();
  const deactivateUser = useDeactivateUser();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
  });

  function onSubmit(data: CreateUserForm) {
    createUser.mutate(data, {
      onSuccess: () => {
        setDialogOpen(false);
        reset();
      },
    });
  }

  function handleDeactivate(userId: string) {
    if (!confirm('Deactivate this user? They will be logged out and cannot log in.')) return;
    setDeactivatingId(userId);
    deactivateUser.mutate(userId, {
      onSettled: () => setDeactivatingId(null),
    });
  }

  return (
    <div>
      <PageHeader
        title="Team"
        description="Manage users in your firm."
        action={
          isAdmin ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add User
            </Button>
          ) : undefined
        }
      />

      {isLoading && <LoadingSpinner />}
      {isError && <p className="text-destructive text-sm">Failed to load users.</p>}

      {!isLoading && !isError && (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>IBBI Reg No</TableHead>
                {isAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!users || users.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
              {users?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.fullName}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{ROLE_LABELS[user.role] ?? user.role}</Badge>
                  </TableCell>
                  <TableCell>{user.phone ?? '—'}</TableCell>
                  <TableCell>{user.ibbiRegNo ?? '—'}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deactivatingId === user.id}
                        onClick={() => handleDeactivate(user.id)}
                        title="Deactivate user"
                      >
                        <UserX className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create User Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input {...register('fullName')} placeholder="Rajesh Kumar" />
              {errors.fullName && <p className="text-destructive text-xs">{errors.fullName.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Email</Label>
              <Input {...register('email')} type="email" placeholder="rajesh@firm.com" />
              {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Password</Label>
              <Input {...register('password')} type="password" placeholder="Min. 8 characters" />
              {errors.password && <p className="text-destructive text-xs">{errors.password.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Role</Label>
              <Select onValueChange={(v) => setValue('role', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VALUER">Valuer</SelectItem>
                  <SelectItem value="REVIEWER">Reviewer</SelectItem>
                  <SelectItem value="INSPECTOR">Inspector</SelectItem>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="TENANT_ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
              {errors.role && <p className="text-destructive text-xs">{errors.role.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Phone <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input {...register('phone')} placeholder="+91 98765 43210" />
            </div>

            <div className="space-y-1">
              <Label>IBBI Reg No <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input {...register('ibbiRegNo')} placeholder="IBBI/RV-01/2020/…" />
            </div>

            {createUser.isError && (
              <p className="text-destructive text-xs">
                {(createUser.error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create user.'}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); reset(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? 'Creating…' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
