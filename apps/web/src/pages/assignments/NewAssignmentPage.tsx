import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ChevronsUpDown, Check } from 'lucide-react';
import { format } from 'date-fns';
import { useCreateAssignment } from '../../api/hooks/useAssignments.js';
import { useClients } from '../../api/hooks/useClients.js';
import { PageHeader } from '../../components/shared/PageHeader.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js';
import { Calendar } from '../../components/ui/calendar.js';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../components/ui/command.js';
import { Textarea } from '../../components/ui/textarea.js';
import { useToast } from '../../hooks/use-toast.js';
import { cn } from '../../lib/utils.js';
import type { PropertyType, ValuationPurpose } from '@valuemitra/shared';

const schema = z.object({
  clientId:            z.string().uuid('Select a client'),
  propertyType:        z.string().min(1, 'Required'),
  purposeOfValuation:  z.string().min(1, 'Required'),
  propertyAddress:     z.string().min(5),
  propertyCity:        z.string().min(2),
  propertyDistrict:    z.string().optional(),
  propertyState:       z.string().min(2),
  propertyPincode:     z.string().regex(/^\d{6}$/, 'Enter 6-digit pincode').optional().or(z.literal('')),
  inspectionDate:      z.string().optional(),
  bankName:            z.string().optional(),
  loanAccountNo:       z.string().optional(),
  bankBranch:          z.string().optional(),
  referenceNote:       z.string().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

const PROPERTY_TYPES = [
  { value: 'RESIDENTIAL_FLAT',    label: 'Residential Flat' },
  { value: 'RESIDENTIAL_BUNGALOW',label: 'Residential Bungalow' },
  { value: 'RESIDENTIAL_PLOT',    label: 'Residential Plot' },
  { value: 'COMMERCIAL_OFFICE',   label: 'Commercial Office' },
  { value: 'COMMERCIAL_SHOP',     label: 'Commercial Shop' },
  { value: 'COMMERCIAL_SHOWROOM', label: 'Commercial Showroom' },
  { value: 'INDUSTRIAL_FACTORY',  label: 'Industrial Factory' },
  { value: 'INDUSTRIAL_PLOT',     label: 'Industrial Plot' },
  { value: 'LAND_AND_BUILDING',   label: 'Land & Building' },
  { value: 'OPEN_LAND',           label: 'Open Land' },
  { value: 'AGRICULTURAL_LAND',   label: 'Agricultural Land' },
  { value: 'MIXED_USE',           label: 'Mixed Use' },
];

const PURPOSES = [
  { value: 'MORTGAGE',       label: 'Mortgage / Home Loan' },
  { value: 'INSURANCE',      label: 'Insurance' },
  { value: 'ACQUISITION',    label: 'Acquisition' },
  { value: 'AMALGAMATION',   label: 'Amalgamation / Merger' },
  { value: 'COURT_MATTER',   label: 'Court Matter' },
  { value: 'INCOME_TAX',     label: 'Income Tax' },
  { value: 'WEALTH_TAX',     label: 'Wealth Tax' },
  { value: 'STAMP_DUTY',     label: 'Stamp Duty' },
  { value: 'FAIR_VALUE',     label: 'Fair Value' },
  { value: 'LIQUIDATION',    label: 'Liquidation' },
  { value: 'OTHER',          label: 'Other' },
];

export default function NewAssignmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { mutate: createAssignment, isPending } = useCreateAssignment();
  const { data: clientsData } = useClients();

  const [clientOpen, setClientOpen]   = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const clients = clientsData?.data ?? [];

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { clientId: searchParams.get('clientId') ?? '' },
  });

  const selectedClientId  = watch('clientId');
  const inspectionDate    = watch('inspectionDate');

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const clientLabel =
    selectedClient?.fullName ?? selectedClient?.companyName ?? selectedClient?.bankName ?? 'Select client…';

  function clientName(c: typeof clients[number]) {
    return c.fullName ?? c.companyName ?? c.bankName ?? 'Unknown';
  }

  const onSubmit = (values: FormValues) => {
    // Strip empty strings so optional regex-validated fields (propertyPincode, etc.) don't fail server validation
    const clean = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== ''),
    ) as FormValues;
    createAssignment(clean, {
      onSuccess: (res) => {
        toast({ title: 'Assignment created' });
        navigate(`/assignments/${(res as { data: { id: string } }).data.id}`);
      },
      onError: () => toast({ title: 'Failed to create assignment', variant: 'destructive' }),
    });
  };

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate('/assignments')}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Assignments
      </Button>
      <PageHeader title="New Assignment" description="Create a new property valuation assignment." />

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6">

        {/* Client */}
        <Card>
          <CardHeader><CardTitle className="text-base">Client</CardTitle></CardHeader>
          <CardContent>
            <Popover open={clientOpen} onOpenChange={setClientOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between">
                  {clientLabel}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[460px] p-0">
                <Command>
                  <CommandInput placeholder="Search clients…" />
                  <CommandList>
                    <CommandEmpty>No clients found. <button onClick={() => navigate('/clients/new')} className="text-primary underline">Create one.</button></CommandEmpty>
                    <CommandGroup>
                      {clients.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={clientName(c)}
                          onSelect={() => { setValue('clientId', c.id); setClientOpen(false); }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', selectedClientId === c.id ? 'opacity-100' : 'opacity-0')} />
                          <div>
                            <p className="font-medium">{clientName(c)}</p>
                            <p className="text-xs text-muted-foreground">{c.clientType} {c.city ? `· ${c.city}` : ''}</p>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {errors.clientId && <p className="text-xs text-destructive mt-1">{errors.clientId.message}</p>}
          </CardContent>
        </Card>

        {/* Property */}
        <Card>
          <CardHeader><CardTitle className="text-base">Property Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Property Type *</Label>
                <Select onValueChange={(v) => setValue('propertyType', v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {PROPERTY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.propertyType && <p className="text-xs text-destructive">{errors.propertyType.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Purpose of Valuation *</Label>
                <Select onValueChange={(v) => setValue('purposeOfValuation', v)}>
                  <SelectTrigger><SelectValue placeholder="Select purpose" /></SelectTrigger>
                  <SelectContent>
                    {PURPOSES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.purposeOfValuation && <p className="text-xs text-destructive">{errors.purposeOfValuation.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Fresh / Revaluation / Review</Label>
                <Select onValueChange={(v) => setValue('freshOrRevaluation' as never, v as never)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Fresh">Fresh</SelectItem>
                    <SelectItem value="Revaluation">Revaluation</SelectItem>
                    <SelectItem value="Review">Review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Property Address *</Label>
              <Input {...register('propertyAddress')} placeholder="Plot / Flat / Building details" />
              {errors.propertyAddress && <p className="text-xs text-destructive">{errors.propertyAddress.message}</p>}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>City *</Label>
                <Input {...register('propertyCity')} placeholder="e.g. Pune" />
                {errors.propertyCity && <p className="text-xs text-destructive">{errors.propertyCity.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>District</Label>
                <Input {...register('propertyDistrict')} placeholder="e.g. Pune" />
              </div>
              <div className="space-y-2">
                <Label>State *</Label>
                <Input {...register('propertyState')} placeholder="e.g. Maharashtra" />
                {errors.propertyState && <p className="text-xs text-destructive">{errors.propertyState.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pincode</Label>
                <Input {...register('propertyPincode')} placeholder="6 digits" />
                {errors.propertyPincode && <p className="text-xs text-destructive">{errors.propertyPincode.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Inspection Date</Label>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start font-normal">
                      {inspectionDate ? format(new Date(inspectionDate), 'dd MMM yyyy') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={inspectionDate ? new Date(inspectionDate) : undefined}
                      onSelect={(d) => { setValue('inspectionDate', d?.toISOString()); setCalendarOpen(false); }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bank Details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Bank / Lender Details (optional)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bank Name</Label>
                <Input {...register('bankName')} placeholder="e.g. Punjab National Bank" />
              </div>
              <div className="space-y-2">
                <Label>Loan Account No.</Label>
                <Input {...register('loanAccountNo')} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Input {...register('bankBranch')} placeholder="Branch name and city" />
            </div>
            <div className="space-y-2">
              <Label>Reference Note</Label>
              <Textarea {...register('referenceNote')} placeholder="Any additional notes…" rows={2} />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Creating…' : 'Create Assignment'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/assignments')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
