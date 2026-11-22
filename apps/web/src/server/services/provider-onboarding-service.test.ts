import { describe, expect, it } from 'vitest';
import { identityChanges, type IdentityFields } from './provider-onboarding-service';

const base: IdentityFields = {
  registrationNumber: 'WB-CLINIC-1',
  mobile: '9830012345',
  legalName: 'Sunrise Clinic',
  doctorRegistrationNo: null,
};

describe('identityChanges', () => {
  it('reports no duplicate-relevant change when only other fields are saved', () => {
    expect(identityChanges(base, { ...base })).toMatchObject({
      registration: false,
      mobile: false,
      name: false,
      doctorRegistration: false,
      any: false,
    });
  });

  it('ignores whitespace and case differences', () => {
    expect(
      identityChanges(base, {
        ...base,
        legalName: '  sunrise clinic ',
        registrationNumber: 'wb-clinic-1',
        mobile: ' 9830012345 ',
      }).any,
    ).toBe(false);
  });

  it('flags each field that really changed', () => {
    expect(identityChanges(base, { ...base, registrationNumber: 'WB-CLINIC-2' })).toMatchObject({
      registration: true,
      any: true,
    });
    expect(identityChanges(base, { ...base, mobile: '9830099999' })).toMatchObject({
      mobile: true,
      any: true,
    });
    expect(identityChanges(base, { ...base, legalName: 'Sunrise Polyclinic' })).toMatchObject({
      name: true,
      any: true,
    });
    expect(identityChanges(base, { ...base, doctorRegistrationNo: 'WBMC/99881' })).toMatchObject({
      doctorRegistration: true,
      any: true,
    });
  });
});
