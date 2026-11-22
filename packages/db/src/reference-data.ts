import type { ProviderType } from '@curenear/shared';

/**
 * Reference data the portal seeds on first run. Everything here is ordinary
 * table data afterwards — administrators extend it at /admin/master-data.
 *
 * Sources:
 * - States: Indian states and union territories (ISO 3166-2:IN codes).
 * - Specialties: the recognised specialties named in the Doctor section of
 *   docs/CureNear_Provider_Onboarding_Field_Spec.md (4.2) plus the systems of
 *   medicine in 4.1/6.1.
 * - Service categories: care-provider categories (5.2), diagnostic services
 *   (8.2), clinic types (6.1) and the pharmacy licence scopes (7.1, 7.3).
 * - Facility types: location types (3.4).
 * - Documents: the licence and policy documents listed per provider type in
 *   sections 4-8 and the 60/30/7-day expiry reminders in section 10.
 *
 * Names derived from a state (councils) are editable in the admin UI: they are
 * a starting point, not an authoritative regulatory list.
 */

export interface StateSeed {
  code: string;
  name: string;
}

export const stateSeeds: StateSeed[] = [
  { code: 'IN-AP', name: 'Andhra Pradesh' },
  { code: 'IN-AR', name: 'Arunachal Pradesh' },
  { code: 'IN-AS', name: 'Assam' },
  { code: 'IN-BR', name: 'Bihar' },
  { code: 'IN-CT', name: 'Chhattisgarh' },
  { code: 'IN-GA', name: 'Goa' },
  { code: 'IN-GJ', name: 'Gujarat' },
  { code: 'IN-HR', name: 'Haryana' },
  { code: 'IN-HP', name: 'Himachal Pradesh' },
  { code: 'IN-JH', name: 'Jharkhand' },
  { code: 'IN-KA', name: 'Karnataka' },
  { code: 'IN-KL', name: 'Kerala' },
  { code: 'IN-MP', name: 'Madhya Pradesh' },
  { code: 'IN-MH', name: 'Maharashtra' },
  { code: 'IN-MN', name: 'Manipur' },
  { code: 'IN-ML', name: 'Meghalaya' },
  { code: 'IN-MZ', name: 'Mizoram' },
  { code: 'IN-NL', name: 'Nagaland' },
  { code: 'IN-OR', name: 'Odisha' },
  { code: 'IN-PB', name: 'Punjab' },
  { code: 'IN-RJ', name: 'Rajasthan' },
  { code: 'IN-SK', name: 'Sikkim' },
  { code: 'IN-TN', name: 'Tamil Nadu' },
  { code: 'IN-TG', name: 'Telangana' },
  { code: 'IN-TR', name: 'Tripura' },
  { code: 'IN-UP', name: 'Uttar Pradesh' },
  { code: 'IN-UT', name: 'Uttarakhand' },
  { code: 'IN-WB', name: 'West Bengal' },
  { code: 'IN-AN', name: 'Andaman and Nicobar Islands' },
  { code: 'IN-CH', name: 'Chandigarh' },
  { code: 'IN-DN', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'IN-DL', name: 'Delhi' },
  { code: 'IN-JK', name: 'Jammu and Kashmir' },
  { code: 'IN-LA', name: 'Ladakh' },
  { code: 'IN-LD', name: 'Lakshadweep' },
  { code: 'IN-PY', name: 'Puducherry' },
];

/**
 * Loose comparison used by the PIN import to line India Post's state names up
 * with the seeded ones ("ANDAMAN & NICOBAR ISLANDS" vs "Andaman and Nicobar
 * Islands").
 */
export function normalizeStateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CouncilSeed {
  code: string;
  name: string;
  kind: 'medical' | 'pharmacy' | 'nursing' | 'other';
  stateName: string | null;
}

const councilKindsByState: Array<{
  prefix: string;
  kind: CouncilSeed['kind'];
  suffix: string;
}> = [
  { prefix: 'smc', kind: 'medical', suffix: 'Medical Council' },
  { prefix: 'spc', kind: 'pharmacy', suffix: 'Pharmacy Council' },
  { prefix: 'snc', kind: 'nursing', suffix: 'Nursing Council' },
];

export const councilSeeds: CouncilSeed[] = [
  {
    code: 'nmc',
    name: 'National Medical Commission',
    kind: 'medical',
    stateName: null,
  },
  ...stateSeeds.flatMap((state) => {
    const suffix = state.code.replace('IN-', '').toLowerCase();
    return councilKindsByState.map((kind) => ({
      // Union territories have no state council of their own; they are seeded
      // anyway so the list is complete and can be retired in the admin UI.
      code: `${kind.prefix}-${suffix}`,
      name: `${state.name} ${kind.suffix}`,
      kind: kind.kind,
      stateName: state.name,
    }));
  }),
];

