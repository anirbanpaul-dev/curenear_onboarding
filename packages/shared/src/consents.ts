import type { ProviderType } from './enums';

/**
 * Consent, declarations and agreement definitions (field spec 3.9 and 9.1).
 *
 * A consent is captured as a `consent_records` row holding the exact text
 * version the provider saw. Declarations are one row per declaration key, so a
 * later wording change never rewrites what someone accepted.
 */

export const consentTypes = [
  'publication',
  'data_privacy_notice',
  'declarations',
  'doctor_confirmation',
  'agreement',
] as const;
export type ConsentType = (typeof consentTypes)[number];

export const consentTypeLabels: Record<ConsentType, string> = {
  publication: 'Publication permission',
  data_privacy_notice: 'Data privacy notice',
  declarations: 'Declarations',
  doctor_confirmation: 'Doctor confirmation',
  agreement: 'Partner agreement',
};

export const consentMethods = [
  'SIGNED_FORM_UPLOAD',
  'OTP',
  'LINK_CONFIRMATION',
  'IN_PERSON_ATTESTATION',
] as const;
export type ConsentMethod = (typeof consentMethods)[number];

export const consentMethodLabels: Record<ConsentMethod, string> = {
  SIGNED_FORM_UPLOAD: 'Signed form uploaded',
  OTP: 'SMS OTP',
  LINK_CONFIRMATION: 'Confirmation link',
  IN_PERSON_ATTESTATION: 'Attested in person',
};

/** Bumped whenever any declaration text below changes. */
export const consentTextVersion = '2026-11-21';

export interface DeclarationDefinition {
  key: string;
  label: string;
  text: string;
}

/** Section 3.9 — every provider type. */
export const commonDeclarations: DeclarationDefinition[] = [
  {
    key: 'decl_accuracy',
    label: 'Accuracy',
    text: 'All submitted information is accurate and complete.',
  },
  {
    key: 'decl_authority',
    label: 'Authority',
    text: 'I have authority to sign for this entity.',
  },
  {
    key: 'decl_licences',
    label: 'Licences',
    text: 'I hold all licences and registrations required for my actual activities.',
  },
  {
    key: 'decl_notify_changes',
    label: 'Change notices',
    text: 'I will notify CureNear of suspension, expiry, cancellation or regulatory action within the period set for my provider type.',
  },
  {
    key: 'decl_verification',
    label: 'Verification',
    text: 'I consent to CureNear verifying my credentials with registries and authorities.',
  },
  {
    key: 'decl_no_referral_incentive',
    label: 'No inducements',
    text: 'I will not offer or accept unlawful referral commissions, fee-splitting or inducements.',
  },
  {
    key: 'decl_no_misleading_claims',
    label: 'No misleading claims',
    text: 'I will not make guaranteed-cure, false accreditation or misleading claims.',
  },
  {
    key: 'decl_privacy_ack',
    label: 'Privacy notice',
    text: 'I have read the Privacy Notice and understand the data roles.',
  },
];

const clinicDeclarations: DeclarationDefinition[] = [
  {
    key: 'decl_clinic_doctors',
    label: 'Listed doctors',
    text: 'All doctors listed are registered and have agreed to be listed.',
  },
  {
    key: 'decl_clinic_licences',
    label: 'Clinic registrations',
    text: 'The clinic holds all registrations required for its actual activities.',
  },
  {
    key: 'decl_clinic_ethics',
    label: 'Advertising',
    text: 'The clinic will not use testimonials, before-and-after photographs or prohibited advertising.',
  },
  {
    key: 'decl_clinic_no_referral',
    label: 'No inducements',
    text: 'The clinic will not pay or accept referral commissions or fee-splitting.',
  },
];

