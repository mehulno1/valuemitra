import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { RegisterTenantSchema, type RegisterTenantInput } from '@valuemitra/shared';
import { useRegister } from '../../api/hooks/useAuth.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.js';

export default function RegisterPage() {
  const { mutate: register_, isPending, error } = useRegister();

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterTenantInput>({
    resolver: zodResolver(RegisterTenantSchema),
  });

  const onSubmit = (data: RegisterTenantInput) => register_(data);
  const errMsg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">ValueMitra</h1>
          <p className="text-muted-foreground mt-1">Register your valuation firm</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create firm workspace</CardTitle>
            <CardDescription>
              You'll be the Tenant Admin. Add team members after signing in.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {errMsg && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md px-3 py-2">
                  {errMsg}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" {...register('firstName')} />
                  {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" {...register('lastName')} />
                  {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="Minimum 8 characters" {...register('password')} />
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="firmName">Firm Name</Label>
                <Input id="firmName" placeholder="e.g. Mehul & Associates LLP" {...register('firmName')} />
                {errors.firmName && <p className="text-xs text-destructive">{errors.firmName.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firmCode">Firm Code</Label>
                  <Input id="firmCode" placeholder="e.g. UCVLLP" {...register('firmCode')} />
                  <p className="text-xs text-muted-foreground">Used in report reference numbers</p>
                  {errors.firmCode && <p className="text-xs text-destructive">{errors.firmCode.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ibbiRegNo">IBBI Reg. No.</Label>
                  <Input id="ibbiRegNo" placeholder="e.g. IBBI/RV-E/02/2020/123" {...register('ibbiRegNo')} />
                  {errors.ibbiRegNo && <p className="text-xs text-destructive">{errors.ibbiRegNo.message}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ibbiRegCategory">IBBI Registration Category</Label>
                <Input id="ibbiRegCategory" placeholder="e.g. Land and Building" {...register('ibbiRegCategory')} />
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Creating workspace...' : 'Create workspace'}
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                Already registered?{' '}
                <Link to="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