export interface SpecialtySeed {
  code: string;
  name: string;
  systemOfMedicine: string;
}

export const specialtySeeds: SpecialtySeed[] = [
  { code: 'general-medicine', name: 'General Medicine', systemOfMedicine: 'allopathy' },
  { code: 'general-surgery', name: 'General Surgery', systemOfMedicine: 'allopathy' },
  { code: 'paediatrics', name: 'Paediatrics', systemOfMedicine: 'allopathy' },
  {
    code: 'obstetrics-gynaecology',
    name: 'Obstetrics & Gynaecology',
    systemOfMedicine: 'allopathy',
  },
  { code: 'orthopaedics', name: 'Orthopaedics', systemOfMedicine: 'allopathy' },
  { code: 'dermatology', name: 'Dermatology', systemOfMedicine: 'allopathy' },
  {
    code: 'ent',
    name: 'Otorhinolaryngology (ENT)',
    systemOfMedicine: 'allopathy',
  },
  { code: 'ophthalmology', name: 'Ophthalmology', systemOfMedicine: 'allopathy' },
  { code: 'psychiatry', name: 'Psychiatry', systemOfMedicine: 'allopathy' },
  { code: 'cardiology', name: 'Cardiology', systemOfMedicine: 'allopathy' },
  { code: 'neurology', name: 'Neurology', systemOfMedicine: 'allopathy' },
  { code: 'pulmonology', name: 'Pulmonology', systemOfMedicine: 'allopathy' },
  { code: 'gastroenterology', name: 'Gastroenterology', systemOfMedicine: 'allopathy' },
  { code: 'nephrology', name: 'Nephrology', systemOfMedicine: 'allopathy' },
  { code: 'endocrinology', name: 'Endocrinology', systemOfMedicine: 'allopathy' },
  { code: 'medical-oncology', name: 'Medical Oncology', systemOfMedicine: 'allopathy' },
  { code: 'urology', name: 'Urology', systemOfMedicine: 'allopathy' },
  { code: 'anaesthesiology', name: 'Anaesthesiology', systemOfMedicine: 'allopathy' },
  { code: 'radiology', name: 'Radiology', systemOfMedicine: 'allopathy' },
  { code: 'pathology', name: 'Pathology', systemOfMedicine: 'allopathy' },
  { code: 'emergency-medicine', name: 'Emergency Medicine', systemOfMedicine: 'allopathy' },
  { code: 'family-medicine', name: 'Family Medicine', systemOfMedicine: 'allopathy' },
  { code: 'general-dentistry', name: 'General Dentistry', systemOfMedicine: 'dental' },
  {
    code: 'orthodontics',
    name: 'Orthodontics & Dentofacial Orthopaedics',
    systemOfMedicine: 'dental',
  },
  { code: 'ayurveda-general', name: 'Ayurveda (General)', systemOfMedicine: 'ayurveda' },
  { code: 'homeopathy-general', name: 'Homeopathy (General)', systemOfMedicine: 'homeopathy' },
  { code: 'unani-general', name: 'Unani (General)', systemOfMedicine: 'unani' },
  { code: 'siddha-general', name: 'Siddha (General)', systemOfMedicine: 'siddha' },
  { code: 'physiotherapy-general', name: 'Physiotherapy', systemOfMedicine: 'physiotherapy' },
];

export interface ServiceCategorySeed {
  code: string;
  name: string;
  providerType: ProviderType;
}

