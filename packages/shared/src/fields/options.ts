import type { FieldRequirement, ProviderField, ProviderSection, ProviderSubField } from './types';
import type { FieldKind } from './types';

/**
 * Choice lists used by the registry. These were moved here from
 * `field-registry.ts` when the two registries were merged, so the option lists
 * the portal form already uses are the single copy.
 */

export const constitutionTypes = [
  'individual',
  'sole proprietorship',
  'partnership',
  'LLP',
  'private limited',
  'public limited',
  'trust',
  'society',
  'other',
] as const;

export const locationTypes = [
  'clinic',
  'pharmacy store',
  'lab',
  'collection centre',
  'imaging centre',
  'home-care office',
  'hospital OPD',
  'other',
] as const;

export const registrationCouncils = [
  'NMC',
  'West Bengal Medical Council',
  'State Medical Council (other)',
  'State AYUSH Council',
  'Dental Council of India',
  'State Dental Council',
  'Other',
] as const;

export const systemsOfMedicine = [
  'allopathy',
  'dental',
  'ayurveda',
  'homeopathy',
  'unani',
  'siddha',
  'other',
] as const;

export const medicalSpecialties = [
  'general medicine',
  'general surgery',
  'paediatrics',
  'obstetrics and gynaecology',
  'orthopaedics',
  'dermatology',
  'cardiology',
  'neurology',
  'psychiatry',
  'ENT',
  'ophthalmology',
  'pulmonology',
  'gastroenterology',
  'endocrinology',
  'nephrology',
  'oncology',
  'urology',
  'dentistry',
  'physiotherapy',
  'other',
] as const;

export const insuranceTypes = [
  'professional indemnity',
  'public liability',
  'product liability',
  'cyber',
  'employer/worker (workmen)',
  'other',
] as const;

export const priceUnits = [
  'per hour',
  'per shift (8h)',
  'per shift (12h)',
  'per day',
  'per visit',
  'per week',
  'per month',
] as const;

export const languages = [
  'Bengali',
  'Hindi',
  'English',
  'Urdu',
  'Odia',
  'Assamese',
  'Tamil',
  'Telugu',
  'Marathi',
  'Gujarati',
  'Punjabi',
  'Other',
] as const;

export const appointmentConfirmers = [
  'doctor',
  'authorized establishment',
  'clinic front desk',
] as const;

export const appointmentMethods = ['call', 'WhatsApp', 'portal dashboard', 'email'] as const;

export const feeCollectionOptions = [
  'doctor',
  'authorized establishment',
  'clinic collects directly',
] as const;

/** Fields a provider may tick for publication (section 3.8 `public_fields`). */
export const publishableFieldKeys = [
  'profile_display_name',
  'profile_description',
  'profile_logo',
  'profile_photos',
  'profile_languages',
  'locations',
  'contact_booking',
  'prac_fee',
  'clinic_fees',
  'ph_categories',
  'dc_services',
  'cp_service_categories',
] as const;

export const clinicSystemsOfMedicine = [...systemsOfMedicine, 'physiotherapy'] as const;

export const clinicTypes = [
  'single-doctor clinic',
  'multi-specialty clinic',
  'polyclinic',
  'dental clinic',
  'AYUSH clinic',
  'physiotherapy/rehab centre',
  'day-care/minor procedure centre',
  'other',
] as const;

export const clinicOwnershipTypes = [
  'doctor-owned',
  'partnership',
  'company',
  'trust/charitable',
  'corporate chain',
] as const;

export const clinicServices = [
  'OPD',
  'minor procedures',
  'vaccination',
  'dressing',
  'physiotherapy',
  'dental procedures',
  'other',
] as const;

export const clinicFacilities = [
  'parking',
  'wheelchair access',
  'waiting area',
  'lift',
  'on-site pharmacy',
  'on-site sample collection',
  'other',
] as const;

export const practiceTypes = [
  'own clinic',
  'clinic/hospital (linked)',
  'visiting consultant',
] as const;

export const doctorRolesAtClinic = [
  'in-charge',
  'full-time consultant',
  'visiting consultant',
  'resident',
] as const;

