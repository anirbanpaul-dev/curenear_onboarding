'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formSectionsFor, type ProviderField } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FieldRenderer } from './field-renderer';
import { isFieldVisible } from './section-values';
import type { SectionEditorProps } from './sections';
import type { DoctorProfileDto } from '@/lib/types';

type LicenceRow = {
  id: string;
  number: string;
  authority: string | null;
  validFrom: string | null;
  validTo: string | null;
  details: Record<string, unknown>;
};

function licenceRole(field: ProviderField): string | null {
  return field.storage.kind === 'related' && field.storage.table === 'provider_licences'
    ? (field.storage.role ?? null)
    : null;
}

export function ClinicEstablishmentSection(props: SectionEditorProps) {
  const provider = props.provider;
  const licences = provider.licences as LicenceRow[];
  const [local, setLocal] = useState<Record<string, unknown>>(() => {
    const values: Record<string, unknown> = { ...provider.organization.typeData };
    for (const field of props.section.fields) {
      if (field.type === 'file') continue;
      const role = licenceRole(field);
      if (!role) continue;
      const licence = licences.find((row) => row.details.role === role);
      if (!licence) continue;
      if (
        field.key === 'clinic_ce_reg_no' ||
        field.key === 'clinic_bmw' ||
        field.key === 'clinic_aerb'
      ) {
        values[field.key] = licence.number;
      }
      if (field.key === 'clinic_ce_authority') values[field.key] = licence.authority ?? '';
      if (field.key === 'clinic_ce_category') {
        values[field.key] =
          typeof licence.details.category === 'string' ? licence.details.category : '';
      }
      if (field.key === 'clinic_ce_from') values[field.key] = licence.validFrom ?? '';
      if (field.key === 'clinic_ce_to') values[field.key] = licence.validTo ?? '';
    }
    return values;
  });
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setLocal({ ...provider.organization.typeData });
  }, [dirty, provider.organization.typeData]);

  const fields = props.section.fields.filter(
    (field) =>
      !field.adminOnly &&
      isFieldVisible(field, { ...props.values, ...local }, provider.organization.providerType),
  );
  const typeDataFields = fields.filter((field) => field.storage.kind === 'type_data');
  const licenceFields = fields.filter((field) => licenceRole(field) !== null);
  const fileFields = fields.filter(
    (field) => field.storage.kind === 'related' && field.storage.table === 'provider_documents',
  );

  async function saveLicences(): Promise<void> {
    const existing = provider.licences as LicenceRow[];
    const roleFields = new Map<string, ProviderField[]>();
    for (const field of licenceFields) {
      const role = licenceRole(field);
      if (!role) continue;
      roleFields.set(role, [...(roleFields.get(role) ?? []), field]);
    }
    for (const [role, group] of roleFields) {
      const current = existing.find((row) => row.details.role === role);
      if (role === 'clinical_establishment' && local.clinic_ce_applicable !== 'yes') {
        if (current) {
          await api.delete(`/api/v1/providers/${provider.organization.id}/licences/${current.id}`);
        }
        continue;
      }
      const primary =
        local.clinic_ce_reg_no ?? local.clinic_bmw ?? local.clinic_aerb ?? current?.number;
      if (typeof primary !== 'string' || primary.trim() === '') continue;
      const payload = {
        number: primary,
        role,
        ...(typeof local.clinic_ce_authority === 'string' && local.clinic_ce_authority
          ? { authority: local.clinic_ce_authority }
          : {}),
        ...(typeof local.clinic_ce_from === 'string' && local.clinic_ce_from
          ? { valid_from: local.clinic_ce_from }
          : {}),
        ...(typeof local.clinic_ce_to === 'string' && local.clinic_ce_to
          ? { valid_to: local.clinic_ce_to }
          : {}),
        details: {
          role,
          ...(typeof local.clinic_ce_category === 'string' && local.clinic_ce_category
            ? { category: local.clinic_ce_category }
            : {}),
        },
        ...(group.length ? {} : {}),
      };
      if (current) {
        await api.patch(
          `/api/v1/providers/${provider.organization.id}/licences/${current.id}`,
          payload,
        );
      } else {
        await api.post(`/api/v1/providers/${provider.organization.id}/licences`, payload);
      }
    }
  }

  async function save(): Promise<void> {
    if (props.disabled || saving) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = {};
      for (const field of typeDataFields) {
        const value = local[field.key];
        if (value === undefined || value === '') continue;
        data[field.key] = value;
      }
      if (Object.keys(data).length > 0) {
        await api.patch(
          `/api/v1/providers/${provider.organization.id}/sections/${props.section.key}`,
          { version: provider.organization.version, data },
        );
      }
      await saveLicences();
      setDirty(false);
      setStatus('Establishment details saved');
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
        <p className="text-xs text-muted-foreground">{props.section.clause}</p>
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
        {fields.map((field) => {
          if (field.type === 'file') {
            return (
              <div key={field.key} className="sm:col-span-2">
                <FieldRenderer
                  field={field}
                  value={undefined}
                  values={{ ...props.values, ...local }}
                  providerType={provider.organization.providerType}
                  ownerId={provider.organization.id}
                  onLinked={props.refresh}
                  disabled={props.disabled}
                  onChange={() => undefined}
                />
              </div>
            );
          }
          if (field.key === 'clinic_incharge') {
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor="clinic-incharge" className="text-sm font-medium">
                  {field.label}
                </label>
                <select
                  id="clinic-incharge"
                  className="w-full rounded-md border border-input bg-card p-2 text-sm"
                  value={String(local[field.key] ?? '')}
                  disabled={props.disabled}
                  onChange={(event) => {
                    setLocal((current) => ({ ...current, [field.key]: event.target.value }));
                    setDirty(true);
                  }}
                >
                  <option value="">Choose a clinic doctor</option>
                  {(provider.clinicDoctors ?? []).map((link) => (
                    <option key={link.doctor.id} value={link.doctor.id}>
                      {link.doctor.fullName} · {link.doctor.registrationNo}
                    </option>
                  ))}
                </select>
                {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
              </div>
            );
          }
          return (
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
                providerType={provider.organization.providerType}
                ownerId={provider.organization.id}
                disabled={props.disabled}
                onLinked={props.refresh}
                onChange={(value) => {
                  setLocal((current) => ({ ...current, [field.key]: value }));
                  setDirty(true);
                }}
              />
            </div>
          );
        })}
      </div>
      {fileFields.length === 0 && licenceFields.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Licence certificates are attached when registration is applicable.
        </p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() => void save()}
        disabled={props.disabled || saving}
      >
        Save establishment details
      </Button>
    </section>
  );
}