const pharmacyDeclarations: DeclarationDefinition[] = [
  {
    key: 'decl_ph_quality',
    label: 'Medicine quality',
    text: 'I will not supply expired, counterfeit, spurious, recalled or unlawfully stocked medicines.',
  },
  {
    key: 'decl_ph_sourcing',
    label: 'Lawful sourcing',
    text: 'I will source only from lawful suppliers and keep statutory records.',
  },
  {
    key: 'decl_ph_blocking',
    label: 'Category blocking',
    text: 'I understand CureNear may block categories or workflows pending legal review.',
  },
];

const doctorDeclarations: DeclarationDefinition[] = [
  {
    key: 'decl_doc_ethics',
    label: 'Professional advertising',
    text: 'I will not use testimonials, before-and-after photographs or prohibited advertising.',
  },
];

const typeDeclarations: Partial<Record<ProviderType, DeclarationDefinition[]>> = {
  clinic: clinicDeclarations,
  pharmacy: pharmacyDeclarations,
  doctor: doctorDeclarations,
};

/** Common declarations plus the declarations for this provider type. */
export function declarationsFor(providerType: ProviderType): DeclarationDefinition[] {
  return [...commonDeclarations, ...(typeDeclarations[providerType] ?? [])];
}

export function declarationByKey(
  providerType: ProviderType,
  key: string,
): DeclarationDefinition | undefined {
  return declarationsFor(providerType).find((entry) => entry.key === key);
}

export const agreementDeferredNote =
  'Commercial Schedule B and bank details are deferred. This agreement implies no rate and no commission accrues until Schedule B is signed.';

export interface AgreementTemplateDefinition {
  providerType: ProviderType;
  name: string;
  version: string;
  effectiveFrom: string;
  body: string;
}

const agreementBody = (typeName: string): string =>
  [
    `CURENEARN ${typeName.toUpperCase()} PARTNER AGREEMENT`,
    '',
    `This agreement is between CureNear ("the Platform") and {{provider_name}} ({{provider_code}}), a ${typeName.toLowerCase()} provider ("the Provider").`,
    '',
    '1. APPOINTMENT',
    'The Provider is appointed to make its services available through the Platform on the terms of this agreement and its Schedules.',
    '',
    '2. REPRESENTATIONS',
    'The Provider confirms that every statement, licence, registration and document submitted during onboarding is true, complete and current, and that the person signing has authority to bind the Provider.',
    '',
    '3. REGULATORY COMPLIANCE',
    'The Provider will maintain every registration required for its actual activities and will notify the Platform of any suspension, expiry, cancellation or regulatory action within the period set for its provider type.',
    '',
    '4. PUBLICATION (SCHEDULE A)',
    'The Platform may publish only the profile fields the Provider has approved in Schedule A. Publication permission may be withdrawn at any time and takes effect when recorded.',
    '',
    '5. PRIVACY AND DATA ROLES',
    'The Provider acknowledges the Privacy Notice and will process personal data only for the purposes described in it.',
    '',
    '6. COMMERCIAL TERMS (SCHEDULE B - DEFERRED)',
    agreementDeferredNote,
    '',
    '7. TERM AND TERMINATION',
    'Either party may terminate on 30 days written notice, or immediately for a material breach that is not cured within 15 days of notice.',
    '',
    '8. GOVERNING LAW',
    'This agreement is governed by the laws of India, with courts in West Bengal having jurisdiction.',
    '',
    'EXECUTION',
    'Signed by: {{signatory_name}}',
    'Designation: {{designation}}',
    'For and on behalf of: {{provider_name}}',
    'Place: ______________________    Date: ______________________',
    'Signature: ___________________    Stamp reference: ______________',
    '',
    'CureNear acceptance: ______________________    Date: ______________',
  ].join('\n');

