import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { providerTypes } from '../enums';
import { allFieldsForProvider, sectionsForProvider, typeDataDefaultsFor } from './registry';
import {
  assertRegistryCoverage,
  buildTypeDataSchema,
  collectTypeDataIssues,
  typeDataSchemaVersionFor,
  validateProviderSection,
  validateTypeData,
  validateTypeDataSection,
} from './schema';

const validationError = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_ERROR');
    return error as AppError;
  }
  throw new Error('expected a VALIDATION_ERROR');
};

describe('generated type-data schemas', () => {
  it('covers every provider type with a schema version', () => {
    expect(() => assertRegistryCoverage()).not.toThrow();
    for (const providerType of providerTypes) {
      expect(typeDataSchemaVersionFor(providerType)).toBeGreaterThanOrEqual(1);
      expect(buildTypeDataSchema(providerType)).toBeDefined();
    }
  });

  it('accepts empty drafts because autosave is partial', () => {
    for (const providerType of providerTypes) {
      expect(() => validateTypeData(providerType, {}, { mode: 'draft' })).not.toThrow();
      expect(collectTypeDataIssues(providerType, {}, { mode: 'draft' })).toEqual([]);
    }
  });

  it('accepts registry defaults as a draft', () => {
    for (const providerType of providerTypes) {
      const defaults = typeDataDefaultsFor(providerType);
      expect(collectTypeDataIssues(providerType, defaults, { mode: 'draft' })).toEqual([]);
    }
  });

  it('reports issues instead of throwing when collecting', () => {
    const issues = collectTypeDataIssues('clinic', {}, { mode: 'submit' });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.path && issue.message)).toBe(true);
    expect(() => validateTypeData('clinic', {}, { mode: 'submit' })).toThrow(
      /provider details are invalid/i,
    );
  });

  it('validates a section in draft mode and refuses unknown sections', () => {
    for (const providerType of providerTypes) {
      const section = sectionsForProvider(providerType)[0]!;
      expect(validateTypeDataSection(providerType, section.key, {})).toEqual({});
      expect(() => validateTypeDataSection(providerType, 'nope', {})).toThrow(
        /Unknown provider section/,
      );
    }
  });

  it('splits section input into type data and column values', () => {
    const sections = sectionsForProvider('clinic');
    for (const section of sections) {
      const typeDataFields = section.fields.filter(
        (field) => field.storage.kind === 'type_data' && !field.adminOnly,
      );
      if (typeDataFields.length === 0) continue;
      const result = validateProviderSection('clinic', section.key, {});
      expect(result.typeData).toEqual({});
      expect(result.columns).toEqual({});
    }
  });

  it('refuses fields that belong to another section or a sub-resource', () => {
    const section = sectionsForProvider('clinic')[0]!;
    validationError(() => validateProviderSection('clinic', section.key, { not_a_field: 1 }));

    const relatedField = allFieldsForProvider('clinic').find(
      (field) => field.storage.kind === 'related' && !field.adminOnly,
    );
    if (relatedField) {
      const ownerSection = sectionsForProvider('clinic').find((candidate) =>
        candidate.fields.some((field) => field.key === relatedField.key),
      );
      if (ownerSection) {
        const error = validationError(() =>
          validateProviderSection('clinic', ownerSection.key, { [relatedField.key]: 'x' }),
        );
        expect(JSON.stringify(error.details)).toContain('sub-resource');
      }
    }
  });

  it('refuses an admin-only field submitted by staff', () => {
    const section = sectionsForProvider('clinic').find((candidate) =>
      candidate.fields.some((field) => field.adminOnly),
    );
    const adminField = section?.fields.find((field) => field.adminOnly);
    if (section && adminField) {
      const error = validationError(() =>
        validateProviderSection('clinic', section.key, { [adminField.key]: 'x' }),
      );
      expect(error.code).toBe('VALIDATION_ERROR');
    }
  });
});
