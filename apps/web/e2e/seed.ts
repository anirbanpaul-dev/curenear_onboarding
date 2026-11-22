import { expect, type Page } from '@playwright/test';
import {
  declarationsFor,
  formSectionsFor,
  locationTypes,
  sectionsForProvider,
  type ProviderField,
  type ProviderSection,
  type ProviderType,
} from '@curenear/shared';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const uploadedPdf = () => ({
  fileName: 'document.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  uploadedAt: new Date().toISOString(),
  uploadedBy: '11111111-1111-4111-8111-111111111111',
});

/** A plausible value for any registry field, used to fill the common sections. */
export function scalar(field: ProviderField): unknown {
  const options = field.validation?.options ?? [];
  switch (field.type) {
    case 'email':
      return 'clinic@example.com';
    case 'phone':
      return '9830012345';
    case 'url':
      return 'https://example.com';
    case 'select':
      return options[0] ?? 'other';
    case 'multiselect':
      return [options[0] ?? 'other'];
    case 'boolean':
      return true;
    case 'number':
      return 1;
    case 'money':
      return 1000;
    case 'date':
      return '2027-01-01';
    case 'time':
      return '09:00';
    case 'pin':
      return '700091';
    case 'pinlist':
      return ['700091'];
    case 'address':
      return { line1: '1 Test Street', city: 'Kolkata', state: 'West Bengal', pin: '700091' };
    case 'geo':
      return { lat: 22.5726, lng: 88.3639 };
    case 'file':
      return uploadedPdf();
    case 'repeater': {
      const row: Record<string, unknown> = {};
      for (const item of field.items ?? []) {
        row[item.key] = scalar({
          key: item.key,
          label: item.label,
          type: item.type,
          requirement: item.requirement ?? 'required',
          section: field.section,
          clause: field.clause,
          storage: { kind: 'type_data' },
          validation: item.validation,
          items: item.items,
        });
      }
      return [row];
    }
    default:
      if (field.key === 'open' || field.key === 'start') return '09:00';
      if (field.key === 'close' || field.key === 'end') return '18:00';
      return 'Test value';
  }
}

function sectionPayload(section: ProviderSection): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of section.fields) {
    if (field.adminOnly || field.storage.kind === 'related') continue;
    if (field.requirement === 'optional') continue;
    payload[field.key] = scalar(field);
  }
  return payload;
}

/**
 * Fills every section of a provider through the API using the field registry,
 * so the type-specific work in an E2E test can stay in the UI.
 */