export const serviceCategorySeeds: ServiceCategorySeed[] = [
  // Home care (field spec 5.2)
  {
    code: 'cp-non-clinical-attendant',
    name: 'Non-clinical attendant',
    providerType: 'care_provider',
  },
  { code: 'cp-registered-nursing', name: 'Registered nursing', providerType: 'care_provider' },
  { code: 'cp-physiotherapy', name: 'Physiotherapy at home', providerType: 'care_provider' },
  {
    code: 'cp-post-discharge',
    name: 'Post-discharge assistance',
    providerType: 'care_provider',
  },
  { code: 'cp-elder-support', name: 'Elder support', providerType: 'care_provider' },
  { code: 'cp-palliative-support', name: 'Palliative support', providerType: 'care_provider' },
  { code: 'cp-equipment-assistance', name: 'Equipment assistance', providerType: 'care_provider' },
  { code: 'cp-other', name: 'Other home-care service', providerType: 'care_provider' },

  // Clinic types (field spec 6.1)
  { code: 'clinic-single-doctor', name: 'Single-doctor clinic', providerType: 'clinic' },
  { code: 'clinic-multi-specialty', name: 'Multi-specialty clinic', providerType: 'clinic' },
  { code: 'clinic-polyclinic', name: 'Polyclinic', providerType: 'clinic' },
  { code: 'clinic-dental', name: 'Dental clinic', providerType: 'clinic' },
  { code: 'clinic-ayush', name: 'AYUSH clinic', providerType: 'clinic' },
  {
    code: 'clinic-physiotherapy-rehab',
    name: 'Physiotherapy / rehabilitation centre',
    providerType: 'clinic',
  },
  {
    code: 'clinic-day-care',
    name: 'Day-care / minor procedure centre',
    providerType: 'clinic',
  },
  { code: 'clinic-other', name: 'Other clinic', providerType: 'clinic' },

  // Diagnostic services (field spec 8.2)
  { code: 'dc-pathology', name: 'Pathology', providerType: 'diagnostic_centre' },
  { code: 'dc-radiology', name: 'Radiology', providerType: 'diagnostic_centre' },
  { code: 'dc-ultrasound', name: 'Ultrasound', providerType: 'diagnostic_centre' },
  {
    code: 'dc-prenatal-diagnostics',
    name: 'Prenatal diagnostics',
    providerType: 'diagnostic_centre',
  },
  { code: 'dc-cardiology-tests', name: 'Cardiology tests', providerType: 'diagnostic_centre' },
  { code: 'dc-health-packages', name: 'Health packages', providerType: 'diagnostic_centre' },
  { code: 'dc-other', name: 'Other diagnostic service', providerType: 'diagnostic_centre' },

  // Pharmacy product categories (field spec 7.1, 7.3). The agreements leave the
  // final list to Schedule A, so these follow the licence scopes named there.
  {
    code: 'ph-prescription-medicines',
    name: 'Prescription medicines',
    providerType: 'pharmacy',
  },
  { code: 'ph-otc-medicines', name: 'Over-the-counter medicines', providerType: 'pharmacy' },
  { code: 'ph-schedule-h', name: 'Schedule H medicines', providerType: 'pharmacy' },
  { code: 'ph-schedule-h1', name: 'Schedule H1 medicines', providerType: 'pharmacy' },
  { code: 'ph-schedule-x', name: 'Schedule X medicines', providerType: 'pharmacy' },
  {
    code: 'ph-narcotics-psychotropics',
    name: 'Narcotics & psychotropics',
    providerType: 'pharmacy',
  },
  {
    code: 'ph-nutrition-food',
    name: 'Nutrition & food products (FSSAI)',
    providerType: 'pharmacy',
  },
  { code: 'ph-medical-devices', name: 'Medical devices', providerType: 'pharmacy' },
  { code: 'ph-other', name: 'Other product category', providerType: 'pharmacy' },
];

export interface FacilityTypeSeed {
  code: string;
  name: string;
}

export const facilityTypeSeeds: FacilityTypeSeed[] = [
  { code: 'clinic', name: 'Clinic' },
  { code: 'pharmacy-store', name: 'Pharmacy store' },
  { code: 'lab', name: 'Laboratory' },
  { code: 'collection-centre', name: 'Sample collection centre' },
  { code: 'imaging-centre', name: 'Imaging centre' },
  { code: 'home-care-office', name: 'Home-care office' },
  { code: 'hospital-opd', name: 'Hospital OPD' },
  { code: 'other', name: 'Other' },
];

export interface LicenceTypeSeed {
  code: string;
  name: string;
  applicableProviderTypes: ProviderType[];
}

const allProviderTypes: ProviderType[] = [
  'doctor',
  'clinic',
  'pharmacy',
  'diagnostic_centre',
  'care_provider',
];

