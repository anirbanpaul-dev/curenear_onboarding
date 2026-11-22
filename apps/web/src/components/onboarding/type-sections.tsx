'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProviderField, TestCatalogueImportReport } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DocumentUploader,
  type DocumentTypeOption,
} from '@/components/documents/document-uploader';
import type { SectionEditorProps } from './sections';
import type { DocumentTypeDto, OrganizationDetailDto } from '@/lib/types';

/**
 * Editors for the type-specific relations that do not fit a `type_data` field:
 * licence rows (`provider_licences`), coverage PINs (`provider_service_pins`)
 * and the diagnostic test-catalogue import. `sections.tsx` composes them with
 * the generic renderer so every provider type keeps one form.
 */

interface LicenceRow {
  id: string;
  number: string;
  authority: string | null;
  issuedOn?: string | null;
  validFrom: string | null;
  validTo: string | null;
  documentId?: string | null;
  details: Record<string, unknown>;
}

const sliceDate = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.slice(0, 10) : '';

function licenceRows(provider: OrganizationDetailDto): LicenceRow[] {
  return (provider.licences ?? []) as LicenceRow[];
}

function licenceRole(field: ProviderField): string | null {
  return field.storage.kind === 'related' && field.storage.table === 'provider_licences'
    ? (field.storage.role ?? null)
    : null;
}

function itemValue(row: LicenceRow, itemKey: string): unknown {
  switch (itemKey) {
    case 'number':
      return row.number;
    case 'authority':
      return row.authority ?? '';
    case 'issue_date':
      return sliceDate(row.issuedOn);
    case 'valid_from':
      return sliceDate(row.validFrom);
    case 'valid_to':
      return sliceDate(row.validTo);
    default:
      return row.details[itemKey] ?? '';
  }
}

interface LicenceDraft {
  id?: string;
  values: Record<string, unknown>;
  documentId: string | null;
  documentName: string | null;
}

function draftFromRow(field: ProviderField, row: LicenceRow): LicenceDraft {
  const values: Record<string, unknown> = {};
  for (const item of field.items ?? []) {
    if (item.type === 'file') continue;
    values[item.key] = itemValue(row, item.key);
  }
  return {
    id: row.id,
    values,
    documentId: row.documentId ?? null,
    documentName: row.documentId ? 'Certificate attached' : null,
  };
}

function emptyDraft(field: ProviderField): LicenceDraft {
  const values: Record<string, unknown> = {};
  for (const item of field.items ?? []) {
    if (item.type === 'file') continue;
    values[item.key] = item.type === 'boolean' ? false : '';
  }
  return { values, documentId: null, documentName: null };
}

function LicenceDocumentUpload({
  provider,
  field,
  label,
  documentId,
  disabled,
  onUploaded,
}: {
  provider: OrganizationDetailDto;
  field: ProviderField;
  label: string;
  documentId: string | null;
  disabled?: boolean;
  onUploaded: (documentId: string, fileName: string) => void;
}) {
  const [types, setTypes] = useState<DocumentTypeDto[]>([]);

  useEffect(() => {
    api
      .get<DocumentTypeDto[]>(
        `/api/v1/master/document-types?providerType=${provider.organization.providerType}`,
      )
      .then((response) => setTypes(response.data))
      .catch(() => undefined);
  }, [provider.organization.providerType]);

  const documentType: DocumentTypeOption | null = types[0]
    ? {
        id: types[0].id,
        code: types[0].code,
        name: types[0].name,
        requiresExpiry: types[0].requiresExpiry,
      }
    : null;

  if (!documentType) {
    return <p className="text-xs text-muted-foreground">Document types are loading…</p>;
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {documentId ? (
        <p className="text-xs text-emerald-700">Certificate attached</p>
      ) : (
        <p className="text-xs text-muted-foreground">Attach the certificate or licence copy.</p>
      )}
      <DocumentUploader
        ownerType="provider_organization"
        ownerId={provider.organization.id}
        requirement={{
          key: `${field.key}_document`,
          label,
          requirement: 'conditional',
          section: field.section,
          clause: field.clause,
        }}
        documentType={documentType}
        onUploaded={(document) => onUploaded(document.id, document.fileName)}
      />
      {disabled ? <p className="text-xs text-muted-foreground">Read-only.</p> : null}
    </div>
  );
}

