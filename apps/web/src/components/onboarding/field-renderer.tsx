'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { indianStates } from '@curenear/shared';
import type { DocumentRequirement, ProviderField, ProviderType } from '@curenear/shared';
import { api } from '@/lib/api-client';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DocumentUploader } from '@/components/documents/document-uploader';
import { isFieldRequired, isFieldVisible } from './section-values';
import type { DocumentDto, DocumentTypeDto, OrganizationDetailDto } from '@/lib/types';

/** Typed values for one form section: strings, numbers, booleans, arrays, objects. */
export type FieldValue = unknown;

export interface FieldRendererProps {
  field: ProviderField;
  value: FieldValue;
  values: Record<string, unknown>;
  onChange: (value: FieldValue) => void;
  providerType: ProviderType;
  ownerId?: string;
  disabled?: boolean;
  compact?: boolean;
  /** Called after a document is attached to the provider's checklist. */
  onLinked?: () => void | Promise<void>;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function textValue(value: FieldValue): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function ChipInput({
  values,
  onChange,
  disabled,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [entry, setEntry] = useState('');
  const [bulk, setBulk] = useState(false);

  function commit(raw: string): void {
    const parts = raw
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange(Array.from(new Set([...values, ...parts])));
    setEntry('');
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs"
          >
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onChange(values.filter((entryValue) => entryValue !== value))}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {bulk ? (
        <textarea
          className="min-h-24 w-full rounded-md border border-input bg-card p-2 text-sm"
          placeholder="Paste comma, space or newline separated values"
          disabled={disabled}
          onChange={(event) => commit(event.target.value)}
        />
      ) : (
        <Input
          value={entry}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setEntry(event.target.value)}
          onBlur={() => commit(entry)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commit(entry);
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (/[\s,;]/.test(text.trim())) {
              event.preventDefault();
              commit(text);
            }
          }}
        />
      )}
      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => setBulk((open) => !open)}
      >
        {bulk ? 'Add one at a time' : 'Paste a list'}
      </button>
    </div>
  );
}

export function PinCodeInput({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      maxLength={6}
      placeholder="6-digit PIN code"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  );
}

