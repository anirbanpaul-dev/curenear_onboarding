import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  createProviderSchema,
  createStaffSchema,
  createUserSchema,
  employeeCodeSchema,
  forgotPasswordSchema,
  listProvidersQuerySchema,
  listStaffQuerySchema,
  loginSchema,
  masterCodeSchema,
  pincodeSearchQuerySchema,
  resetPasswordSchema,
  reviewProviderSchema,
  staffTerritoryPinSchema,
  submitProviderSchema,
  updateStaffSchema,
} from './schemas';
import { providerTypes } from './enums';

const id = '11111111-1111-4111-8111-111111111111';

describe('shared request schemas', () => {
  it('normalises login addresses and refuses malformed ones', () => {
    const parsed = loginSchema.parse({ email: '  Admin@CureNear.IN ', password: 'secret' });
    expect(parsed.email).toBe('admin@curenear.in');
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });

  it('enforces the password-confirmation and policy rules', () => {
    const good = { currentPassword: 'old-password-123', newPassword: 'new-password-123' };
    expect(changePasswordSchema.safeParse(good).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...good, extra: 'nope' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...good, newPassword: '' }).success).toBe(false);

    expect(forgotPasswordSchema.parse({ email: ' Staff@CureNear.IN ' }).email).toBe(
      'staff@curenear.in',
    );
    expect(
      resetPasswordSchema.safeParse({ token: 'a'.repeat(20), password: 'new-password-123' })
        .success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({ token: 'short', password: 'new-password-123' }).success,
    ).toBe(false);
  });

  it('validates staff creation, employee codes and territory PINs', () => {
    const staff = createStaffSchema.parse({
      name: '  Field Officer ',
      email: ' Officer@CureNear.IN ',
      mobile: '9876543210',
      employeeCode: 'CN-001',
      pinCodes: ['700001', '700002'],
    });
    expect(staff.email).toBe('officer@curenear.in');
    expect(staff.name).toBe('Field Officer');
    expect(staff.pinCodes).toEqual(['700001', '700002']);

    expect(createStaffSchema.safeParse({ email: 'x@y.in', role: 'ADMIN' }).success).toBe(false);
    expect(employeeCodeSchema.safeParse('CN-001').success).toBe(true);
    expect(employeeCodeSchema.safeParse('bad code!').success).toBe(false);
    expect(staffTerritoryPinSchema.safeParse(['700001']).success).toBe(true);
    expect(staffTerritoryPinSchema.safeParse(['099999']).success).toBe(false);
    expect(updateStaffSchema.safeParse({ name: 'Renamed', pinCodes: [] }).success).toBe(true);
    expect(updateStaffSchema.safeParse({}).success).toBe(false);
    expect(listStaffQuerySchema.parse({}).page).toBe(1);
    expect(listStaffQuerySchema.parse({ status: 'LOCKED' }).status).toBe('LOCKED');
  });

  it('keeps administrator user creation restricted to known roles', () => {
    expect(
      createUserSchema.safeParse({
        name: 'Ops Admin',
        email: 'ops@curenear.in',
        role: 'ADMIN',
        temporaryPassword: 'temporary-password-1',
      }).success,
    ).toBe(true);
    expect(
      createUserSchema.safeParse({ name: 'Nobody', email: 'n@curenear.in', role: 'ROOT' }).success,
    ).toBe(false);
  });

  it('applies list defaults, coercions and filter validation', () => {
    const query = listProvidersQuerySchema.parse({
      page: '2',
      pageSize: '50',
      providerType: 'clinic,doctor',
      status: 'submitted',
      pin: '700001',
    });
    expect(query).toMatchObject({
      page: 2,
      pageSize: 50,
      providerType: ['clinic', 'doctor'],
      status: ['submitted'],
      sort: 'createdAt',
      order: 'desc',
    });
    expect(listProvidersQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(listProvidersQuerySchema.safeParse({ providerType: 'spaceship' }).success).toBe(false);
    expect(listProvidersQuerySchema.safeParse({ pin: '012345' }).success).toBe(false);
  });

  it('requires a provider type and legal name to start a draft', () => {
    expect(
      createProviderSchema.safeParse({
        providerType: 'clinic',
        data: { legal_name: 'CareNear Clinic Private Limited' },
      }).success,
    ).toBe(true);
    expect(createProviderSchema.safeParse({ legalName: 'No type' }).success).toBe(false);
    for (const providerType of providerTypes) {
      expect(createProviderSchema.safeParse({ providerType }).success).toBe(true);
    }
  });

  it('requires reasons for review decisions and a note for resubmission', () => {
    expect(
      reviewProviderSchema.safeParse({ decision: 'request_changes', reason: 'Blurry licence' })
        .success,
    ).toBe(true);
    expect(reviewProviderSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(reviewProviderSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(submitProviderSchema.safeParse({ declarationsAccepted: true }).success).toBe(true);
    expect(submitProviderSchema.safeParse({}).success).toBe(false);
  });

  it('validates master-data codes and PIN search', () => {
    expect(masterCodeSchema.safeParse('GENERAL_MEDICINE').success).toBe(true);
    expect(masterCodeSchema.safeParse('bad code').success).toBe(false);
    expect(pincodeSearchQuerySchema.parse({ q: ' 700 ' }).q).toBe('700');
    expect(pincodeSearchQuerySchema.safeParse({ q: '7'.repeat(200) }).success).toBe(false);
  });

  it('rejects an unknown provider id in params', () => {
    expect(reviewProviderSchema.safeParse({ decision: 'approve', id }).success).toBe(false);
  });
});