export async function seedCompleteProvider(
  page: Page,
  providerType: ProviderType,
  id: string,
  unique: string,
  legalName: string,
): Promise<void> {
  const api = page.request;
  const headers = { 'content-type': 'application/json' };

  async function getDetail(): Promise<{
    organization: { version: number };
    completeness: { complete: boolean; missingRequiredFields: string[] };
  }> {
    const response = await api.get(`${baseURL}/api/v1/providers/${id}`);
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  }

  async function send(
    method: 'post' | 'patch',
    path: string,
    data: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await api[method](`${baseURL}${path}`, { headers, data });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  }

  const sections = formSectionsFor(providerType).filter((section) => !section.notInProviderForm);
  const contactRoles = new Set<string>(['signatory', 'legal_notice']);
  const documentRoles = new Set<string>();
  const licenceFields: ProviderField[] = [];
  const pinKinds = new Set<string>(['service']);

  for (const section of sections) {
    for (const field of section.fields) {
      if (field.storage.kind !== 'related') continue;
      if (
        field.storage.table === 'provider_licences' &&
        field.storage.role &&
        (field.items?.length ?? 0) === 0
      ) {
        licenceFields.push(field);
      }
      if (field.storage.table === 'provider_contacts' && field.storage.role) {
        contactRoles.add(field.storage.role);
      }
      if (field.storage.table === 'provider_documents') {
        documentRoles.add(field.storage.role ?? field.key);
      }
      if (
        field.storage.table === 'provider_licences' &&
        field.storage.role &&
        (field.items?.length ?? 0) > 0
      ) {
        licenceFields.push(field);
      }
      if (field.storage.table === 'provider_service_pins' && field.storage.role) {
        pinKinds.add(field.storage.role);
      }
    }
  }

  await send('post', `/api/v1/providers/${id}/locations`, {
    name: 'Registered office',
    location_type: locationTypes[0],
    address_line1: '1 Test Street',
    city: 'Kolkata',
    pin_code: '700091',
    is_primary: true,
  });

  for (const role of contactRoles) {
    await send('post', `/api/v1/providers/${id}/contacts`, {
      role,
      name: 'Test Contact',
      phone: '9830012345',
      ...(role === 'legal_notice'
        ? {
            email: 'legal@example.com',
            address: {
              line1: '1 Test Street',
              city: 'Kolkata',
              state: 'West Bengal',
              pin: '700091',
            },
          }
        : {}),
    });
  }

  for (const kind of pinKinds) {
    await send('post', `/api/v1/providers/${id}/service-pins`, {
      pin_code: '700091',
      service_kind: kind,
    });
  }

  await send('post', `/api/v1/providers/${id}/insurance`, {
    type: 'professional indemnity',
    insurer: 'Test Insurer',
    policy_no: `POL-${unique}`,
    limit_paise: 100000,
    valid_from: '2026-01-01',
    valid_to: '2027-01-01',
  });

  for (const field of licenceFields) {
    const role = field.storage.kind === 'related' ? (field.storage.role ?? '') : '';
    // A text licence field (`dc_bmw`, `ph_fssai`) is a single licence row.
    if ((field.items?.length ?? 0) === 0) {
      await send('post', `/api/v1/providers/${id}/licences`, {
        role,
        number: `LIC-${role}-${providerType}-${unique}`,
      });
      continue;
    }
    const itemKeys = new Set((field.items ?? []).map((item) => item.key));
    const details: Record<string, unknown> = { role };
    let number = `LIC-${role}-${providerType}-${unique}`;
    let authority = 'Test Authority';
    let issuedOn: string | undefined;
    let validFrom: string | undefined;
    let validTo = '2027-01-01';
    const needsDocument = (field.items ?? []).some(
      (item) => item.type === 'file' && item.requirement === 'required',
    );
    for (const item of field.items ?? []) {
      if (item.type === 'file' || item.key === 'number') continue;
      const value = scalar({
        key: item.key,
        label: item.label,
        type: item.type,
        requirement: item.requirement ?? 'required',
        section: field.section,
        clause: field.clause,
        storage: { kind: 'type_data' },
        validation: item.validation,
      });
      if (item.key === 'number' && typeof value === 'string') number = value;
      else if (item.key === 'authority' && typeof value === 'string') authority = value;
      else if (item.key === 'issue_date' && typeof value === 'string') issuedOn = value;
      else if (item.key === 'valid_from' && typeof value === 'string') validFrom = value;
      else if (item.key === 'valid_to' && typeof value === 'string') validTo = value;
      else details[item.key] = value;
    }

    const document = needsDocument
      ? await send('post', `/api/v1/providers/${id}/documents`, {
          file_name: `${role}.pdf`,
          mime_type: 'application/pdf',
          size_bytes: 1024,
          role: `${role}_certificate`,
        })
      : null;

    await send('post', `/api/v1/providers/${id}/licences`, {
      role,
      number,
      ...(itemKeys.has('authority') ? { authority } : {}),
      ...(issuedOn ? { issued_on: issuedOn } : {}),
      ...(validFrom ? { valid_from: validFrom } : {}),
      ...(itemKeys.has('valid_to') && validTo ? { valid_to: validTo } : {}),
      ...(document ? { document_id: document.id } : {}),
      details,
    });
  }

  await send('post', `/api/v1/providers/${id}/licences`, {
    number: `LIC-GENERAL-${providerType}-${unique}`,
  });

  for (const role of documentRoles) {
    await send('post', `/api/v1/providers/${id}/documents`, {
      file_name: `${role}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 1024,
      role,
    });
  }

  if (providerType === 'doctor') {
    // Doctors are individuals, so the shared form omits the legal-entity step;
    // the completeness gate still expects the organization's legal identity.
    const legalEntity = sectionsForProvider('doctor').find(
      (section) => section.key === 'legal_entity',
    );
    const constitution = legalEntity?.fields.find((field) => field.key === 'constitution_type');
    const current = await getDetail();
    await send('patch', `/api/v1/providers/${id}/sections/legal_entity`, {
      version: current.organization.version,
      data: {
        legal_name: legalName,
        trade_name: legalName,
        ...(constitution ? { constitution_type: scalar(constitution) } : {}),
      },
    });

    const identity = sections.find((section) => section.key === 'doctor_identity')?.fields ?? [];
    const fieldValue = (key: string): unknown => {
      const field = identity.find((entry) => entry.key === key);
      return field ? scalar(field) : undefined;
    };
    const identityVersion = (await getDetail()).organization.version;
    await send('patch', `/api/v1/providers/${id}/doctor-profile`, {
      version: identityVersion,
      section: 'doctor_identity',
      data: {
        doc_full_name: `Dr ${unique}`,
        doc_reg_no: `REG-${providerType}-${unique}`,
        doc_reg_council: fieldValue('doc_reg_council'),
        doc_system: fieldValue('doc_system'),
        doc_reg_date: '2026-01-01',
      },
    });
    const qualificationsVersion = (await getDetail()).organization.version;
    await send('patch', `/api/v1/providers/${id}/doctor-profile`, {
      version: qualificationsVersion,
      section: 'doctor_qualifications',
      data: {
        doc_qualifications: [{ degree: 'MBBS', institution: 'Test University', year: 2015 }],
      },
    });
    await send('post', `/api/v1/providers/${id}/doctor-practices`, {
      practice_type: 'own clinic',
      address: {
        line1: '1 Test Street',
        city: 'Kolkata',
        state: 'West Bengal',
        pin: '700091',
      },
      timings: [{ day: 'Monday', start: '09:00', end: '13:00' }],
      fee_paise: 50000,
      public_contact: '9830012345',
    });
  }

  // Every provider type must record its publication/privacy consents, its
  // declarations and (when one is published) its partner agreement.
  const overview = await api.get(`${baseURL}/api/v1/providers/${id}/consents`);
  expect(overview.ok(), await overview.text()).toBe(true);
  const overviewBody = (await overview.json()).data as {
    activeTemplate: { id: string } | null;
  };
  await send('post', `/api/v1/providers/${id}/consents`, {
    method: 'IN_PERSON_ATTESTATION',
    attestation_name: 'Test Signatory',
    items: [
      { consent_type: 'publication' },
      { consent_type: 'data_privacy_notice' },
      ...declarationsFor(providerType).map((declaration) => ({
        consent_type: 'declarations' as const,
        declaration_key: declaration.key,
      })),
    ],
  });
  if (overviewBody.activeTemplate) {
    await send('post', `/api/v1/providers/${id}/agreements`, {
      template_id: overviewBody.activeTemplate.id,
      method: 'IN_PERSON_ATTESTATION',
      signed_on: '2026-11-22',
      place: 'Kolkata',
      signatory_name: 'Test Signatory',
      signatory_designation: 'Director',
    });
  }

  let clinicInchargeDoctorId: string | null = null;
  if (providerType === 'clinic') {
    const doctor = await send('post', `/api/v1/providers/${id}/doctors`, {
      full_name: `Dr ${unique}`,
      mobile: `9${String(Date.now()).slice(-9)}`,
      registration_no: `CLINIC-REG-${unique}`,
      council: 'NMC',
      system_of_medicine: 'allopathy',
      specialty: 'general medicine',
      role_at_clinic: 'full-time consultant',
      timings: [{ day: 'Monday', start: '09:00', end: '13:00', slot_minutes: 15 }],
      fee_paise: 80000,
      clinic_attestation: true,
    });
    const link = doctor as {
      doctor?: { id: string };
      link?: { doctor?: { id: string } };
      id?: string;
    };
    const doctorId = link.doctor?.id ?? link.link?.doctor?.id ?? link.id;
    clinicInchargeDoctorId = doctorId ?? null;
    if (doctorId) {
      await send('post', `/api/v1/providers/${id}/consents`, {
        method: 'IN_PERSON_ATTESTATION',
        attestation_name: 'Dr Test Signatory',
        doctor_profile_id: doctorId,
        items: [{ consent_type: 'doctor_confirmation' }],
      });
    }
    const inchargeSection = sections.find((section) =>
      section.fields.some((field) => field.key === 'clinic_incharge'),
    );
    if (doctorId && inchargeSection) {
      const current = await getDetail();
      await send('patch', `/api/v1/providers/${id}/sections/${inchargeSection.key}`, {
        version: current.organization.version,
        data: { clinic_incharge: doctorId },
      });
    }
  }

  for (let pass = 0; pass < 2; pass += 1) {
    for (const section of sections) {
      const data = sectionPayload(section);
      if (section.key === 'legal_entity') {
        data.legal_name = legalName;
        data.trade_name = legalName;
      }
      if (section.key === 'diagnostic_services') {
        data.dc_highrisk_requests = ['ultrasound'];
      }
      if (clinicInchargeDoctorId && 'clinic_incharge' in data) {
        data.clinic_incharge = clinicInchargeDoctorId;
      }
      if (Object.keys(data).length === 0) continue;
      const detail = await getDetail();
      await send('patch', `/api/v1/providers/${id}/sections/${section.key}`, {
        version: detail.organization.version,
        data,
      });
    }
  }

  const detail = await getDetail();
  expect(detail.completeness.missingRequiredFields, 'seeded provider is complete').toEqual([]);
  // The doctor type's completeness flag also waits on its linked practice/consent
  // state; submission below is the authoritative gate for it.
  if (providerType !== 'doctor') {
    expect(detail.completeness.complete).toBe(true);
  }
}

export async function signIn(page: Page): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-operator@curenear.in';
  const password = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-operator-password-123';
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  // The first dev-server render can paint before React hydrates, so a click
  // sometimes lands on a dead button; retry until the redirect happens.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.getByRole('button', { name: 'Sign in' }).click({ timeout: 5000 });
    } catch {
      // a click already started the request; wait for it below
    }
    try {
      await page.waitForURL(/\/admin/, { timeout: 15_000 });
      break;
    } catch {
      // not hydrated yet
    }
  }
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 20_000 });
}

export async function createDraft(
  page: Page,
  providerLabel: RegExp,
  legalName: string,
  mobile: string,
  pin: string,
): Promise<string> {
  await page.goto('/staff/providers/new');
  await page.getByRole('button', { name: providerLabel }).click();
  await page.getByLabel('Legal name').fill(legalName);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Primary PIN code').fill(pin);
  // Same hydration race as the sign-in button on a freshly compiled route.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.getByRole('button', { name: 'Create draft' }).click({ timeout: 5000 });
    } catch {
      // already submitting; the wait below decides
    }
    try {
      await page.waitForURL(/\/staff\/providers\/[0-9a-f-]+\/edit/, { timeout: 20_000 });
      break;
    } catch {
      if (attempt === 2) {
        const alert = await page
          .locator('[role="alert"]')
          .first()
          .textContent()
          .catch(() => null);
        throw new Error(`Create draft did not navigate${alert ? `: ${alert}` : ''}`);
      }
    }
  }
  return page.url().match(/providers\/([0-9a-f-]+)\/edit/)?.[1] ?? '';
}

export async function submitProvider(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review and submit' }).click();
  await page.getByRole('button', { name: 'Submit for verification' }).click();
  // The submit route also compiles on its first dev run.
  const submitted = page.getByText('Submitted for verification');
  try {
    await expect(submitted).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    // A save racing the submit leaves the form one version behind; the wizard
    // offers a reload for exactly that case.
    const reload = page.getByRole('button', { name: 'Reload provider' });
    if (!(await reload.isVisible().catch(() => false))) throw error;
    await reload.click();
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(submitted).toBeVisible({ timeout: 60_000 });
  }
}