/** One registry licence repeater (drug licences, establishment, AERB, ...). */
export function LicenceFieldsSection({
  fieldKeys,
  ...props
}: SectionEditorProps & { fieldKeys: string[] }) {
  const provider = props.provider;
  const fields = props.section.fields.filter(
    (field) => fieldKeys.includes(field.key) && licenceRole(field) !== null,
  );
  const [drafts, setDrafts] = useState<Record<string, LicenceDraft[]>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = licenceRows(provider);

  function draftsFor(field: ProviderField): LicenceDraft[] {
    if (drafts[field.key]) return drafts[field.key] as LicenceDraft[];
    const role = licenceRole(field);
    return rows.filter((row) => row.details.role === role).map((row) => draftFromRow(field, row));
  }

  function setDraftsFor(field: ProviderField, next: LicenceDraft[]): void {
    setDrafts((current) => ({ ...current, [field.key]: next }));
    props.registerDirty(props.section.key, true);
  }

  function updateDraft(field: ProviderField, index: number, patch: Partial<LicenceDraft>): void {
    const current = draftsFor(field);
    setDraftsFor(
      field,
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)),
    );
  }

  async function save(): Promise<void> {
    if (props.disabled || saving) return;
    setSaving(true);
    try {
      for (const field of fields) {
        const role = licenceRole(field);
        if (!role) continue;
        for (const draft of draftsFor(field)) {
          const number = String(draft.values.number ?? '').trim();
          if (!number) continue;
          const extras: Record<string, unknown> = {};
          for (const item of field.items ?? []) {
            if (item.type === 'file' || item.key === 'number' || item.key === 'authority') continue;
            if (item.key === 'valid_to' || item.key === 'valid_from' || item.key === 'issue_date') {
              continue;
            }
            const value = draft.values[item.key];
            if (value === undefined || value === '') continue;
            extras[item.key] = value;
          }
          const payload = {
            role,
            number,
            ...(typeof draft.values.authority === 'string' && draft.values.authority
              ? { authority: draft.values.authority }
              : {}),
            ...(typeof draft.values.issue_date === 'string' && draft.values.issue_date
              ? { issued_on: draft.values.issue_date }
              : {}),
            ...(typeof draft.values.valid_from === 'string' && draft.values.valid_from
              ? { valid_from: draft.values.valid_from }
              : {}),
            ...(typeof draft.values.valid_to === 'string' && draft.values.valid_to
              ? { valid_to: draft.values.valid_to }
              : {}),
            ...(draft.documentId ? { document_id: draft.documentId } : {}),
            details: { role, ...extras },
          };
          if (draft.id) {
            await api.patch(
              `/api/v1/providers/${provider.organization.id}/licences/${draft.id}`,
              payload,
            );
          } else {
            await api.post(`/api/v1/providers/${provider.organization.id}/licences`, payload);
          }
        }
      }
      setDrafts({});
      props.registerDirty(props.section.key, false);
      setStatus('Licences saved');
      props.onSaved(props.section.key);
      await props.refresh();
    } catch (error) {
      props.onError(error);
    } finally {
      setSaving(false);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  const registerSectionSave = props.registerSave;
  const sectionKey = props.section.key;
  useEffect(() => {
    registerSectionSave(sectionKey, () => saveRef.current());
  }, [registerSectionSave, sectionKey]);
  useEffect(() => {
    if (!drafts || Object.keys(drafts).length === 0) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [drafts]);

  async function remove(field: ProviderField, row: LicenceRow): Promise<void> {
    try {
      await api.delete(`/api/v1/providers/${provider.organization.id}/licences/${row.id}`);
      setDrafts((current) => ({ ...current, [field.key]: [] }));
      await props.refresh();
    } catch (error) {
      props.onError(error);
    }
  }

  return (
    <div className="space-y-6">
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      {fields.map((field) => {
        const role = licenceRole(field);
        const existing = rows.filter((row) => row.details.role === role);
        const current = draftsFor(field);
        return (
          <div key={field.key} className="space-y-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{field.label}</p>
              {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
            </div>
            {existing.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-2 text-sm"
              >
                <span>
                  {row.number}
                  {row.authority ? ` · ${row.authority}` : ''}
                  {row.validTo ? ` · valid to ${sliceDate(row.validTo)}` : ''}
                  {row.documentId ? ' · certificate attached' : ' · no certificate'}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={props.disabled}
                    onClick={() =>
                      setDraftsFor(field, [
                        ...current.filter((draft) => draft.id !== row.id),
                        draftFromRow(field, row),
                      ])
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={props.disabled}
                    onClick={() => void remove(field, row)}
                  >
                    Remove
                  </Button>
                </span>
              </div>
            ))}
            {current.map((draft, index) => (
              <div
                key={`${field.key}-${draft.id ?? index}`}
                className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2"
              >
                {(field.items ?? [])
                  .filter((item) => item.type !== 'file')
                  .map((item) => {
                    const id = `${field.key}-${index}-${item.key}`;
                    const value = draft.values[item.key];
                    return (
                      <div
                        key={item.key}
                        className={item.type === 'textarea' ? 'sm:col-span-2' : ''}
                      >
                        <Label htmlFor={id}>{item.label}</Label>
                        {item.validation?.options && item.validation.options.length > 0 ? (
                          <Select
                            id={id}
                            value={typeof value === 'string' ? value : ''}
                            disabled={props.disabled}
                            onChange={(event) =>
                              updateDraft(field, index, {
                                values: { ...draft.values, [item.key]: event.target.value },
                              })
                            }
                          >
                            <option value="">Choose…</option>
                            {item.validation.options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </Select>
                        ) : item.type === 'boolean' ? (
                          <input
                            id={id}
                            type="checkbox"
                            checked={value === true}
                            disabled={props.disabled}
                            onChange={(event) =>
                              updateDraft(field, index, {
                                values: { ...draft.values, [item.key]: event.target.checked },
                              })
                            }
                          />
                        ) : (
                          <Input
                            id={id}
                            type={item.type === 'date' ? 'date' : 'text'}
                            value={typeof value === 'string' ? value : ''}
                            disabled={props.disabled}
                            onChange={(event) =>
                              updateDraft(field, index, {
                                values: { ...draft.values, [item.key]: event.target.value },
                              })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                {(field.items ?? []).some((item) => item.type === 'file') ? (
                  <div className="sm:col-span-2">
                    <LicenceDocumentUpload
                      provider={provider}
                      field={field}
                      label="Licence certificate"
                      documentId={draft.documentId}
                      disabled={props.disabled}
                      onUploaded={(documentId, fileName) =>
                        updateDraft(field, index, { documentId, documentName: fileName })
                      }
                    />
                  </div>
                ) : null}
                <div className="flex gap-2 sm:col-span-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraftsFor(
                        field,
                        current.filter((_, draftIndex) => draftIndex !== index),
                      )
                    }
                  >
                    Discard
                  </Button>
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={props.disabled}
              onClick={() => setDraftsFor(field, [...current, emptyDraft(field)])}
            >
              Add {field.label.toLowerCase()}
            </Button>
          </div>
        );
      })}
      <Button size="sm" onClick={() => void save()} disabled={props.disabled || saving}>
        Save licences
      </Button>
    </div>
  );
}

/**
 * Text licence fields kept in a licence row (`dc_bmw`, `dc_pcpndt`, `ph_fssai`):
 * one number plus an optional certificate.
 */
export function SingleLicenceFields({
  fieldKeys,
  ...props
}: SectionEditorProps & { fieldKeys: string[] }) {
  const provider = props.provider;
  const fields = props.section.fields.filter(
    (field) => fieldKeys.includes(field.key) && licenceRole(field) !== null,
  );
  const rows = licenceRows(provider);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      const role = licenceRole(field);
      const row = rows.find((entry) => entry.details.role === role);
      initial[field.key] = row?.number ?? '';
    }
    return initial;
  });
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (props.disabled) return;
    try {
      for (const field of fields) {
        const role = licenceRole(field);
        const value = values[field.key]?.trim();
        if (!role || !value) continue;
        const existing = rows.find((row) => row.details.role === role);
        const documentId = documents[field.key] ?? existing?.documentId ?? null;
        const payload = {
          role,
          number: value,
          ...(documentId ? { document_id: documentId } : {}),
          details: { role },
        };
        if (existing) {
          await api.patch(
            `/api/v1/providers/${provider.organization.id}/licences/${existing.id}`,
            payload,
          );
        } else {
          await api.post(`/api/v1/providers/${provider.organization.id}/licences`, payload);
        }
      }
      setStatus('Licence saved');
      props.onSaved(props.section.key);
      await props.refresh();
    } catch (error) {
      props.onError(error);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  const registerSectionSave = props.registerSave;
  const sectionKey = props.section.key;
  useEffect(() => {
    registerSectionSave(sectionKey, () => saveRef.current());
  }, [registerSectionSave, sectionKey]);
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      {fields.map((field) => {
        const role = licenceRole(field);
        const existing = rows.find((row) => row.details.role === role);
        return (
          <div key={field.key} className="space-y-2 rounded-md border p-3">
            <Label htmlFor={`field-${field.key}`} required={field.requirement === 'required'}>
              {field.label}
            </Label>
            <Input
              id={`field-${field.key}`}
              value={values[field.key] ?? ''}
              disabled={props.disabled}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
            <LicenceDocumentUpload
              provider={provider}
              field={field}
              label="Licence certificate"
              documentId={documents[field.key] ?? existing?.documentId ?? null}
              disabled={props.disabled}
              onUploaded={(documentId) =>
                setDocuments((current) => ({ ...current, [field.key]: documentId }))
              }
            />
          </div>
        );
      })}
      <Button size="sm" variant="outline" onClick={() => void save()} disabled={props.disabled}>
        Save licence
      </Button>
    </div>
  );
}

/** Coverage PIN list for a service kind (`delivery`, `collection`). */
export function ServicePinField({
  provider,
  serviceKind,
  label,
  disabled,
  refresh,
  onError,
}: {
  provider: OrganizationDetailDto;
  serviceKind: string;
  label: string;
  disabled: boolean;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [entry, setEntry] = useState('');
  const pins = provider.servicePins.filter((pin) => pin.serviceKind === serviceKind);

  async function addPins(): Promise<void> {
    const codes = entry
      .split(/[\s,;]+/)
      .map((code) => code.trim())
      .filter((code) => /^\d{6}$/.test(code));
    if (codes.length === 0) return;
    try {
      for (const code of codes) {
        await api.post(`/api/v1/providers/${provider.organization.id}/service-pins`, {
          pin_code: code,
          service_kind: serviceKind,
        });
      }
      setEntry('');
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  async function removePin(id: string): Promise<void> {
    try {
      await api.delete(`/api/v1/providers/${provider.organization.id}/service-pins/${id}`);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1">
        {pins.map((pin) => (
          <span
            key={pin.id}
            className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs"
          >
            {pin.pinCode}
            <button
              type="button"
              aria-label={`Remove ${pin.pinCode}`}
              className="text-muted-foreground hover:text-destructive"
              disabled={disabled}
              onClick={() => void removePin(pin.id)}
            >
              ×
            </button>
          </span>
        ))}
        {pins.length === 0 ? (
          <span className="text-xs text-muted-foreground">No PIN codes yet.</span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Input
          value={entry}
          placeholder="Paste 6-digit PIN codes, separated by spaces or commas"
          disabled={disabled}
          onChange={(event) => setEntry(event.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void addPins()}
          disabled={disabled || entry.trim() === ''}
        >
          Add PINs
        </Button>
      </div>
    </div>
  );
}

/** Bulk CSV upload with the server's row-level report (field-spec 8.3). */
export function TestCatalogueImport({
  provider,
  disabled,
  refresh,
  onError,
}: {
  provider: OrganizationDetailDto;
  disabled: boolean;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [report, setReport] = useState<TestCatalogueImportReport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function downloadTemplate(): Promise<void> {
    try {
      const response = await api.get<{ fileName: string; csv: string }>(
        `/api/v1/providers/${provider.organization.id}/tests/template`,
      );
      const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.data.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(error);
    }
  }

  async function upload(file: File | undefined): Promise<void> {
    if (!file || disabled) return;
    setBusy(true);
    setStatus(null);
    try {
      const csv = await file.text();
      const response = await api.post<{ report: TestCatalogueImportReport; version: number }>(
        `/api/v1/providers/${provider.organization.id}/tests/import`,
        { csv, version: provider.organization.version },
      );
      setReport(response.data.report);
      setStatus(
        `Imported ${response.data.report.counts.imported + response.data.report.counts.flagged} of ${
          response.data.report.rows.length
        } rows`,
      );
      await refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        const details = error.details as { report?: TestCatalogueImportReport } | undefined;
        if (details?.report) setReport(details.report);
      }
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Bulk import</p>
        <p className="text-xs text-muted-foreground">
          Upload a CSV of tests. Every row is validated; sex-determination tests are refused and
          prenatal items are flagged for admin review.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void downloadTemplate()}>
          Download CSV template
        </Button>
        <label className="text-sm">
          <span className="sr-only">Import test catalogue CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Import test catalogue CSV"
            disabled={disabled || busy}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
        </label>
        {busy ? <span className="text-xs text-muted-foreground">Importing…</span> : null}
      </div>
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      {report ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Row</th>
                <th className="px-2 py-1">Test</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Details</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.row} className="border-t">
                  <td className="px-2 py-1">{row.row}</td>
                  <td className="px-2 py-1">{row.testName ?? '—'}</td>
                  <td className="px-2 py-1">{row.status}</td>
                  <td className="px-2 py-1 text-xs text-muted-foreground">
                    {[...row.issues.map((issue) => issue.message), ...row.flags].join('; ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.counts.imported} imported · {report.counts.flagged} flagged ·{' '}
            {report.counts.invalid} invalid · {report.counts.blocked} blocked
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Premises pointer: the licensed address is the provider's primary location. */
export function PrimaryLocationSummary({ provider }: { provider: OrganizationDetailDto }) {
  const primary = provider.locations.find((row) => row.isPrimary) ?? null;
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">Licensed premises</p>
      {primary ? (
        <p className="text-xs text-muted-foreground">
          {primary.addressLine1}, {primary.city} {primary.pinCode} — edit it under Locations so it
          stays one address.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Add the primary location first; the licence must match it.
        </p>
      )}
    </div>
  );
}
