'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { locationTypes, type ProviderField, type ProviderSection } from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressInput, FieldRenderer, OperatingHoursEditor, PinCodeInput } from './field-renderer';
import {
  DoctorIdentitySection,
  DoctorPracticeSection,
  DoctorQualificationsSection,
} from './doctor-sections';
import { ClinicEstablishmentSection } from './clinic-sections';
import {
  LicenceFieldsSection,
  PrimaryLocationSummary,
  ServicePinField,
  SingleLicenceFields,
  TestCatalogueImport,
} from './type-sections';
import {
  allSectionValues,
  initialSectionValues,
  isFieldVisible,
  visibleSectionFields,
} from './section-values';
import type {
  DistrictDto,
  OrganizationDetailDto,
  OrgContactDto,
  OrgInsuranceDto,
  OrgLocationDto,
  StateDto,
} from '@/lib/types';

export interface SectionEditorProps {
  provider: OrganizationDetailDto;
  section: ProviderSection;
  values: Record<string, unknown>;
  disabled: boolean;
  registerSave: (key: string, save: () => Promise<void>) => void;
  registerDirty: (key: string, dirty: boolean) => void;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
  /** Clears the "has errors" badge for this step after a successful save. */
  onSaved: (key: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof ApiClientError ? error.message : 'Could not save this section.';
}

function useSectionSave(
  key: string,
  save: () => Promise<void>,
  dirty: boolean,
  registerSave: SectionEditorProps['registerSave'],
  registerDirty: SectionEditorProps['registerDirty'],
): void {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    registerSave(key, () => saveRef.current());
  }, [key, registerSave]);
  useEffect(() => {
    registerDirty(key, dirty);
  }, [key, dirty, registerDirty]);
}

