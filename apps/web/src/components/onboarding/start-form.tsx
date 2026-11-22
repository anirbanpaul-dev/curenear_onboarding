'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  providerTypeLabels,
  providerTypes,
  type DuplicateMatch,
  type ProviderType,
} from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PinCodeInput } from './field-renderer';
import type { OrganizationDto } from '@/lib/types';

const descriptions: Record<ProviderType, string> = {
  doctor: 'Individual practitioner and their registration.',
  clinic: 'Single or multi-specialty clinic, polyclinic or day-care centre.',
  pharmacy: 'Retail pharmacy with drug licence and pharmacist details.',
  diagnostic_centre: 'Pathology, radiology or imaging centre.',
  care_provider: 'Home care, nursing and field-support provider.',
};

export function StartProviderForm() {
  const router = useRouter();
  const [providerType, setProviderType] = useState<ProviderType>('clinic');
  const [legalName, setLegalName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [warnings, setWarnings] = useState<DuplicateMatch[]>([]);
  const [checked, setChecked] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = legalName.trim().length > 1 && mobile.length === 10 && pinCode.length === 6;

  async function checkDuplicates(): Promise<DuplicateMatch[]> {
    const response = await api.post<{ warnings: DuplicateMatch[] }>(
      '/api/v1/providers/duplicate-check',
      { legal_name: legalName, mobile, pin_code: pinCode },
    );
    setWarnings(response.data.warnings);
    setChecked(true);
    return response.data.warnings;
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ provider: OrganizationDto }>('/api/v1/providers', {
        provider_type: providerType,
        legal_name: legalName.trim(),
        mobile,
        primary_pin_code: pinCode,
      });
      router.push(`/staff/providers/${response.data.provider.id}/edit`);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not create the draft.');
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!valid) {
      setError(
        'Choose a provider type, then enter the legal name, 10-digit mobile and 6-digit PIN.',
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const found = checked ? warnings : await checkDuplicates();
      if (found.length > 0 && !acknowledged) {
        setBusy(false);
        return;
      }
      await create();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not check duplicates.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Provider type</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {providerTypes.map((type) => {
            const selected = providerType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={selected}
                onClick={() => setProviderType(type)}
                className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                  selected ? 'border-primary bg-accent/50' : 'bg-card hover:bg-accent/30'
                }`}
              >
                <span className="block font-medium">{providerTypeLabels[type]}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {descriptions[type]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="legal-name" required>
            Legal name
          </Label>
          <Input
            id="legal-name"
            value={legalName}
            disabled={busy}
            onChange={(event) => {
              setLegalName(event.target.value);
              setChecked(false);
            }}
            onBlur={() => {
              if (legalName.trim().length > 1) void checkDuplicates().catch(() => undefined);
            }}
          />
        </div>
        <div>
          <Label htmlFor="start-mobile" required>
            Mobile number
          </Label>
          <Input
            id="start-mobile"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={mobile}
            disabled={busy}
            onChange={(event) => {
              setMobile(event.target.value.replace(/\D/g, '').slice(0, 10));
              setChecked(false);
            }}
            onBlur={() => {
              if (mobile.length === 10 && legalName.trim())
                void checkDuplicates().catch(() => undefined);
            }}
          />
        </div>
        <div>
          <Label htmlFor="start-pin" required>
            Primary PIN code
          </Label>
          <PinCodeInput
            id="start-pin"
            value={pinCode}
            disabled={busy}
            onChange={(next) => {
              setPinCode(next);
              setChecked(false);
            }}
          />
        </div>
      </section>

      {warnings.length > 0 ? (
        <section className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Possible duplicates</p>
          <ul className="space-y-1">
            {warnings.map((warning) => (
              <li key={`${warning.kind}-${warning.providerId}`}>
                {warning.message}
                {warning.providerCode ? ` (${warning.providerCode})` : ''}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            This is a different provider; create the draft anyway.
          </label>
        </section>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={busy}>
          {warnings.length > 0 ? 'Create anyway' : 'Create draft'}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !valid}
          onClick={() => void checkDuplicates().catch(() => undefined)}
        >
          Check duplicates
        </Button>
        <p className="text-xs text-muted-foreground">
          Duplicate warnings never block a draft; they are shown to the reviewing administrator.
        </p>
      </div>
    </div>
  );
}