export function AddressInput({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const set = (key: string, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-line1`}>Address line 1</Label>
        <Input
          id={`${idPrefix}-line1`}
          value={textValue(value.line1)}
          disabled={disabled}
          onChange={(event) => set('line1', event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-line2`}>Address line 2</Label>
        <Input
          id={`${idPrefix}-line2`}
          value={textValue(value.line2)}
          disabled={disabled}
          onChange={(event) => set('line2', event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-landmark`}>Landmark</Label>
        <Input
          id={`${idPrefix}-landmark`}
          value={textValue(value.landmark)}
          disabled={disabled}
          onChange={(event) => set('landmark', event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-city`}>City / town</Label>
        <Input
          id={`${idPrefix}-city`}
          value={textValue(value.city)}
          disabled={disabled}
          onChange={(event) => set('city', event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-district`}>District</Label>
        <Input
          id={`${idPrefix}-district`}
          value={textValue(value.district)}
          disabled={disabled}
          onChange={(event) => set('district', event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-state`}>State</Label>
        <Select
          id={`${idPrefix}-state`}
          value={textValue(value.state)}
          disabled={disabled}
          onChange={(event) => set('state', event.target.value)}
        >
          <option value="">Choose a state</option>
          {indianStates.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-pin`}>PIN code</Label>
        <PinCodeInput
          id={`${idPrefix}-pin`}
          value={textValue(value.pin)}
          disabled={disabled}
          onChange={(next) => set('pin', next)}
        />
      </div>
    </div>
  );
}

function GeoInput({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const [locating, setLocating] = useState(false);

  function useDeviceLocation(): void {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          ...value,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idPrefix}-lat`}>Latitude</Label>
          <Input
            id={`${idPrefix}-lat`}
            inputMode="decimal"
            value={textValue(value.lat)}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, lat: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-lng`}>Longitude</Label>
          <Input
            id={`${idPrefix}-lng`}
            inputMode="decimal"
            value={textValue(value.lng)}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, lng: event.target.value })}
          />
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={useDeviceLocation}
        disabled={disabled || locating}
      >
        {locating ? 'Locating…' : 'Use my location'}
      </Button>
    </div>
  );
}

export function OperatingHoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const rowFor = (day: string) => rows.find((row) => row.day === day);

  function update(day: string, patch: Record<string, unknown>): void {
    const existing = rowFor(day);
    const next = existing
      ? rows.map((row) => (row.day === day ? { ...row, ...patch } : row))
      : [...rows, { day, ...patch }];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {DAYS.map((day) => {
        const row = rowFor(day) ?? {};
        return (
          <div key={day} className="grid items-end gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
            <span className="text-sm">{day}</span>
            <div>
              <Label htmlFor={`hours-${day}-open`}>Opens</Label>
              <Input
                id={`hours-${day}-open`}
                type="time"
                value={textValue(row.open)}
                disabled={disabled || row.closed === true}
                onChange={(event) => update(day, { open: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor={`hours-${day}-close`}>Closes</Label>
              <Input
                id={`hours-${day}-close`}
                type="time"
                value={textValue(row.close)}
                disabled={disabled || row.closed === true}
                onChange={(event) => update(day, { close: event.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={row.closed === true}
                disabled={disabled}
                onChange={(event) => update(day, { closed: event.target.checked })}
              />
              Closed
            </label>
          </div>
        );
      })}
    </div>
  );
}

function RepeaterInput({
  field,
  value,
  values,
  onChange,
  providerType,
  disabled,
  ownerId,
  onLinked,
}: {
  field: ProviderField;
  value: unknown;
  values: Record<string, unknown>;
  onChange: (value: unknown) => void;
  providerType: FieldRendererProps['providerType'];
  disabled?: boolean;
  ownerId?: string;
  onLinked?: () => void | Promise<void>;
}) {
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const items = field.items ?? [];

  function updateRow(index: number, key: string, next: unknown): void {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: next } : row)));
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={index} className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Row {index + 1}</p>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
            >
              Remove
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => {
              const synthetic: ProviderField = {
                // A file inside a repeater needs its own document role so two
                // rows do not replace each other's certificate.
                key: item.type === 'file' ? `${field.key}_${index}_${item.key}` : item.key,
                label: item.label,
                type: item.type,
                requirement: item.requirement ?? 'optional',
                section: field.section,
                clause: field.clause,
                storage:
                  item.type === 'file'
                    ? {
                        kind: 'related',
                        table: 'provider_documents',
                        role: `${field.key}_${index}`,
                      }
                    : { kind: 'type_data' },
                validation: item.validation,
                items: item.items,
                help: item.help,
              };
              return (
                <FieldRenderer
                  key={item.key}
                  field={synthetic}
                  value={row[item.key]}
                  values={values}
                  providerType={providerType}
                  ownerId={ownerId}
                  onLinked={onLinked}
                  compact
                  disabled={disabled}
                  onChange={(next) => updateRow(index, item.key, next)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || rows.length >= 100}
        onClick={() => onChange([...rows, {}])}
      >
        Add row
      </Button>
    </div>
  );
}

function FileField({
  field,
  providerType,
  ownerId,
  onLinked,
}: {
  field: ProviderField;
  providerType: FieldRendererProps['providerType'];
  ownerId?: string;
  onLinked?: () => void | Promise<void>;
}) {
  const [types, setTypes] = useState<DocumentTypeDto[]>([]);
  const [typeId, setTypeId] = useState('');
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  async function linkToChecklist(document: DocumentDto): Promise<void> {
    if (!ownerId) return;
    setUploaded(document.fileName);
    setLinkError(null);
    try {
      // The completeness check reads provider_documents.role, so the uploaded
      // file is attached to the requirement it fulfils and older attempts for
      // the same requirement are removed.
      const detail = await api.get<OrganizationDetailDto>(`/api/v1/providers/${ownerId}`);
      const role =
        field.storage.kind === 'related' && field.storage.role ? field.storage.role : field.key;
      for (const old of detail.data.documents) {
        if (old.role === role && !old.deletedAt) {
          await api.delete(`/api/v1/providers/${ownerId}/documents/${old.id}`);
        }
      }
      await api.post(`/api/v1/providers/${ownerId}/documents`, {
        file_name: document.fileName,
        mime_type: document.mimeType,
        size_bytes: document.sizeBytes,
        ...(document.storageKey ? { storage_key: document.storageKey } : {}),
        role,
      });
      await onLinked?.();
    } catch {
      setLinkError('Uploaded, but it could not be attached to the document checklist.');
    }
  }

  useEffect(() => {
    api
      .get<DocumentTypeDto[]>(`/api/v1/master/document-types?providerType=${providerType}`)
      .then((response) => {
        setTypes(response.data);
        const match =
          response.data.find((type) => type.code === field.key) ?? response.data[0] ?? null;
        setTypeId((current) => current || (match?.id ?? ''));
      })
      .catch(() => undefined);
  }, [field.key, providerType]);

  if (!ownerId) {
    return <p className="text-sm text-muted-foreground">Save the draft before uploading files.</p>;
  }

  const documentType = types.find((type) => type.id === typeId);
  const requirement: DocumentRequirement = {
    key: field.key,
    label: field.label,
    requirement: field.requirement,
    section: field.section,
    clause: field.clause,
    conditionNote: field.conditionNote,
  };

  return (
    <div className="space-y-2">
      {types.length > 1 ? (
        <Select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
      ) : null}
      {documentType ? (
        <DocumentUploader
          ownerType="provider_organization"
          ownerId={ownerId}
          requirement={requirement}
          documentType={{
            id: documentType.id,
            code: documentType.code,
            name: documentType.name,
            requiresExpiry: documentType.requiresExpiry,
          }}
          onUploaded={(document) => void linkToChecklist(document)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No document type is available yet.</p>
      )}
      {uploaded ? <p className="text-xs text-emerald-700">Uploaded {uploaded}</p> : null}
      {linkError ? <p className="text-xs text-destructive">{linkError}</p> : null}
    </div>
  );
}

export function FieldRenderer({
  field,
  value,
  values,
  onChange,
  providerType,
  ownerId,
  disabled = false,
  compact = false,
  onLinked,
}: FieldRendererProps) {
  if (!isFieldVisible(field, values, providerType)) return null;

  const required = isFieldRequired(field, values);
  const id = `field-${field.key}`;
  const set = (next: FieldValue) => onChange(next);
  const options = field.validation?.options ?? [];
  let control: ReactNode;

  switch (field.type) {
    case 'textarea':
      control = (
        <textarea
          id={id}
          className="min-h-24 w-full rounded-md border border-input bg-card p-2 text-sm"
          value={textValue(value)}
          disabled={disabled}
          maxLength={field.validation?.maxLength}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case 'select':
      control = (
        <Select
          id={id}
          value={textValue(value)}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        >
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
      break;
    case 'multiselect': {
      const selected = Array.isArray(value) ? value.map(String) : [];
      control = (
        <div className="space-y-1">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                disabled={disabled}
                onChange={(event) =>
                  set(
                    event.target.checked
                      ? [...selected, option]
                      : selected.filter((entry) => entry !== option),
                  )
                }
              />
              {option}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'boolean':
      control = (
        <label htmlFor={id} className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => set(event.target.checked)}
          />
          {field.label}
        </label>
      );
      break;
    case 'number':
      control = (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          value={textValue(value)}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case 'money':
      control = (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">₹</span>
          <Input
            id={id}
            type="number"
            step="0.01"
            min="0"
            value={textValue(value)}
            disabled={disabled}
            onChange={(event) => set(event.target.value)}
          />
        </div>
      );
      break;
    case 'date':
      control = (
        <Input
          id={id}
          type="date"
          value={textValue(value).slice(0, 10)}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case 'time':
      control = (
        <Input
          id={id}
          type="time"
          value={textValue(value)}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case 'phone':
      control = (
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          maxLength={10}
          value={textValue(value)}
          disabled={disabled}
          onChange={(event) => set(event.target.value.replace(/\D/g, '').slice(0, 10))}
        />
      );
      break;
    case 'email':
      control = (
        <Input
          id={id}
          type="email"
          value={textValue(value)}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case 'url':
      control = (
        <Input
          id={id}
          type="url"
          value={textValue(value)}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    case 'pin':
      control = (
        <PinCodeInput
          id={id}
          value={textValue(value)}
          disabled={disabled}
          onChange={(next) => set(next)}
        />
      );
      break;
    case 'pinlist':
      control = (
        <ChipInput
          values={Array.isArray(value) ? value.map(String) : []}
          onChange={(next) => set(next)}
          disabled={disabled}
          placeholder="Type a PIN code and press Enter"
        />
      );
      break;
    case 'address':
      control = (
        <AddressInput
          idPrefix={id}
          value={(value && typeof value === 'object' ? value : {}) as Record<string, unknown>}
          disabled={disabled}
          onChange={(next) => set(next)}
        />
      );
      break;
    case 'geo':
      control = (
        <GeoInput
          idPrefix={id}
          value={(value && typeof value === 'object' ? value : {}) as Record<string, unknown>}
          disabled={disabled}
          onChange={(next) => set(next)}
        />
      );
      break;
    case 'repeater':
      control =
        field.key.endsWith('hours') || field.key.endsWith('_hours') ? (
          <OperatingHoursEditor value={value} onChange={set} disabled={disabled} />
        ) : (
          <RepeaterInput
            field={field}
            value={value}
            values={values}
            onChange={set}
            providerType={providerType}
            disabled={disabled}
            ownerId={ownerId}
            onLinked={onLinked}
          />
        );
      break;
    case 'file':
      control = (
        <FileField
          field={field}
          providerType={providerType}
          ownerId={ownerId}
          onLinked={onLinked}
        />
      );
      break;
    case 'secret':
      control = (
        <Input
          id={id}
          type="password"
          value={textValue(value)}
          disabled={disabled}
          onChange={(event) => set(event.target.value)}
        />
      );
      break;
    default:
      control = (
        <Input
          id={id}
          value={textValue(value)}
          disabled={disabled}
          maxLength={field.validation?.maxLength}
          onChange={(event) => set(event.target.value)}
        />
      );
  }

  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      {field.type === 'boolean' ? null : (
        <Label htmlFor={id} required={required}>
          {field.label}
        </Label>
      )}
      {control}
      {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
      {field.conditionNote && field.requirement === 'conditional' ? (
        <p className="text-xs text-muted-foreground">{field.conditionNote}</p>
      ) : null}
    </div>
  );
}
