'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { mobileSchema, pinCodeSchema } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PinCodeMultiSelect } from '@/components/master/pin-code-multi-select';
import type { StaffCredentialsDto, StaffDto } from '@/lib/types';

const staffFormSchema = z.object({
  name: z.string().trim().min(2, 'Enter the staff member name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid work email'),
  mobile: mobileSchema,
  employeeCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/, 'Use 3-20 letters, digits, hyphens or underscores'),
  pinCodes: z.array(pinCodeSchema).max(50, 'Assign at most 50 PIN codes'),
});

type StaffForm = z.infer<typeof staffFormSchema>;

export interface StaffDrawerProps {
  open: boolean;
  /** Null creates; a member edits. */
  staff: StaffDto | null;
  onClose: () => void;
  onSaved: (credentials?: StaffCredentialsDto) => void;
}

export function StaffDrawer({ open, staff, onClose, onSaved }: StaffDrawerProps) {
  const editing = staff !== null;
  const form = useForm<StaffForm>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: { name: '', email: '', mobile: '', employeeCode: '', pinCodes: [] },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: staff?.name ?? '',
      email: staff?.email ?? '',
      mobile: staff?.mobile ?? '',
      employeeCode: staff?.employeeCode ?? '',
      pinCodes: staff?.pinCodes ?? [],
    });
    form.clearErrors();
  }, [open, staff, form]);

  if (!open) return null;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (editing && staff) {
        await api.patch<StaffDto>(`/api/v1/admin/staff/${staff.id}`, {
          name: values.name,
          mobile: values.mobile,
          employeeCode: values.employeeCode,
          pinCodes: values.pinCodes,
        });
        onSaved();
      } else {
        const created = await api.post<StaffCredentialsDto>('/api/v1/admin/staff', {
          name: values.name,
          email: values.email,
          mobile: values.mobile,
          employeeCode: values.employeeCode,
          pinCodes: values.pinCodes,
        });
        onSaved(created.data);
      }
      onClose();
    } catch (error) {
      form.setError('root', {
        message:
          error instanceof ApiClientError ? error.message : 'Could not save the staff member.',
      });
    }
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-foreground/20"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-drawer-title"
        className="relative h-full w-full max-w-md overflow-y-auto border-l bg-card p-6 shadow-xl"
      >
        <h2 id="staff-drawer-title" className="text-lg font-semibold">
          {editing ? 'Edit staff member' : 'Add staff member'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {editing
            ? 'Changes apply immediately. Territory PINs are for reference only.'
            : 'A temporary password is generated, shown once here and emailed to them.'}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          {form.formState.errors.root ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {form.formState.errors.root.message}
            </p>
          ) : null}

          <div>
            <Label htmlFor="staff-name" required>
              Full name
            </Label>
            <Input
              id="staff-name"
              aria-invalid={Boolean(form.formState.errors.name)}
              {...form.register('name')}
            />
            {form.formState.errors.name ? (
              <p className="field-error" role="alert">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="staff-email" required>
              Work email
            </Label>
            <Input
              id="staff-email"
              type="email"
              autoComplete="off"
              disabled={editing}
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
            {editing ? (
              <p className="field-help">Email is the sign-in identity and cannot be changed.</p>
            ) : null}
            {form.formState.errors.email ? (
              <p className="field-error" role="alert">
                {form.formState.errors.email.message}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="staff-mobile" required>
              Mobile
            </Label>
            <Input
              id="staff-mobile"
              inputMode="numeric"
              maxLength={10}
              aria-invalid={Boolean(form.formState.errors.mobile)}
              {...form.register('mobile')}
            />
            {form.formState.errors.mobile ? (
              <p className="field-error" role="alert">
                {form.formState.errors.mobile.message}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="staff-employee-code" required>
              Employee code
            </Label>
            <Input
              id="staff-employee-code"
              aria-invalid={Boolean(form.formState.errors.employeeCode)}
              {...form.register('employeeCode')}
            />
            {form.formState.errors.employeeCode ? (
              <p className="field-error" role="alert">
                {form.formState.errors.employeeCode.message}
              </p>
            ) : null}
          </div>

          <PinCodeMultiSelect
            id="staff-pins"
            value={form.watch('pinCodes')}
            onChange={(next) => form.setValue('pinCodes', next, { shouldValidate: true })}
            error={form.formState.errors.pinCodes?.message}
            disabled={form.formState.isSubmitting}
          />

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? 'Saving…'
                : editing
                  ? 'Save changes'
                  : 'Create staff member'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </aside>
    </div>
  );
}