export const pharmacistQualifications = ['D.Pharm', 'B.Pharm', 'M.Pharm', 'other'] as const;

export const pharmacyCategories = [
  'prescription medicines',
  'OTC medicines',
  'wellness and supplements',
  'nutrition and food',
  'medical devices',
  'other',
] as const;

export const pharmacyRestrictedCategories = [
  'Schedule H',
  'Schedule H1',
  'Schedule X',
  'narcotics/psychotropics',
  'none',
] as const;

export const scheduleFlagOptions = [
  'Schedule H',
  'Schedule H1',
  'Schedule X',
  'narcotics/psychotropics',
  'none',
] as const;

export const stockUpdateMethods = ['manual', 'daily upload', 'API'] as const;
export const courierMethods = ['own staff', 'third-party courier', 'both'] as const;

export const careServiceCategories = [
  'non-clinical attendant',
  'registered nursing',
  'physiotherapy',
  'post-discharge assistance',
  'elder support',
  'palliative support',
  'equipment assistance',
  'other',
] as const;

export const careServices = [
  'personal care',
  'nursing procedures',
  'physiotherapy sessions',
  'post-discharge monitoring',
  'elder companionship',
  'palliative support',
  'equipment operation',
  'other',
] as const;

export const careEquipment = [
  'oxygen concentrator',
  'hospital bed',
  'wheelchair',
  'patient lift',
  'other',
] as const;

export const careStaffModels = ['employed', 'contracted', 'via agency', 'mixed'] as const;

export const diagnosticServices = [
  'pathology',
  'radiology',
  'ultrasound',
  'prenatal diagnostics',
  'cardiology tests',
  'health packages',
  'other',
] as const;

export const diagnosticHighRiskWorkflows = [
  'radiology',
  'ultrasound',
  'prenatal diagnostics',
  'telehealth',
  'report hosting',
  'payments',
] as const;

export const reportDeliveryChannels = [
  "provider's own portal/app",
  'email',
  'WhatsApp',
  'in-person',
] as const;

export const testCategories = [
  'pathology',
  'radiology',
  'ultrasound',
  'cardiology',
  'prenatal',
  'other',
] as const;

export const sampleTypes = [
  'blood',
  'urine',
  'stool',
  'swab',
  'tissue',
  'imaging',
  'other',
] as const;

export const performedAtOptions = ['on site', 'parent laboratory', 'third-party lab'] as const;

export const dataCategories = [
  'booking data',
  'patient contact',
  'report metadata',
  'other',
] as const;

export const reportAccessOptions = ['no', 'yes - read only, separately approved'] as const;

export const contactRoles = [
  'booking',
  'grievance',
  'emergency',
  'security',
  'billing',
  'legal_notice',
  'signatory',
] as const;
export type ContactRole = (typeof contactRoles)[number];

export const serviceKinds = ['service', 'delivery', 'collection'] as const;
export type ServiceKind = (typeof serviceKinds)[number];

/** Builds the fields of one section; `section` and `clause` are stamped on each. */
export function fieldsForSection(section: string, clause: string) {
  return (
    key: string,
    label: string,
    type: FieldKind,
    extra: Partial<Omit<ProviderField, 'key' | 'label' | 'type' | 'section' | 'clause'>> = {},
  ): ProviderField => ({
    key,
    label,
    type,
    section,
    clause,
    requirement: 'optional',
    storage: { kind: 'type_data' },
    ...extra,
  });
}

export function section(
  key: string,
  title: string,
  clause: string,
  fields: readonly ProviderField[],
  description?: string,
  extra: Partial<Pick<ProviderSection, 'notInProviderForm'>> = {},
): ProviderSection {
  return { key, title, clause, fields, ...(description ? { description } : {}), ...extra };
}

/** Sub-field helper for repeaters (no section/clause of its own). */
export function sub(
  key: string,
  label: string,
  type: FieldKind,
  extra: Partial<Omit<ProviderSubField, 'key' | 'label' | 'type'>> = {},
): ProviderSubField {
  return { key, label, type, requirement: 'optional', ...extra };
}

export const required: FieldRequirement = 'required';
export const conditional: FieldRequirement = 'conditional';
export const optional: FieldRequirement = 'optional';