export const licenceTypeSeeds: LicenceTypeSeed[] = [
  {
    code: 'medical-registration',
    name: 'Medical registration (NMC / State Medical Council)',
    applicableProviderTypes: ['doctor', 'clinic'],
  },
  {
    code: 'clinical-establishment',
    name: 'Clinical establishment registration',
    applicableProviderTypes: ['clinic', 'diagnostic_centre', 'care_provider'],
  },
  {
    code: 'drug-licence',
    name: 'Drug licence (Form 20/21 or equivalent)',
    applicableProviderTypes: ['pharmacy'],
  },
  {
    code: 'pharmacist-registration',
    name: 'Pharmacist registration (State Pharmacy Council)',
    applicableProviderTypes: ['pharmacy'],
  },
  {
    code: 'nabl-accreditation',
    name: 'NABL accreditation',
    applicableProviderTypes: ['diagnostic_centre'],
  },
  {
    code: 'pcpndt-registration',
    name: 'PC-PNDT registration',
    applicableProviderTypes: ['diagnostic_centre'],
  },
  {
    code: 'aerb-permission',
    name: 'AERB permission (radiation equipment)',
    applicableProviderTypes: ['clinic', 'diagnostic_centre'],
  },
  {
    code: 'biomedical-waste',
    name: 'Biomedical waste authorisation',
    applicableProviderTypes: ['clinic', 'diagnostic_centre', 'care_provider'],
  },
  {
    code: 'fssai-licence',
    name: 'FSSAI licence',
    applicableProviderTypes: ['pharmacy'],
  },
  {
    code: 'nursing-registration',
    name: 'Nursing registration (State Nursing Council)',
    applicableProviderTypes: ['care_provider'],
  },
  {
    code: 'physiotherapy-registration',
    name: 'Physiotherapy registration',
    applicableProviderTypes: ['care_provider'],
  },
  {
    code: 'professional-indemnity',
    name: 'Professional indemnity insurance',
    applicableProviderTypes: allProviderTypes,
  },
];

export interface DocumentTypeSeed {
  code: string;
  name: string;
  providerTypes: ProviderType[];
  requiresExpiry: boolean;
  expiryReminderDays: number[];
}

/** Section 10 of the field spec: remind 60, 30 and 7 days before expiry. */
const licenceReminders = [60, 30, 7];

export const documentTypeSeeds: DocumentTypeSeed[] = [
  {
    code: 'medical-registration-certificate',
    name: 'Medical registration certificate',
    providerTypes: ['doctor', 'clinic'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'qualification-certificate',
    name: 'Qualification certificate',
    providerTypes: ['doctor', 'clinic'],
    requiresExpiry: false,
    expiryReminderDays: [],
  },
  {
    code: 'specialty-certificate',
    name: 'Specialty qualification certificate',
    providerTypes: ['doctor'],
    requiresExpiry: false,
    expiryReminderDays: [],
  },
  {
    code: 'establishment-licence',
    name: 'Clinical establishment registration certificate',
    providerTypes: ['clinic', 'diagnostic_centre', 'care_provider'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'drug-licence',
    name: 'Drug licence',
    providerTypes: ['pharmacy'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'pharmacist-registration',
    name: 'Pharmacist registration certificate',
    providerTypes: ['pharmacy'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'fssai-licence',
    name: 'FSSAI licence',
    providerTypes: ['pharmacy'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'nabl-certificate',
    name: 'NABL accreditation certificate',
    providerTypes: ['diagnostic_centre'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'pcpndt-registration',
    name: 'PC-PNDT registration',
    providerTypes: ['diagnostic_centre'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'aerb-permission',
    name: 'AERB permission',
    providerTypes: ['clinic', 'diagnostic_centre'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'biomedical-waste-authorisation',
    name: 'Biomedical waste authorisation',
    providerTypes: ['clinic', 'diagnostic_centre', 'care_provider'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'lab-director-credentials',
    name: 'Laboratory director credentials',
    providerTypes: ['diagnostic_centre'],
    requiresExpiry: false,
    expiryReminderDays: [],
  },
  {
    code: 'nursing-registration-certificate',
    name: 'Nursing registration certificate',
    providerTypes: ['care_provider'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'physiotherapy-registration-certificate',
    name: 'Physiotherapy registration certificate',
    providerTypes: ['care_provider'],
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'background-check-policy',
    name: 'Background check policy',
    providerTypes: ['care_provider'],
    requiresExpiry: false,
    expiryReminderDays: [],
  },
  {
    code: 'safeguarding-policy',
    name: 'Safeguarding policy',
    providerTypes: ['care_provider'],
    requiresExpiry: false,
    expiryReminderDays: [],
  },
  {
    code: 'incident-escalation-protocol',
    name: 'Incident and emergency escalation protocol',
    providerTypes: ['care_provider'],
    requiresExpiry: false,
    expiryReminderDays: [],
  },
  {
    code: 'insurance-policy',
    name: 'Insurance policy',
    providerTypes: allProviderTypes,
    requiresExpiry: true,
    expiryReminderDays: licenceReminders,
  },
  {
    code: 'signatory-authority',
    name: 'Signatory authority document',
    providerTypes: ['clinic', 'pharmacy', 'diagnostic_centre', 'care_provider'],
    requiresExpiry: false,
    expiryReminderDays: [],
  },
  {
    code: 'signed-agreement',
    name: 'Signed partner agreement',
    providerTypes: allProviderTypes,
    requiresExpiry: false,
    expiryReminderDays: [],
  },
];
