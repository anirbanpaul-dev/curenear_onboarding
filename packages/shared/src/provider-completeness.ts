import { evaluateCondition, formSectionsFor } from './fields/registry';
import type { ProviderField } from './fields/types';
import type { ProviderType } from './enums';
import type {
  ClinicDoctorLinkRecord,
  CompletenessReport,
  DoctorLocationRecord,
  DoctorProfileRecord,
  ProviderContactRecord,
  ProviderDocumentRecord,
  ProviderInsuranceRecord,
  ProviderLicenceRecord,
  ProviderLocationRecord,
  ProviderOrganizationRecord,
  ProviderServicePinRecord,
  SectionCompleteness,
} from './provider-onboarding';

/**
 * Completeness is computed from the field registry plus the rows a provider has
 * saved. It is deliberately a pure function: the API, the submit gate and the
 * tests all call it with a snapshot, so "complete" means the same thing
 * everywhere.
 */

export interface ProviderSnapshot {
  organization: ProviderOrganizationRecord;
  locations: ProviderLocationRecord[];
  contacts: ProviderContactRecord[];
  licences: ProviderLicenceRecord[];
  insurance: ProviderInsuranceRecord[];
  servicePins: ProviderServicePinRecord[];
  documents: ProviderDocumentRecord[];
  /** Set for doctor organizations once the profile row exists. */
  doctorProfile?: DoctorProfileRecord | null;
  /** Standalone practices; clinic links are in `clinicDoctors`. */
  doctorPractices?: DoctorLocationRecord[];
  /** Links when the organization is a clinic. */
  clinicDoctors?: ClinicDoctorLinkRecord[];
}

const organizationColumns: Record<string, keyof ProviderOrganizationRecord> = {
  legal_name: 'legalName',
  trade_name: 'tradeName',
  constitution_type: 'constitutionType',
  registration_number: 'registrationNumber',
  established_on: 'establishedOn',
  website: 'website',
  email: 'email',
  mobile: 'mobile',
  provider_type: 'providerType',
};

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

function columnValue(organization: ProviderOrganizationRecord, column: string): unknown {
  const dot = column.indexOf('.');
  const table = dot === -1 ? '' : column.slice(0, dot);
  const rest = dot === -1 ? column : column.slice(dot + 1);
  if (table === 'profile_data') {
    return readPath(organization.profileData, rest) ?? organization.profileData[rest];
  }
  if (table === 'publication_consents') {
    return (
      readPath(organization.publicationConsents, rest) ?? organization.publicationConsents[rest]
    );
  }
  if (table === 'provider_organizations' || table === '') {
    const key = organizationColumns[rest];
    return key ? organization[key] : undefined;
  }
  return undefined;
}

export function isPresentValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function licenceFor(
  field: ProviderField,
  snapshot: ProviderSnapshot,
): ProviderLicenceRecord | undefined {
  const role = field.storage.kind === 'related' ? field.storage.role : undefined;
  if (!role) return snapshot.licences[0];
  return (
    snapshot.licences.find((row) => row.details.role === role) ??
    (role === 'other' ? snapshot.licences.find((row) => !row.details.role) : undefined)
  );
}

function relatedPresent(field: ProviderField, snapshot: ProviderSnapshot): boolean {
  if (field.storage.kind !== 'related') return false;
  const { table, role } = field.storage;
  switch (table) {
    case 'provider_locations':
      return role === 'primary' || role === undefined
        ? snapshot.locations.some((row) => row.isPrimary)
        : snapshot.locations.length > 0;
    case 'provider_contacts':
      return role
        ? snapshot.contacts.some((row) => row.role === role)
        : snapshot.contacts.length > 0;
    case 'provider_service_pins':
      return role
        ? snapshot.servicePins.some((row) => row.serviceKind === role)
        : snapshot.servicePins.length > 0;
    case 'provider_licences':
      return licenceFor(field, snapshot) !== undefined;
    case 'provider_insurance':
      return snapshot.insurance.length > 0;
    case 'provider_documents': {
      const live = snapshot.documents.filter((row) => row.deletedAt === null);
      return role ? live.some((row) => row.role === role) : live.length > 0;
    }
    case 'doctor_profiles': {
      const profile = snapshot.doctorProfile;
      if (!profile) return isPresentValue(snapshot.organization.typeData[field.key]);
      if (field.key === 'doc_full_name') return isPresentValue(profile.fullName);
      if (field.key === 'doc_reg_no') return isPresentValue(profile.registrationNo);
      if (field.key === 'doc_reg_council') return isPresentValue(profile.councilName);
      if (field.key === 'doc_system') return isPresentValue(profile.systemOfMedicine);
      if (field.key === 'doc_specialty') return isPresentValue(profile.specialtyName);
      if (field.key === 'doc_photo') return isPresentValue(profile.photoDocumentId);
      if (field.key === 'doc_qualifications') return profile.qualifications.length > 0;
      return isPresentValue(snapshot.organization.typeData[field.key]);
    }
    case 'doctor_locations':
      return (snapshot.doctorPractices?.length ?? 0) > 0
        ? true
        : isPresentValue(snapshot.organization.typeData[field.key]);
    default:
      return false;
  }
}