function doctorFields(): { identity: ProviderField[]; qualifications: ProviderField[] } {
  const sections = formSectionsFor('doctor');
  const identity = sections.find((section) => section.key === 'doctor_identity')?.fields ?? [];
  const qualifications =
    sections.find((section) => section.key === 'doctor_qualifications')?.fields ?? [];
  const profileOnly = (field: ProviderField) =>
    field.storage.kind === 'related' &&
    field.storage.table === 'doctor_profiles' &&
    field.key !== 'doc_photo';
  const certificate = identity.filter((field) => field.type === 'file');
  return {
    identity: [...identity.filter(profileOnly), ...certificate],
    qualifications: qualifications.filter(profileOnly),
  };
}

function practiceItems(): { timings: ProviderField | null; fee: ProviderField | null } {
  const section = formSectionsFor('doctor').find((row) => row.key === 'doctor_practice');
  const repeater = section?.fields.find((field) => field.type === 'repeater');
  const synthetic = (key: string): ProviderField | null => {
    const item = repeater?.items?.find((entry) => entry.key === key);
    if (!item) return null;
    return {
      key: item.key,
      label: item.label,
      type: item.type,
      requirement: item.requirement ?? 'optional',
      section: repeater?.section ?? 'doctor_practice',
      clause: repeater?.clause ?? '',
      storage: { kind: 'type_data' },
      validation: item.validation,
      items: item.items,
      help: item.help,
    };
  };
  return { timings: synthetic('prac_timings'), fee: synthetic('prac_fee') };
}

