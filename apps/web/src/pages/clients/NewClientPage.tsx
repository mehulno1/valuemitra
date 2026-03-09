import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { useCreateClient } from '../../api/hooks/useClients.js';
import { PageHeader } from '../../components/shared/PageHeader.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { useToast } from '../../hooks/use-toast.js';
import type { ClientType } from '@valuemitra/shared';

const schema = z.object({
  clientType: z.enum(['INDIVIDUAL', 'COMPANY', 'BANK', 'NBFC', 'HFC']),
  fullName:    z.string().min(2).max(200).optional(),
  companyName: z.string().min(2).max(200).optional(),
  bankName:    z.string().min(2).max(200).optional(),
  bankBranch:  z.string().max(200).optional(),
  email:       z.string().email().optional().or(z.literal('')),
  phone:       z.string().regex(/^[6-9]\d{9}$/, 'Enter valid 10-digit mobile').optional().or(z.literal('')),
  pan:         z.string().max(20).optional(),
  gstin:       z.string().max(20).optional(),
  ifscCode:    z.string().max(20).optional(),
  city:        z.string().max(100).optional(),
  state:       z.string().max(100).optional(),
});

type FormValues = z.infer<typeof schema>;

const CLIENT_TYPES = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'COMPANY',    label: 'Company' },
  { value: 'BANK',       label: 'Bank' },
  { value: 'NBFC',       label: 'NBFC' },
  { value: 'HFC',        label: 'Housing Finance Company' },
];

export default function NewClientPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { mutate: createClient, isPending } = useCreateClient();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { clientType: 'INDIVIDUAL' },
    shouldUnregister: true,
  });

  const clientType = watch('clientType');
  const isOrg = clientType !== 'INDIVIDUAL';
  const isBank = clientType === 'BANK' || clientType === 'NBFC' || clientType === 'HFC';

  const onSubmit = (values: FormValues) => {
    // Strip empty strings so optional regex-validated fields (pan, gstin, ifscCode) don't fail server validation
    const clean = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== ''),
    ) as FormValues;
    createClient(clean, {
      onSuccess: (res) => {
        toast({ title: 'Client created' });
        navigate(`/clients/${(res as { data: { id: string } }).data.id}`);
      },
      onError: () => toast({ title: 'Failed to create client', variant: 'destructive' }),
    });
  };

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate('/clients')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <PageHeader title="New Client" description="Add a new client to your firm." />

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>Client Type</Label>
              <Select
                value={clientType}
                onValueChange={(v) => setValue('clientType', v as ClientType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Name field — varies by type */}
            {!isOrg && (
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input {...register('fullName')} placeholder="e.g. Rajesh Kumar" />
                {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
              </div>
            )}
            {isBank ? (
              <>
                <div className="space-y-2">
                  <Label>Bank / Institution Name *</Label>
                  <Input {...register('bankName')} placeholder="e.g. Punjab National Bank" />
                  {errors.bankName && <p className="text-xs text-destructive">{errors.bankName.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Input {...register('bankBranch')} placeholder="e.g. Ahmedabad Main Branch" />
                </div>
              </>
            ) : isOrg ? (
              <div className="space-y-2">
                <Label>Company Name *</Label>
                <Input {...register('companyName')} placeholder="e.g. Mehul Developers Pvt Ltd" />
                {errors.companyName && <p className="text-xs text-destructive">{errors.companyName.message}</p>}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" {...register('email')} placeholder="client@example.com" />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input {...register('phone')} placeholder="10-digit mobile" />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>City</Label>
                <Input {...register('city')} placeholder="e.g. Pune" />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input {...register('state')} placeholder="e.g. Maharashtra" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>PAN</Label>
                <Input {...register('pan')} placeholder="ABCDE1234F" className="uppercase" />
              </div>
              <div className="space-y-2">
                <Label>GSTIN</Label>
                <Input {...register('gstin')} placeholder="22AAAAA0000A1Z5" className="uppercase" />
              </div>
            </div>

            {isBank && (
              <div className="space-y-2">
                <Label>IFSC Code</Label>
                <Input {...register('ifscCode')} placeholder="PUNB0001234" className="uppercase" />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Creating…' : 'Create Client'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/clients')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