function fieldValue(field: ProviderField, snapshot: ProviderSnapshot): unknown {
  if (field.storage.kind === 'type_data') return snapshot.organization.typeData[field.key];
  if (field.storage.kind === 'column') {
    return columnValue(snapshot.organization, field.storage.column);
  }
  return relatedPresent(field, snapshot) ? true : undefined;
}

function documentPresent(field: ProviderField, snapshot: ProviderSnapshot): boolean {
  if (field.storage.kind === 'related' && field.storage.table === 'provider_documents') {
    return relatedPresent(field, snapshot);
  }
  if (field.type === 'file') {
    const value = snapshot.organization.typeData[field.key];
    return isPresentValue(value) && typeof value === 'object';
  }
  return true;
}

/** Licence rows carry their document inline; a required document must be attached. */
function licenceDocumentMissing(field: ProviderField, snapshot: ProviderSnapshot): boolean {
  if (field.storage.kind !== 'related') return false;
  if (field.storage.table !== 'provider_licences' && field.storage.table !== 'provider_insurance') {
    return false;
  }
  const items = field.items ?? [];
  const fileItems = items.filter((item) => item.type === 'file');
  if (fileItems.length === 0) return false;
  const required = fileItems.filter(
    (item) => (item.requirement ?? field.requirement) === 'required',
  );
  if (required.length === 0) return false;
  if (field.storage.table === 'provider_insurance') {
    return snapshot.insurance.some((row) => !row.documentId);
  }
  const licence = licenceFor(field, snapshot);
  return !licence || !licence.documentId;
}

export function assessCompleteness(
  providerType: ProviderType,
  snapshot: ProviderSnapshot,
): CompletenessReport {
  const sections = formSectionsFor(providerType).filter((section) => !section.notInProviderForm);

  // One value map for conditions, which may reference fields in other sections.
  const values: Record<string, unknown> = { ...snapshot.organization.typeData };
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.adminOnly) continue;
      const value = fieldValue(field, snapshot);
      if (value !== undefined) values[field.key] = value;
    }
  }

  const report: CompletenessReport = {
    complete: true,
    sections: [],
    missingRequiredFields: [],
    missingDocuments: [],
  };

  for (const section of sections) {
    const result: SectionCompleteness = {
      key: section.key,
      title: section.title,
      status: 'empty',
      missingFields: [],
      missingDocuments: [],
    };
    let hasValue = false;
    let hasRequiredField = false;

    for (const field of section.fields) {
      if (field.adminOnly) continue;
      const value = fieldValue(field, snapshot);
      const present = isPresentValue(value);
      if (present) hasValue = true;

      const required =
        field.requirement === 'required' ||
        (field.requirement === 'conditional' &&
          field.condition !== undefined &&
          evaluateCondition(field.condition, values));

      if (!required) continue;
      hasRequiredField = true;

      if (!present) {
        result.missingFields.push(field.key);
        report.missingRequiredFields.push(field.key);
      }

      const isDocumentField =
        (field.storage.kind === 'related' && field.storage.table === 'provider_documents') ||
        field.type === 'file';

      if (isDocumentField) {
        if (!documentPresent(field, snapshot) || !present) {
          result.missingDocuments.push(field.key);
          report.missingDocuments.push(field.key);
        }
      } else if (licenceDocumentMissing(field, snapshot)) {
        const key = field.key;
        result.missingDocuments.push(key);
        report.missingDocuments.push(key);
      }
    }

    // A section that has data and no gaps is complete; anything else with data
    // is in progress.
    if (hasValue) {
      result.status =
        result.missingFields.length === 0 && result.missingDocuments.length === 0
          ? 'complete'
          : 'in_progress';
    } else if (!hasRequiredField) {
      // A section whose fields are all optional (or excluded for this provider
      // type) cannot block submission just because it is empty.
      result.status = 'complete';
    }
    if (result.status !== 'complete') report.complete = false;
    report.sections.push(result);
  }

  report.missingRequiredFields = Array.from(new Set(report.missingRequiredFields)).sort();
  report.missingDocuments = Array.from(new Set(report.missingDocuments)).sort();
  return report;
}