export const agreementTemplateDefinitions: AgreementTemplateDefinition[] = [
  {
    providerType: 'doctor',
    name: 'Doctor Partner Agreement',
    version: 'v1.0',
    effectiveFrom: '2026-11-14',
    body: agreementBody('Doctor'),
  },
  {
    providerType: 'pharmacy',
    name: 'Pharmacy Partner Agreement',
    version: 'v1.0',
    effectiveFrom: '2026-11-14',
    body: agreementBody('Pharmacy'),
  },
  {
    providerType: 'diagnostic_centre',
    name: 'Diagnostic Centre Partner Agreement',
    version: 'v1.0',
    effectiveFrom: '2026-11-14',
    body: agreementBody('Diagnostic centre'),
  },
  {
    providerType: 'care_provider',
    name: 'Home-Care Provider Partner Agreement',
    version: 'v1.0',
    effectiveFrom: '2026-11-14',
    body: agreementBody('Home-care provider'),
  },
  // No clinic template exists yet (field spec 9.1). Clinics accept the platform
  // terms only until counsel provides one.
];

export function agreementTemplateFor(
  providerType: ProviderType,
): AgreementTemplateDefinition | null {
  return agreementTemplateDefinitions.find((entry) => entry.providerType === providerType) ?? null;
}

export const confirmationLinkTtlHours = 48;

export interface ConsentRecordLike {
  consentType: ConsentType;
  revokedAt: Date | string | null;
  doctorProfileId?: string | null;
  confirmationMeta?: Record<string, unknown> | null;
}

export function isActiveConsent(record: ConsentRecordLike): boolean {
  return record.revokedAt === null || record.revokedAt === undefined;
}

export function declarationKeyOf(record: ConsentRecordLike): string | null {
  const key = record.confirmationMeta?.declarationKey;
  return typeof key === 'string' ? key : null;
}

export function hasActiveConsent(
  records: readonly ConsentRecordLike[],
  consentType: ConsentType,
  options: { declarationKey?: string; doctorProfileId?: string | null } = {},
): boolean {
  return records.some(
    (record) =>
      isActiveConsent(record) &&
      record.consentType === consentType &&
      (options.declarationKey === undefined ||
        declarationKeyOf(record) === options.declarationKey) &&
      (options.doctorProfileId === undefined ||
        (record.doctorProfileId ?? null) === options.doctorProfileId),
  );
}

export interface ConsentGap {
  kind: 'publication' | 'data_privacy_notice' | 'declaration' | 'agreement' | 'doctor_confirmation';
  key: string;
  label: string;
}

/**
 * What still blocks submission. Kept pure so the same rule drives the wizard,
 * the API and the tests.
 */
export function consentGaps(input: {
  providerType: ProviderType;
  records: readonly ConsentRecordLike[];
  agreementRequired: boolean;
  clinicDoctorProfileIds?: readonly string[];
}): ConsentGap[] {
  const gaps: ConsentGap[] = [];

  if (!hasActiveConsent(input.records, 'publication')) {
    gaps.push({
      kind: 'publication',
      key: 'publication',
      label: 'Publication permission for the approved profile fields',
    });
  }
  if (!hasActiveConsent(input.records, 'data_privacy_notice')) {
    gaps.push({
      kind: 'data_privacy_notice',
      key: 'data_privacy_notice',
      label: 'Data privacy notice acknowledgement',
    });
  }
  for (const declaration of declarationsFor(input.providerType)) {
    if (!hasActiveConsent(input.records, 'declarations', { declarationKey: declaration.key })) {
      gaps.push({ kind: 'declaration', key: declaration.key, label: declaration.label });
    }
  }
  if (input.agreementRequired && !hasActiveConsent(input.records, 'agreement')) {
    gaps.push({ kind: 'agreement', key: 'agreement', label: 'Signed partner agreement' });
  }
  for (const doctorProfileId of input.clinicDoctorProfileIds ?? []) {
    if (
      !hasActiveConsent(input.records, 'doctor_confirmation', {
        doctorProfileId,
      })
    ) {
      gaps.push({
        kind: 'doctor_confirmation',
        key: doctorProfileId,
        label: 'Doctor confirmation for a clinic-added doctor',
      });
    }
  }
  return gaps;
}
