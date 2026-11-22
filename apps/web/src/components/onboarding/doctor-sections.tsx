'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProviderField } from '@curenear/shared';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FieldRenderer } from './field-renderer';
import { isFieldVisible } from './section-values';
import type { SectionEditorProps } from './sections';
import type { DoctorPracticeDto, OrganizationDetailDto, OrganizationDto } from '@/lib/types';

function doctorFieldValues(
  provider: OrganizationDetailDto,
  section: SectionEditorProps['section'],
  licence: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const profile = provider.doctorProfile ?? null;
  const values: Record<string, unknown> = {};
  for (const field of section.fields) {
    if (field.storage.kind === 'related') {
      if (field.storage.table === 'doctor_profiles') {
        const fallback = provider.organization.typeData[field.key];
        if (field.key === 'doc_full_name') values[field.key] = profile?.fullName ?? fallback ?? '';
        if (field.key === 'doc_reg_no') {
          values[field.key] = profile?.registrationNo ?? fallback ?? '';
        }
        if (field.key === 'doc_reg_council') {
          values[field.key] = profile?.councilName ?? fallback ?? '';
        }
        if (field.key === 'doc_system') {
          values[field.key] = profile?.systemOfMedicine ?? fallback ?? '';
        }
        if (field.key === 'doc_specialty') {
          values[field.key] = profile?.specialtyName ?? fallback ?? '';
        }
        if (field.key === 'doc_qualifications') {
          values[field.key] = profile?.qualifications ?? fallback ?? [];
        }
      }
      if (field.storage.table === 'provider_licences' && licence) {
        if (field.key === 'doc_reg_date') values[field.key] = licence.validFrom;
        if (field.key === 'doc_reg_valid_to') values[field.key] = licence.validTo;
      }
      continue;
    }
    values[field.key] =
      field.storage.kind === 'type_data' ? provider.organization.typeData[field.key] : undefined;
  }
  return values;
}

