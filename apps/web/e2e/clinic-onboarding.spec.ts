import { expect, test, type Page } from '@playwright/test';
import {
  formSectionsFor,
  locationTypes,
  type ProviderField,
  type ProviderSection,
} from '@curenear/shared';

const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-operator@curenear.in';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-operator-password-123';
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

function scalar(field: ProviderField): unknown {
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
    case 'repeater': {
      const row: Record<string, unknown> = {};
      for (const item of field.items ?? []) {
        row[item.key] = scalar({
          key: item.key,
          label: item.label,
          type: item.type,
          requirement: 'required',
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

async function seedCompleteClinic(
  page: Page,
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

  async function send(method: 'post' | 'patch', path: string, data: unknown): Promise<unknown> {
    const response = await api[method](`${baseURL}${path}`, { headers, data });
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
    return (await response.json()).data;
  }

  const sections = formSectionsFor('clinic').filter((section) => !section.notInProviderForm);
  const contactRoles = new Set<string>(['signatory', 'legal_notice']);
  const documentRoles = new Set<string>();
  const licenceRoles = new Set<string>();
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.storage.kind !== 'related') continue;
      if (field.storage.table === 'provider_contacts' && field.storage.role) {
        contactRoles.add(field.storage.role);
      }
      if (field.storage.table === 'provider_documents') {
        documentRoles.add(field.storage.role ?? field.key);
      }
      if (field.storage.table === 'provider_licences' && field.storage.role) {
        licenceRoles.add(field.storage.role);
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

  await send('post', `/api/v1/providers/${id}/service-pins`, {
    pin_code: '700091',
    service_kind: 'service',
  });
  await send('post', `/api/v1/providers/${id}/insurance`, {
    type: 'professional indemnity',
    insurer: 'Test Insurer',
    policy_no: `POL-${unique}`,
    limit_paise: 100000,
    valid_from: '2026-01-01',
    valid_to: '2027-01-01',
  });

  for (const role of licenceRoles) {
    await send('post', `/api/v1/providers/${id}/licences`, {
      role,
      number: `LIC-${role}-${unique}`,
      // "Other licences" is a registry repeater whose name is required.
      ...(role === 'other' ? { details: { name: 'Other licence' } } : {}),
    });
  }
  await send('post', `/api/v1/providers/${id}/licences`, { number: `LIC-GENERAL-${unique}` });

  for (const role of documentRoles) {
    await send('post', `/api/v1/providers/${id}/documents`, {
      file_name: `${role}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 1024,
      role,
    });
  }

  for (let pass = 0; pass < 2; pass += 1) {
    for (const section of sections) {
      const data = sectionPayload(section);
      if (section.key === 'legal_entity') {
        data.legal_name = legalName;
        data.trade_name = legalName;
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
  expect(detail.completeness.missingRequiredFields).toEqual([]);
  expect(detail.completeness.complete).toBe(true);
}

async function addDoctor(
  page: Page,
  doctor: {
    name: string;
    mobile: string;
    registration: string;
    council: string;
    system: string;
    specialty: string;
    degree: string;
    institution: string;
  },
): Promise<void> {
  await page.getByLabel('Full name (with title)').fill(doctor.name);
  await page.getByLabel('Doctor mobile').fill(doctor.mobile);
  await page.getByLabel('Medical registration number').fill(doctor.registration);
  await page.getByLabel('Registering authority / council').selectOption(doctor.council);
  await page.getByLabel('System of medicine').selectOption(doctor.system);
  await page.getByLabel('Recognized specialty').selectOption(doctor.specialty);

  await page.getByRole('button', { name: 'Add row' }).first().click();
  await page.getByLabel('Degree').fill(doctor.degree);
  await page.getByLabel('University / institution').fill(doctor.institution);
  await page.getByLabel('Year').fill('2015');

  await page.getByLabel('Role at this clinic').selectOption('full-time consultant');
  await page.getByRole('button', { name: 'Add row' }).last().click();
  await page.getByLabel('Day').selectOption('Monday');
  await page.getByLabel('Start (HH:MM)').fill('09:00');
  await page.getByLabel('End (HH:MM)').fill('13:00');
  await page.getByLabel('Slot duration (minutes)').fill('15');
  await page.getByLabel('In-clinic consultation fee (INR)').fill('800');
  await page.getByLabel('Clinic attestation').check();
  await page.getByRole('button', { name: 'Add doctor', exact: true }).click();
  await expect(page.getByText(doctor.name, { exact: false })).toBeVisible({ timeout: 60_000 });
}

test.describe('clinic onboarding', () => {
  // Seeding every section compiles each API route on its first dev hit.
  test.setTimeout(240_000);

  test('staff adds two doctors, selects an in-charge and submits the clinic', async ({ page }) => {
    const unique = Date.now().toString().slice(-7);
    const legalName = `E2E Doctors Clinic ${unique}`;
    const mobile = `9${unique}${unique.slice(0, 2)}`.slice(0, 10);
    const pin = `7${unique}`.slice(0, 6);

    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    await page.goto('/staff/providers/new');
    await page.getByRole('button', { name: /^Clinic/ }).click();
    await page.getByLabel('Legal name').fill(legalName);
    await page.getByLabel('Mobile number').fill(mobile);
    await page.getByLabel('Primary PIN code').fill(pin);
    // A freshly compiled route can paint before React hydrates, so retry.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.getByRole('button', { name: 'Create draft' }).click({ timeout: 5000 });
      } catch {
        // already submitting
      }
      try {
        await page.waitForURL(/\/staff\/providers\/[0-9a-f-]+\/edit/, { timeout: 20_000 });
        break;
      } catch {
        // hydration had not attached yet
      }
    }
    await expect(page).toHaveURL(/\/staff\/providers\/[0-9a-f-]+\/edit/, { timeout: 20_000 });
    const id = page.url().match(/providers\/([0-9a-f-]+)\/edit/)?.[1] ?? '';

    await seedCompleteClinic(page, id, unique, legalName);

    await page.reload();
    await page.getByRole('button', { name: /^Doctors/ }).click();

    await addDoctor(page, {
      name: 'Dr Asha Roy',
      mobile: '9830012345',
      registration: `WBMC/A${unique}`,
      council: 'NMC',
      system: 'allopathy',
      specialty: 'general medicine',
      degree: 'MBBS',
      institution: 'Medical College Kolkata',
    });
    await addDoctor(page, {
      name: 'Dr Rohan Das',
      mobile: '9830012346',
      registration: `WBMC/B${unique}`,
      council: 'West Bengal Medical Council',
      system: 'allopathy',
      specialty: 'general surgery',
      degree: 'MS',
      institution: 'Calcutta Medical College',
    });

    await page.getByRole('radio').first().click();
    await expect(page.getByRole('radio').first()).toBeChecked();

    await page.getByRole('button', { name: 'Review and submit' }).click();
    await page.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(page.getByText('Submitted for verification')).toBeVisible();

    await page.goto('/staff/providers');
    await expect(page.getByText(legalName)).toBeVisible();
  });
});