function SectionHeading({ section }: { section: ProviderSection }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{section.title}</h2>
      <p className="text-xs text-muted-foreground">
        {section.clause}
        {section.description ? ` · ${section.description}` : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic data-driven section: columns and type_data only.
// ---------------------------------------------------------------------------

export function GenericSection({
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
  const providerType = provider.organization.providerType;
  const [local, setLocal] = useState<Record<string, unknown>>(() =>
    initialSectionValues(section, provider.organization),
  );
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fields = visibleSectionFields(section, values, providerType);
  const relatedFiles = section.fields.filter(
    (field) =>
      field.storage.kind === 'related' &&
      field.storage.table === 'provider_documents' &&
      isFieldVisible(field, values, providerType),
  );

  useEffect(() => {
    if (!dirty) setLocal(initialSectionValues(section, provider.organization));
  }, [dirty, provider.organization, section]);

  const save = useCallback(async () => {
    if (disabled || saving) return;
    // Drafts save partially: only the fields the user has filled are sent.
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = local[field.key];
      if (value === undefined || value === '') continue;
      payload[field.key] = field.type === 'money' ? Number(value) : value;
    }
    setSaving(true);
    try {
      await api.patch(`/api/v1/providers/${provider.organization.id}/sections/${section.key}`, {
        version: provider.organization.version,
        data: payload,
      });
      setDirty(false);
      setStatus('Draft saved');
      onSaved(section.key);
      await refresh();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  }, [
    disabled,
    fields,
    local,
    onError,
    onSaved,
    provider.organization.id,
    provider.organization.version,
    refresh,
    saving,
    section.key,
  ]);

  useSectionSave(section.key, save, dirty, registerSave, registerDirty);

  // Autosave every 20 seconds while dirty. The ref keeps the timer from being
  // reset by every keystroke (which would mean it never fires).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [dirty]);

  return (
    <section className="space-y-4">
      <SectionHeading section={section} />
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      <div
        className="grid gap-4 sm:grid-cols-2"
        onBlur={() => {
          if (dirty) void save();
        }}
      >
        {fields.map((field) => (
          <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : undefined}>
            <FieldRenderer
              field={field}
              value={local[field.key]}
              values={{ ...values, ...local }}
              providerType={providerType}
              ownerId={provider.organization.id}
              disabled={disabled}
              onChange={(value) => {
                setLocal((current) => ({ ...current, [field.key]: value }));
                setDirty(true);
              }}
            />
          </div>
        ))}
        {relatedFiles.map((field) => (
          <FieldRenderer
            key={field.key}
            field={field}
            value={undefined}
            values={values}
            providerType={providerType}
            ownerId={provider.organization.id}
            disabled={disabled}
            onLinked={refresh}
            onChange={() => undefined}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Registered office: the primary provider_locations row.
// ---------------------------------------------------------------------------

export function RegisteredOfficeSection({
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
  const primary = provider.locations.find((row) => row.isPrimary) ?? null;
  const [local, setLocal] = useState<Record<string, unknown>>(() => {
    if (!primary) return {};
    return {
      reg_addr_line1: primary.addressLine1 ?? '',
      reg_addr_line2: primary.addressLine2 ?? '',
      reg_landmark: primary.landmark ?? '',
      reg_city: primary.city ?? '',
      reg_pin: primary.pinCode ?? '',
      reg_state: '',
      reg_district: '',
    };
  });
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [states, setStates] = useState<StateDto[]>([]);
  const [districts, setDistricts] = useState<DistrictDto[]>([]);

  useEffect(() => {
    api
      .get<StateDto[]>('/api/v1/master/states')
      .then((response) => setStates(response.data))
      .catch(() => undefined);
  }, []);

  const stateId = states.find((state) => state.name === local.reg_state)?.id ?? null;

  useEffect(() => {
    if (!stateId) {
      setDistricts([]);
      return;
    }
    api
      .get<DistrictDto[]>(`/api/v1/master/districts?stateId=${stateId}`)
      .then((response) => setDistricts(response.data))
      .catch(() => setDistricts([]));
  }, [stateId]);

  // Hydrate the saved ids back into the names the registry uses.
  useEffect(() => {
    if (!primary) return;
    const state = states.find((row) => row.id === primary.stateId);
    if (state) setLocal((current) => ({ ...current, reg_state: state.name }));
  }, [primary, states]);

  useEffect(() => {
    if (!primary?.districtId) return;
    const district = districts.find((row) => row.id === primary.districtId);
    if (district) setLocal((current) => ({ ...current, reg_district: district.name }));
  }, [districts, primary?.districtId]);

  const stateField = section.fields.find((field) => field.key === 'reg_state');
  const fields = section.fields.filter(
    (field) =>
      field.storage.kind === 'related' &&
      isFieldVisible(field, values, provider.organization.providerType),
  );

  const save = useCallback(async () => {
    if (disabled) return;
    const resolvedStateId =
      states.find((state) => state.name === local.reg_state)?.id ?? primary?.stateId ?? undefined;
    const districtId = districts.find((district) => district.name === local.reg_district)?.id;
    const payload = {
      name: primary?.name ?? 'Registered office',
      location_type: primary?.locationType ?? 'other',
      address_line1: String(local.reg_addr_line1 ?? primary?.addressLine1 ?? ''),
      address_line2: String(local.reg_addr_line2 ?? ''),
      landmark: String(local.reg_landmark ?? ''),
      city: String(local.reg_city ?? ''),
      pin_code: String(local.reg_pin ?? ''),
      is_primary: true,
      ...(resolvedStateId ? { state_id: resolvedStateId } : {}),
      ...(districtId ? { district_id: districtId } : {}),
    };
    try {
      if (primary) {
        await api.patch(
          `/api/v1/providers/${provider.organization.id}/locations/${primary.id}`,
          payload,
        );
      } else {
        await api.post(`/api/v1/providers/${provider.organization.id}/locations`, payload);
      }
      setDirty(false);
      setStatus('Address saved');
      onSaved(section.key);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }, [
    disabled,
    local,
    onError,
    onSaved,
    primary,
    provider.organization.id,
    refresh,
    section.key,
    states,
    districts,
  ]);

  useSectionSave(section.key, save, dirty, registerSave, registerDirty);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [dirty]);

  return (
    <section className="space-y-4">
      <SectionHeading section={section} />
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      <div
        className="grid gap-4 sm:grid-cols-2"
        onBlur={() => {
          if (dirty) void save();
        }}
      >
        {fields.map((field) =>
          field.type === 'address' || field.key === 'reg_district' ? null : (
            <FieldRenderer
              key={field.key}
              field={field}
              value={local[field.key]}
              values={{ ...values, ...local }}
              providerType={provider.organization.providerType}
              disabled={disabled}
              onChange={(value) => {
                setLocal((current) => ({ ...current, [field.key]: value }));
                setDirty(true);
              }}
            />
          ),
        )}
        <div>
          <Label htmlFor="reg-district" required>
            District
          </Label>
          {districts.length > 0 ? (
            <Select
              id="reg-district"
              value={String(local.reg_district ?? '')}
              disabled={disabled}
              onChange={(event) => {
                setLocal((current) => ({ ...current, reg_district: event.target.value }));
                setDirty(true);
              }}
            >
              <option value="">Choose a district</option>
              {districts.map((district) => (
                <option key={district.id} value={district.name}>
                  {district.name}
                </option>
              ))}
            </Select>
          ) : (
            <FieldRenderer
              field={section.fields.find((entry) => entry.key === 'reg_district') ?? fields[0]!}
              value={local.reg_district}
              values={{ ...values, ...local }}
              providerType={provider.organization.providerType}
              disabled={disabled}
              onChange={(value) => {
                setLocal((current) => ({ ...current, reg_district: value }));
                setDirty(true);
              }}
            />
          )}
        </div>
      </div>
      {local.reg_state && !states.some((state) => state.name === local.reg_state) ? (
        <p className="text-xs text-muted-foreground">
          Pick the state from the list so it can be linked to master data.
        </p>
      ) : null}
      {stateField && states.length === 0 ? (
        <p className="text-xs text-muted-foreground">State list is loading…</p>
      ) : null}
      {local.reg_state && districts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Choose the state to load its districts. A district saved without one uses the state only.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Locations / branches: rows in provider_locations.
// ---------------------------------------------------------------------------

interface LocationDraft {
  id?: string;
  name: string;
  locationType: string;
  addressLine1: string;
  addressLine2: string;
  landmark: string;
  city: string;
  pinCode: string;
  bookingPhone: string;
  isPublic: boolean;
  isPrimary: boolean;
  hours: unknown;
}

function draftFromLocation(row: OrgLocationDto): LocationDraft {
  return {
    id: row.id,
    name: row.name,
    locationType: row.locationType,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2 ?? '',
    landmark: row.landmark ?? '',
    city: row.city,
    pinCode: row.pinCode,
    bookingPhone: row.bookingPhone ?? '',
    isPublic: row.isPublic,
    isPrimary: row.isPrimary,
    hours: row.operatingHours,
  };
}

const emptyLocation: LocationDraft = {
  name: '',
  locationType: 'clinic',
  addressLine1: '',
  addressLine2: '',
  landmark: '',
  city: '',
  pinCode: '',
  bookingPhone: '',
  isPublic: true,
  isPrimary: false,
  hours: [],
};

export function LocationsSection({
  provider,
  section,
  disabled,
  registerSave,
  registerDirty,
  refresh,
  onError,
  onSaved,
}: SectionEditorProps) {
  const [editing, setEditing] = useState<LocationDraft | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (!editing) return;
    if (!editing.name || !editing.addressLine1 || !editing.city || editing.pinCode.length !== 6) {
      return;
    }
    const payload = {
      name: editing.name,
      location_type: editing.locationType,
      address_line1: editing.addressLine1,
      address_line2: editing.addressLine2 || undefined,
      landmark: editing.landmark || undefined,
      city: editing.city,
      pin_code: editing.pinCode,
      booking_phone: editing.bookingPhone || undefined,
      is_public: editing.isPublic,
      is_primary: editing.isPrimary,
      operating_hours: Array.isArray(editing.hours) ? { slots: editing.hours } : {},
    };
    try {
      if (editing.id) {
        await api.patch(
          `/api/v1/providers/${provider.organization.id}/locations/${editing.id}`,
          payload,
        );
      } else {
        await api.post(`/api/v1/providers/${provider.organization.id}/locations`, payload);
      }
      setEditing(null);
      setStatus('Location saved');
      onSaved(section.key);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  useSectionSave(section.key, save, editing !== null, registerSave, registerDirty);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!editing) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [editing]);

  async function remove(id: string): Promise<void> {
    try {
      await api.delete(`/api/v1/providers/${provider.organization.id}/locations/${id}`);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  return (
    <section className="space-y-4">
      <SectionHeading section={section} />
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      <div className="space-y-2">
        {provider.locations.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
          >
            <div className="text-sm">
              <p className="font-medium">
                {row.name}{' '}
                {row.isPrimary ? <span className="text-xs text-primary">Primary</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.addressLine1}, {row.city} {row.pinCode}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(draftFromLocation(row))}
                disabled={disabled}
              >
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(row.id)} disabled={disabled}>
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
      {editing ? (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="loc-name">Location name</Label>
              <Input
                id="loc-name"
                value={editing.name}
                disabled={disabled}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="loc-type">Location type</Label>
              <Select
                id="loc-type"
                value={editing.locationType}
                disabled={disabled}
                onChange={(event) => setEditing({ ...editing, locationType: event.target.value })}
              >
                {locationTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="loc-address">Address line 1</Label>
              <Input
                id="loc-address"
                value={editing.addressLine1}
                disabled={disabled}
                onChange={(event) => setEditing({ ...editing, addressLine1: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="loc-city">City / town</Label>
              <Input
                id="loc-city"
                value={editing.city}
                disabled={disabled}
                onChange={(event) => setEditing({ ...editing, city: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="loc-pin">PIN code</Label>
              <PinCodeInput
                id="loc-pin"
                value={editing.pinCode}
                disabled={disabled}
                onChange={(pinCode) => setEditing({ ...editing, pinCode })}
              />
            </div>
            <div>
              <Label htmlFor="loc-phone">Booking phone</Label>
              <Input
                id="loc-phone"
                value={editing.bookingPhone}
                disabled={disabled}
                onChange={(event) => setEditing({ ...editing, bookingPhone: event.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input
                type="checkbox"
                checked={editing.isPrimary}
                disabled={disabled}
                onChange={(event) => setEditing({ ...editing, isPrimary: event.target.checked })}
              />
              Primary location
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input
                type="checkbox"
                checked={editing.isPublic}
                disabled={disabled}
                onChange={(event) => setEditing({ ...editing, isPublic: event.target.checked })}
              />
              Publicly listed
            </label>
          </div>
          <div>
            <Label>Operating hours</Label>
            <OperatingHoursEditor
              value={editing.hours}
              disabled={disabled}
              onChange={(hours) => setEditing({ ...editing, hours })}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={disabled}>
              Save location
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing({ ...emptyLocation })}
          disabled={disabled}
        >
          Add location
        </Button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Signatory and designated contacts: rows in provider_contacts keyed by role.
// ---------------------------------------------------------------------------

function ContactCard({
  provider,
  sectionKey,
  role,
  label,
  contact,
  disabled,
  fields,
  refresh,
  onError,
  onSaved,
}: {
  provider: OrganizationDetailDto;
  sectionKey: string;
  role: string;
  label: string;
  contact: OrgContactDto | undefined;
  disabled: boolean;
  fields?: readonly ProviderField[];
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
  onSaved: (key: string) => void;
}) {
  const [name, setName] = useState(contact?.name ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [designation, setDesignation] = useState(contact?.designation ?? '');
  const [dirty, setDirty] = useState(false);

  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  saveRef.current = async () => {
    if (disabled || !dirty) return;
    if (!name.trim() || phone.length !== 10) return;
    await save();
  };

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [dirty]);

  async function save(): Promise<void> {
    try {
      await api.post(`/api/v1/providers/${provider.organization.id}/contacts`, {
        role,
        name,
        phone,
        ...(email ? { email } : {}),
        ...(designation ? { designation } : {}),
      });
      setDirty(false);
      onSaved(sectionKey);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  async function remove(): Promise<void> {
    if (!contact) return;
    try {
      await api.delete(`/api/v1/providers/${provider.organization.id}/contacts/${contact.id}`);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  return (
    <div
      className="space-y-2 rounded-md border p-3"
      onBlur={() => {
        if (dirty) void saveRef.current();
      }}
    >
      <p className="text-sm font-medium">{label}</p>
      {fields ? (
        <p className="text-xs text-muted-foreground">
          {fields.map((field) => field.label).join(' · ')}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {role === 'signatory' ? (
          <div>
            <Label htmlFor={`${role}-designation`}>Designation</Label>
            <Input
              id={`${role}-designation`}
              value={designation}
              disabled={disabled}
              onChange={(event) => {
                setDesignation(event.target.value);
                setDirty(true);
              }}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor={`${role}-name`}>Name</Label>
          <Input
            id={`${role}-name`}
            value={name}
            disabled={disabled}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div>
          <Label htmlFor={`${role}-phone`}>Phone</Label>
          <Input
            id={`${role}-phone`}
            value={phone}
            disabled={disabled}
            maxLength={10}
            onChange={(event) => {
              setPhone(event.target.value.replace(/\D/g, '').slice(0, 10));
              setDirty(true);
            }}
          />
        </div>
        <div>
          <Label htmlFor={`${role}-email`}>Email</Label>
          <Input
            id={`${role}-email`}
            type="email"
            value={email}
            disabled={disabled}
            onChange={(event) => {
              setEmail(event.target.value);
              setDirty(true);
            }}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={save}
          disabled={disabled || !name || phone.length !== 10}
        >
          Save contact
        </Button>
        {contact ? (
          <Button size="sm" variant="ghost" onClick={remove} disabled={disabled}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SignatorySection(props: SectionEditorProps) {
  const contact = props.provider.contacts.find((row) => row.role === 'signatory');
  return (
    <section className="space-y-4">
      <SectionHeading section={props.section} />
      <ContactCard
        provider={props.provider}
        sectionKey={props.section.key}
        role="signatory"
        label="Authorized signatory"
        contact={contact}
        fields={props.section.fields}
        disabled={props.disabled}
        refresh={props.refresh}
        onError={props.onError}
        onSaved={props.onSaved}
      />
    </section>
  );
}

function LegalNoticeCard({
  provider,
  contact,
  disabled,
  refresh,
  onError,
  onSaved,
}: {
  provider: OrganizationDetailDto;
  contact: OrgContactDto | undefined;
  disabled: boolean;
  refresh: () => Promise<void>;
  onError: (error: unknown) => void;
  onSaved: (key: string) => void;
}) {
  const [email, setEmail] = useState(contact?.email ?? '');
  const [address, setAddress] = useState<Record<string, unknown>>(
    contact?.address ?? { line1: '', city: '', state: '', pin: '' },
  );
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (disabled || !dirty) return;
    const phone = provider.organization.mobile;
    if (!phone || phone.length !== 10) {
      onError(new Error('Add the provider mobile number before saving the legal notice contact.'));
      return;
    }
    const completeAddress =
      typeof address.line1 === 'string' &&
      address.line1.trim() &&
      typeof address.city === 'string' &&
      address.city.trim() &&
      typeof address.state === 'string' &&
      address.state.trim() &&
      typeof address.pin === 'string' &&
      address.pin.length === 6;
    try {
      await api.post(`/api/v1/providers/${provider.organization.id}/contacts`, {
        role: 'legal_notice',
        name: provider.organization.legalName ?? 'Legal notice contact',
        phone,
        ...(email ? { email } : {}),
        ...(completeAddress ? { address } : {}),
      });
      setDirty(false);
      setStatus('Legal notice contact saved');
      onSaved('contacts');
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [dirty]);

  return (
    <div
      className="space-y-3 rounded-md border p-3"
      onBlur={() => {
        if (dirty) void saveRef.current();
      }}
    >
      <div>
        <p className="text-sm font-medium">Legal notice contact</p>
        <p className="text-xs text-muted-foreground">
          Uses the provider mobile ({provider.organization.mobile ?? 'not set'}) as the contact
          number.
        </p>
      </div>
      <AddressInput
        idPrefix="legal-notice"
        value={address}
        disabled={disabled}
        onChange={(next) => {
          setAddress(next);
          setDirty(true);
        }}
      />
      <div>
        <Label htmlFor="legal-notice-email">Legal notice email</Label>
        <Input
          id="legal-notice-email"
          type="email"
          value={email}
          disabled={disabled}
          onChange={(event) => {
            setEmail(event.target.value);
            setDirty(true);
          }}
        />
      </div>
      {status ? (
        <p role="status" className="text-xs text-emerald-700">
          {status}
        </p>
      ) : null}
      <Button size="sm" variant="outline" onClick={() => void save()} disabled={disabled}>
        Save legal notice contact
      </Button>
    </div>
  );
}

const contactRoles = [
  ['booking', 'Booking / orders contact'],
  ['grievance', 'Complaint / grievance officer'],
  ['emergency', 'Emergency / incident escalation'],
  ['security', 'Data security / breach contact'],
  ['billing', 'Billing / finance contact'],
] as const;

export function ContactsSection(props: SectionEditorProps) {
  return (
    <section className="space-y-4">
      <SectionHeading section={props.section} />
      {contactRoles.map(([role, label]) => (
        <ContactCard
          key={role}
          provider={props.provider}
          sectionKey={props.section.key}
          role={role}
          label={label}
          contact={props.provider.contacts.find((row) => row.role === role)}
          disabled={props.disabled}
          refresh={props.refresh}
          onError={props.onError}
          onSaved={props.onSaved}
        />
      ))}
      <LegalNoticeCard
        provider={props.provider}
        contact={props.provider.contacts.find((row) => row.role === 'legal_notice')}
        disabled={props.disabled}
        refresh={props.refresh}
        onError={props.onError}
        onSaved={props.onSaved}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Insurance: rows in provider_insurance.
// ---------------------------------------------------------------------------

interface InsuranceDraft {
  id?: string;
  type: string;
  insurer: string;
  policyNo: string;
  limitRupees: string;
  validFrom: string;
  validTo: string;
}

export function InsuranceSection({
  provider,
  section,
  disabled,
  refresh,
  onError,
  onSaved,
}: SectionEditorProps) {
  const [draft, setDraft] = useState<InsuranceDraft | null>(null);
  const [dirty, setDirty] = useState(false);

  function updateDraft(patch: Partial<InsuranceDraft>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  async function save(): Promise<void> {
    if (!draft || disabled) return;
    if (!draft.type || !draft.insurer || !draft.policyNo) return;
    const payload = {
      type: draft.type,
      insurer: draft.insurer,
      policy_no: draft.policyNo,
      ...(draft.limitRupees ? { limit_paise: Math.round(Number(draft.limitRupees) * 100) } : {}),
      ...(draft.validFrom ? { valid_from: draft.validFrom } : {}),
      ...(draft.validTo ? { valid_to: draft.validTo } : {}),
    };
    try {
      if (draft.id) {
        await api.patch(
          `/api/v1/providers/${provider.organization.id}/insurance/${draft.id}`,
          payload,
        );
      } else {
        await api.post(`/api/v1/providers/${provider.organization.id}/insurance`, payload);
      }
      setDraft(null);
      setDirty(false);
      onSaved(section.key);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || !draft) return;
    const timer = window.setInterval(() => void saveRef.current(), 20_000);
    return () => window.clearInterval(timer);
  }, [dirty, draft]);

  async function remove(row: OrgInsuranceDto): Promise<void> {
    try {
      await api.delete(`/api/v1/providers/${provider.organization.id}/insurance/${row.id}`);
      await refresh();
    } catch (error) {
      onError(error);
    }
  }

  return (
    <section className="space-y-4">
      <SectionHeading section={section} />
      {provider.insurance.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
        >
          <div>
            <p className="font-medium">
              {row.type} · {row.insurer}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.policyNo}
              {row.validTo ? ` · valid to ${row.validTo.slice(0, 10)}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                setDraft({
                  id: row.id,
                  type: row.type,
                  insurer: row.insurer,
                  policyNo: row.policyNo,
                  limitRupees: row.limitPaise ? String(row.limitPaise / 100) : '',
                  validFrom: row.validFrom?.slice(0, 10) ?? '',
                  validTo: row.validTo?.slice(0, 10) ?? '',
                })
              }
            >
              Edit
            </Button>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => remove(row)}>
              Remove
            </Button>
          </div>
        </div>
      ))}
      {draft ? (
        <div
          className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2"
          onBlur={() => {
            if (dirty) void saveRef.current();
          }}
        >
          <div>
            <Label htmlFor="ins-type">Insurance type</Label>
            <Input
              id="ins-type"
              value={draft.type}
              disabled={disabled}
              onChange={(event) => updateDraft({ type: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ins-insurer">Insurer</Label>
            <Input
              id="ins-insurer"
              value={draft.insurer}
              disabled={disabled}
              onChange={(event) => updateDraft({ insurer: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ins-policy">Policy number</Label>
            <Input
              id="ins-policy"
              value={draft.policyNo}
              disabled={disabled}
              onChange={(event) => updateDraft({ policyNo: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ins-limit">Sum insured (₹)</Label>
            <Input
              id="ins-limit"
              type="number"
              value={draft.limitRupees}
              disabled={disabled}
              onChange={(event) => updateDraft({ limitRupees: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ins-from">Valid from</Label>
            <Input
              id="ins-from"
              type="date"
              value={draft.validFrom}
              disabled={disabled}
              onChange={(event) => updateDraft({ validFrom: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ins-to">Valid to</Label>
            <Input
              id="ins-to"
              type="date"
              value={draft.validTo}
              disabled={disabled}
              onChange={(event) => updateDraft({ validTo: event.target.value })}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" onClick={save} disabled={disabled}>
              Save insurance
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            setDraft({
              type: '',
              insurer: '',
              policyNo: '',
              limitRupees: '',
              validFrom: '',
              validTo: '',
            })
          }
        >
          Add insurance policy
        </Button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Service area: provider_service_pins plus the section's columns.
// ---------------------------------------------------------------------------

export function ServiceAreaSection(props: SectionEditorProps) {
  const [entry, setEntry] = useState('');
  const pins = props.provider.servicePins;

  async function addPin(): Promise<void> {
    const codes = entry
      .split(/[\s,;]+/)
      .map((code) => code.trim())
      .filter((code) => /^\d{6}$/.test(code));
    if (codes.length === 0) return;
    try {
      for (const code of codes) {
        await api.post(`/api/v1/providers/${props.provider.organization.id}/service-pins`, {
          pin_code: code,
          service_kind: 'service',
        });
      }
      setEntry('');
      await props.refresh();
    } catch (error) {
      props.onError(error);
    }
  }

  async function removePin(id: string): Promise<void> {
    try {
      await api.delete(`/api/v1/providers/${props.provider.organization.id}/service-pins/${id}`);
      await props.refresh();
    } catch (error) {
      props.onError(error);
    }
  }

  return (
    <div className="space-y-6">
      <GenericSection {...props} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Serviceable PIN codes</p>
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
                disabled={props.disabled}
                onClick={() => removePin(pin.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={entry}
            placeholder="Paste PIN codes, separated by spaces or commas"
            disabled={props.disabled}
            onChange={(event) => setEntry(event.target.value)}
          />
          <Button size="sm" onClick={addPin} disabled={props.disabled || entry.trim() === ''}>
            Add PINs
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Type-specific sections fall through to the generic renderer, so they need no UI work. */
export const SECTION_EDITORS: Record<string, (props: SectionEditorProps) => ReactNode> = {
  doctor_identity: (props) => <DoctorIdentitySection {...props} />,
  doctor_qualifications: (props) => <DoctorQualificationsSection {...props} />,
  doctor_practice: (props) => <DoctorPracticeSection {...props} />,
  clinic_establishment: (props) => <ClinicEstablishmentSection {...props} />,
  pharmacy_premises: (props) => (
    <div className="space-y-8">
      <GenericSection {...props} />
      <PrimaryLocationSummary provider={props.provider} />
      <LicenceFieldsSection {...props} fieldKeys={['ph_licences']} />
      <SingleLicenceFields {...props} fieldKeys={['ph_fssai']} />
    </div>
  ),
  pharmacy_fulfilment: (props) => (
    <div className="space-y-8">
      <GenericSection {...props} />
      <ServicePinField
        provider={props.provider}
        serviceKind="delivery"
        label="Delivery PIN codes"
        disabled={props.disabled}
        refresh={props.refresh}
        onError={props.onError}
      />
    </div>
  ),
  diagnostic_licences: (props) => (
    <div className="space-y-8">
      <GenericSection {...props} />
      <LicenceFieldsSection
        {...props}
        fieldKeys={['dc_establishment', 'dc_nabl_details', 'dc_aerb', 'dc_other_licences']}
      />
      <SingleLicenceFields {...props} fieldKeys={['dc_pcpndt', 'dc_bmw']} />
    </div>
  ),
  diagnostic_services: (props) => (
    <div className="space-y-8">
      <GenericSection {...props} />
      <TestCatalogueImport
        provider={props.provider}
        disabled={props.disabled}
        refresh={props.refresh}
        onError={props.onError}
      />
    </div>
  ),
  diagnostic_home_collection: (props) => (
    <div className="space-y-8">
      <GenericSection {...props} />
      <ServicePinField
        provider={props.provider}
        serviceKind="collection"
        label="Home collection PIN codes"
        disabled={props.disabled}
        refresh={props.refresh}
        onError={props.onError}
      />
    </div>
  ),
  care_licences: (props) => (
    <div className="space-y-8">
      <GenericSection {...props} />
      <LicenceFieldsSection {...props} fieldKeys={['cp_licences']} />
      <SingleLicenceFields {...props} fieldKeys={['cp_bmw']} />
    </div>
  ),
  registered_office: (props) => <RegisteredOfficeSection {...props} />,
  locations: (props) => <LocationsSection {...props} />,
  signatory: (props) => <SignatorySection {...props} />,
  contacts: (props) => <ContactsSection {...props} />,
  insurance: (props) => <InsuranceSection {...props} />,
  service_area: (props) => <ServiceAreaSection {...props} />,
};

export function SectionEditor(props: SectionEditorProps) {
  const custom = SECTION_EDITORS[props.section.key];
  return custom ? custom(props) : <GenericSection {...props} />;
}

export { allSectionValues, errorText };