function DoctorSection({
  mode,
  ...props
}: SectionEditorProps & { mode: 'identity' | 'qualifications' }) {
  const licence = (props.provider.licences as Array<Record<string, unknown>>).find(
    (row) => (row.details as Record<string, unknown> | undefined)?.role === 'medical_registration',
  );
  const [local, setLocal] = useState<Record<string, unknown>>(() =>
    doctorFieldValues(props.provider, props.section, licence),
  );
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setLocal(doctorFieldValues(props.provider, props.section, licence));
  }, [dirty, licence, props.provider, props.section]);

  const fields = props.section.fields.filter(
    (field) =>
      !field.adminOnly &&
      isFieldVisible(
        field,
        { ...props.values, ...local },
        props.provider.organization.providerType,
      ),
  );
  const payload = () => {
    const data: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === 'file') continue;
      const value = local[field.key];
      if (value === undefined || value === '') continue;
      data[field.key] = value;
    }
    return data;
  };

  async function save(): Promise<void> {
    if (props.disabled || saving) return;
    setSaving(true);
    try {
      await api.patch(`/api/v1/providers/${props.provider.organization.id}/doctor-profile`, {
        version: props.provider.organization.version,
        section: mode === 'identity' ? 'doctor_identity' : 'doctor_qualifications',
        data: payload(),
      });
      setDirty(false);
      setStatus('Doctor details saved');
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
  const registerSectionDirty = props.registerDirty;
  const sectionKey = props.section.key;
  useEffect(() => {
    registerSectionSave(sectionKey, () => saveRef.current());
  }, [registerSectionSave, sectionKey]);
  useEffect(() => {
    registerSectionDirty(sectionKey, dirty);
  }, [dirty, registerSectionDirty, sectionKey]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [dirty]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{props.section.title}</h2>
        <p className="text-xs text-muted-foreground">
          {props.section.clause}
          {props.section.description ? ` · ${props.section.description}` : ''}
        </p>
      </div>
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      <div
        className="grid gap-4 sm:grid-cols-2"
        onBlur={() => {
          if (dirty) void saveRef.current();
        }}
      >
        {fields.map((field) => (
          <div
            key={field.key}
            className={
              field.type === 'textarea' || field.type === 'repeater' ? 'sm:col-span-2' : ''
            }
          >
            <FieldRenderer
              field={field}
              value={local[field.key]}
              values={{ ...props.values, ...local }}
              providerType={props.provider.organization.providerType}
              ownerId={props.provider.organization.id}
              disabled={props.disabled}
              onLinked={props.refresh}
              onChange={(value) => {
                setLocal((current) => ({ ...current, [field.key]: value }));
                setDirty(true);
              }}
            />
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void save()}
        disabled={props.disabled || saving}
      >
        Save doctor details
      </Button>
      {!props.provider.doctorProfile ? (
        <p className="text-xs text-muted-foreground">
          Add the doctor identity once; the profile row is created on first save.
        </p>
      ) : null}
    </section>
  );
}

export function DoctorIdentitySection(props: SectionEditorProps) {
  return <DoctorSection {...props} mode="identity" />;
}

export function DoctorQualificationsSection(props: SectionEditorProps) {
  return <DoctorSection {...props} mode="qualifications" />;
}

type PracticeItem = NonNullable<ProviderField['items']>[number];

function initialPracticeValues(
  practice: DoctorPracticeDto,
  items: readonly PracticeItem[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const item of items) {
    if (item.key === 'prac_type') values[item.key] = practice.practiceType ?? '';
    if (item.key === 'prac_clinic_id') values[item.key] = practice.clinicOrganizationId ?? '';
    if (item.key === 'prac_location') values[item.key] = practice.address ?? {};
    if (item.key === 'prac_timings') values[item.key] = practice.timings;
    if (item.key === 'prac_fee')
      values[item.key] = practice.feePaise == null ? '' : practice.feePaise / 100;
    if (item.key === 'prac_contact') values[item.key] = practice.publicContact ?? '';
  }
  return values;
}

function emptyPractice(items: readonly PracticeItem[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const item of items) {
    values[item.key] = item.type === 'repeater' || item.type === 'address' ? undefined : '';
  }
  return values;
}

export function DoctorPracticeSection(props: SectionEditorProps) {
  const repeater = props.section.fields.find((field) => field.type === 'repeater');
  const items = repeater?.items ?? [];
  const practices = props.provider.doctorPractices ?? [];
  const [draft, setDraft] = useState<{ id?: string; values: Record<string, unknown> } | null>(null);
  const [clinics, setClinics] = useState<OrganizationDto[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api
      .get<OrganizationDto[]>('/api/v1/providers')
      .then((response) =>
        setClinics(response.data.filter((row) => row.providerType === 'clinic' && !row.deletedAt)),
      )
      .catch(() => undefined);
  }, []);

  function update(key: string, value: unknown): void {
    setDraft((current) =>
      current ? { ...current, values: { ...current.values, [key]: value } } : current,
    );
    setDirty(true);
  }

  async function save(): Promise<void> {
    if (!draft || props.disabled) return;
    const value = draft.values;
    if (!value.prac_type || !value.prac_location || !value.prac_contact || !value.prac_fee) return;
    const fee = Number(value.prac_fee);
    if (!Number.isFinite(fee)) return;
    const payload = {
      practice_type: String(value.prac_type),
      ...(typeof value.prac_clinic_id === 'string' && value.prac_clinic_id
        ? { clinic_organization_id: value.prac_clinic_id }
        : {}),
      address: value.prac_location,
      timings: Array.isArray(value.prac_timings) ? value.prac_timings : [],
      fee_paise: Math.round(fee * 100),
      public_contact: String(value.prac_contact),
    };
    if (!Array.isArray(payload.timings) || payload.timings.length === 0) return;
    try {
      if (draft.id) {
        await api.patch(
          `/api/v1/providers/${props.provider.organization.id}/doctor-practices/${draft.id}`,
          payload,
        );
      } else {
        await api.post(`/api/v1/providers/${props.provider.organization.id}/doctor-practices`, {
          ...payload,
          version: props.provider.organization.version,
        });
      }
      setDraft(null);
      setDirty(false);
      setStatus('Practice location saved');
      props.onSaved(props.section.key);
      await props.refresh();
    } catch (error) {
      props.onError(error);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  const registerSectionSave = props.registerSave;
  const registerSectionDirty = props.registerDirty;
  const sectionKey = props.section.key;
  useEffect(() => {
    registerSectionSave(sectionKey, () => saveRef.current());
  }, [registerSectionSave, sectionKey]);
  useEffect(() => {
    registerSectionDirty(sectionKey, dirty);
  }, [dirty, registerSectionDirty, sectionKey]);

  async function remove(id: string): Promise<void> {
    try {
      await api.delete(
        `/api/v1/providers/${props.provider.organization.id}/doctor-practices/${id}`,
      );
      await props.refresh();
    } catch (error) {
      props.onError(error);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{props.section.title}</h2>
        <p className="text-xs text-muted-foreground">{props.section.clause}</p>
      </div>
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      {practices.map((practice) => (
        <div
          key={practice.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
        >
          <div>
            <p className="font-medium">
              {practice.practiceType} · {practice.publicContact}
            </p>
            <p className="text-xs text-muted-foreground">
              {String(practice.address?.city ?? '')} {String(practice.address?.pin ?? '')} · ₹
              {practice.feePaise == null ? '—' : practice.feePaise / 100}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={props.disabled}
              onClick={() =>
                setDraft({ id: practice.id, values: initialPracticeValues(practice, items) })
              }
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.disabled}
              onClick={() => remove(practice.id)}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      {draft ? (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => {
              if (item.key === 'prac_clinic_id') {
                return (
                  <div key={item.key} className="space-y-1">
                    <label htmlFor={`practice-${item.key}`} className="text-sm font-medium">
                      {item.label}
                    </label>
                    <select
                      id={`practice-${item.key}`}
                      className="w-full rounded-md border border-input bg-card p-2 text-sm"
                      value={String(draft.values[item.key] ?? '')}
                      disabled={props.disabled}
                      onChange={(event) => update(item.key, event.target.value)}
                    >
                      <option value="">Not linked</option>
                      {clinics.map((clinic) => (
                        <option key={clinic.id} value={clinic.id}>
                          {clinic.legalName ?? clinic.code}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (item.type === 'file') return null;
              const synthetic: ProviderField = {
                key: item.key,
                label: item.label,
                type: item.type,
                requirement: item.requirement ?? 'optional',
                section: repeater?.section ?? props.section.key,
                clause: repeater?.clause ?? props.section.clause,
                storage: { kind: 'type_data' },
                validation: item.validation,
                items: item.items,
                help: item.help,
                conditionNote: item.conditionNote,
              };
              return (
                <div
                  key={item.key}
                  className={
                    item.type === 'address' || item.type === 'repeater' ? 'sm:col-span-2' : ''
                  }
                >
                  <FieldRenderer
                    field={synthetic}
                    value={draft.values[item.key]}
                    values={{ ...props.values, ...draft.values }}
                    providerType={props.provider.organization.providerType}
                    disabled={props.disabled}
                    onChange={(value) => update(item.key, value)}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={props.disabled}>
              Save practice
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setDirty(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled || !props.provider.doctorProfile}
          onClick={() => setDraft({ values: emptyPractice(items) })}
        >
          Add practice location
        </Button>
      )}
      {!props.provider.doctorProfile ? (
        <p className="text-xs text-muted-foreground">
          Save the doctor identity before adding practices.
        </p>
      ) : null}
    </section>
  );
}