export function ClinicDoctorsSection({
  provider,
  section,
  values,
  disabled,
  registerSave,
  registerDirty,
  refresh,
  onError,
  onSaved,
}: SectionEditorProps) {
  const fields = useMemo(doctorFields, []);
  const clinicFields = section.fields.filter((field) => field.key.startsWith('cd_'));
  const { timings, fee } = useMemo(practiceItems, []);
  const [local, setLocal] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState<DoctorProfileDto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const incharge =
    typeof provider.organization.typeData.clinic_incharge === 'string'
      ? provider.organization.typeData.clinic_incharge
      : '';
  const links = provider.clinicDoctors ?? [];

  function update(key: string, value: unknown): void {
    setLocal((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function runSearch(): Promise<void> {
    const registrationNo = String(local.doc_reg_no ?? '').trim();
    if (!registrationNo) return;
    setSearching(true);
    try {
      const params = new URLSearchParams({ registration_no: registrationNo });
      if (typeof local.doc_reg_council === 'string' && local.doc_reg_council) {
        params.set('council', local.doc_reg_council);
      }
      const response = await api.get<DoctorProfileDto[]>(
        `/api/v1/providers/${provider.organization.id}/doctors/search?${params.toString()}`,
      );
      setSearch(response.data);
    } catch (error) {
      onError(error);
    } finally {
      setSearching(false);
    }
  }

  async function saveIncharge(profileId: string): Promise<void> {
    try {
      await api.patch(
        `/api/v1/providers/${provider.organization.id}/sections/clinic_establishment`,
        {
          version: provider.organization.version,
          data: { clinic_incharge: profileId },
        },
      );
      onSaved('clinic_establishment');
      onSaved(section.key);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  function linkPayload(profileId?: string): Record<string, unknown> {
    return {
      ...(profileId ? { doctor_profile_id: profileId } : {}),
      ...(profileId
        ? {}
        : {
            full_name: local.doc_full_name,
            mobile: local.cd_mobile,
            ...(local.cd_email ? { email: local.cd_email } : {}),
            registration_no: local.doc_reg_no,
            council: local.doc_reg_council,
            system_of_medicine: local.doc_system,
            ...(local.doc_specialty ? { specialty: local.doc_specialty } : {}),
            qualifications: Array.isArray(local.doc_qualifications) ? local.doc_qualifications : [],
          }),
      role_at_clinic: local.cd_role,
      timings: Array.isArray(local.prac_timings) ? local.prac_timings : [],
      fee_paise: Math.round(Number(local.prac_fee ?? 0) * 100),
      clinic_attestation: local.cd_clinic_attestation === true,
    };
  }

  async function addDoctor(existingId?: string): Promise<void> {
    if (disabled || saving) return;
    setSaving(true);
    try {
      await api.post(
        `/api/v1/providers/${provider.organization.id}/doctors`,
        linkPayload(existingId),
      );
      setLocal({});
      setSearch(null);
      setDirty(false);
      setStatus(existingId ? 'Existing doctor linked' : 'Doctor added and invited');
      onSaved(section.key);
      await refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'CONFLICT') {
        const details = error.details as { existingDoctor?: DoctorProfileDto } | undefined;
        if (details?.existingDoctor) {
          setSearch([details.existingDoctor]);
          setStatus('This doctor already exists. Link the existing profile instead.');
        } else {
          onError(error);
        }
      } else {
        onError(error);
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(linkId: string): Promise<void> {
    try {
      await api.delete(`/api/v1/providers/${provider.organization.id}/doctors/${linkId}`);
      onSaved(section.key);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  const saveRef = useRef(async () => undefined);
  saveRef.current = async () => {
    if (incharge) await saveIncharge(incharge);
  };
  useEffect(() => {
    registerSave(section.key, () => saveRef.current());
  }, [registerSave, section.key]);
  useEffect(() => {
    registerDirty(section.key, dirty);
  }, [dirty, registerDirty, section.key]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Doctors</h2>
        <p className="text-xs text-muted-foreground">
          {section.clause} · The doctor confirms consent and declarations before publication.
        </p>
      </div>
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      <div className="space-y-2">
        {links.map((link) => (
          <div
            key={link.link.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {link.doctor.fullName} · {link.doctor.registrationNo}
              </p>
              <p className="text-xs text-muted-foreground">
                {link.doctor.councilName ?? 'Council not set'} ·{' '}
                {link.link.roleAtClinic ?? 'role not set'} · ₹{(link.link.feePaise ?? 0) / 100} ·{' '}
                {link.doctor.status.replace('_', ' ')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="clinic-incharge"
                  checked={incharge === link.doctor.id}
                  disabled={disabled}
                  onChange={() => void saveIncharge(link.doctor.id)}
                />
                In-charge
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => remove(link.link.id)}
              >
                Remove link
              </Button>
            </div>
          </div>
        ))}
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add at least one doctor before submitting.
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
        <p className="text-sm font-medium">Add a doctor</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[...fields.identity, ...fields.qualifications].map((field) => {
            // Each doctor needs its own certificate role; otherwise the second
            // doctor's upload would replace the first one's document.
            const rendered =
              field.type === 'file'
                ? {
                    ...field,
                    storage: {
                      kind: 'related' as const,
                      table: 'provider_documents' as const,
                      role: `clinic_doctor_${field.key}_${String(local.doc_reg_no ?? 'new')}`,
                    },
                  }
                : field;
            return (
              <div key={field.key} className={field.type === 'repeater' ? 'sm:col-span-2' : ''}>
                <FieldRenderer
                  field={rendered}
                  value={local[field.key]}
                  values={{ ...values, ...local }}
                  providerType={provider.organization.providerType}
                  ownerId={provider.organization.id}
                  disabled={disabled}
                  onLinked={refresh}
                  onChange={(value) => update(field.key, value)}
                />
              </div>
            );
          })}
          {clinicFields.map((field) => (
            <div key={field.key}>
              <FieldRenderer
                field={field}
                value={local[field.key]}
                values={{ ...values, ...local }}
                providerType={provider.organization.providerType}
                disabled={disabled}
                onChange={(value) => update(field.key, value)}
              />
            </div>
          ))}
          {timings ? (
            <div className="sm:col-span-2">
              <FieldRenderer
                field={timings}
                value={local.prac_timings}
                values={{ ...values, ...local }}
                providerType={provider.organization.providerType}
                disabled={disabled}
                onChange={(value) => update('prac_timings', value)}
              />
            </div>
          ) : null}
          {fee ? (
            <FieldRenderer
              field={fee}
              value={local.prac_fee}
              values={{ ...values, ...local }}
              providerType={provider.organization.providerType}
              disabled={disabled}
              onChange={(value) => update('prac_fee', value)}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runSearch()}
            disabled={disabled || searching || !local.doc_reg_no}
          >
            {searching ? 'Searching…' : 'Search existing doctors'}
          </Button>
          {search && search.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              <span>
                Match: {search[0]?.fullName} ({search[0]?.registrationNo},{' '}
                {search[0]?.councilName ?? 'no council'})
              </span>
              <Button
                size="sm"
                onClick={() => void addDoctor(search[0]?.id)}
                disabled={disabled || saving || local.cd_clinic_attestation !== true}
              >
                Link existing doctor
              </Button>
            </div>
          ) : search && search.length === 0 ? (
            <p className="text-xs text-muted-foreground">No existing doctor found.</p>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={() => void addDoctor()}
          disabled={
            disabled ||
            saving ||
            Boolean(search && search.length > 0) ||
            local.cd_clinic_attestation !== true ||
            !local.doc_full_name ||
            !local.cd_mobile ||
            !local.doc_reg_no ||
            !local.doc_system ||
            !local.cd_role ||
            !local.prac_fee ||
            !Array.isArray(local.prac_timings) ||
            local.prac_timings.length === 0
          }
        >
          Add doctor
        </Button>
        {search && search.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            A matching registration and council must be linked, not duplicated.
          </p>
        ) : null}
      </div>
    </section>
  );
}
