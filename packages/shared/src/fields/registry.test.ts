import { describe, expect, it } from 'vitest';
import { providerTypes } from '../enums';
import {
  adminOnlyFieldsFor,
  allDefinitions,
  allFieldsForProvider,
  documentRequirementsFor,
  fieldByKey,
  formSectionsFor,
  providerDefinition,
  registryKeysFor,
  schemaVersionFor,
  sectionsForProvider,
  stripAdminOnlyTypeData,
  typeDataDefaultsFor,
  typeDataFieldsFor,
} from './registry';

describe('field registry invariants', () => {
  it('defines a versioned registry for every provider type', () => {
    expect(Object.keys(allDefinitions()).sort()).toEqual([...providerTypes].sort());
    for (const providerType of providerTypes) {
      expect(schemaVersionFor(providerType), providerType).toBeGreaterThanOrEqual(1);
      expect(providerDefinition(providerType).providerType).toBe(providerType);
      expect(sectionsForProvider(providerType).length).toBeGreaterThan(0);
      expect(formSectionsFor(providerType).length).toBeGreaterThan(0);
    }
  });

  it('keeps field and section keys unique within a provider type', () => {
    for (const providerType of providerTypes) {
      const fields = allFieldsForProvider(providerType);
      expect(fields.length).toBeGreaterThan(10);
      expect(new Set(fields.map((field) => field.key)).size, providerType).toBe(fields.length);

      const sections = sectionsForProvider(providerType);
      expect(new Set(sections.map((section) => section.key)).size).toBe(sections.length);
      for (const section of sections) {
        expect(section.title, section.key).toBeTruthy();
        expect(section.fields.length, section.key).toBeGreaterThan(0);
        expect(new Set(section.fields.map((field) => field.key)).size).toBe(section.fields.length);
      }
    }
  });

  it('declares at least one document requirement and resolvable document codes', () => {
    for (const providerType of providerTypes) {
      const requirements = documentRequirementsFor(providerType);
      expect(requirements.length, providerType).toBeGreaterThan(0);
      expect(new Set(requirements.map((requirement) => requirement.key)).size).toBe(
        requirements.length,
      );
      for (const requirement of requirements) {
        expect(requirement.label, requirement.key).toBeTruthy();
        expect(requirement.section, requirement.key).toBeTruthy();
        expect(['required', 'conditional', 'optional']).toContain(requirement.requirement);
      }
    }
  });

  it('separates type-data, related and column storage', () => {
    for (const providerType of providerTypes) {
      for (const field of allFieldsForProvider(providerType)) {
        expect(['type_data', 'related', 'column']).toContain(field.storage.kind);
        expect(field.label, field.key).toBeTruthy();
        if (field.storage.kind === 'column') {
          expect(field.storage.column, field.key).toBeTruthy();
        }
      }
      expect(
        typeDataFieldsFor(providerType).every((field) => field.storage.kind === 'type_data'),
      ).toBe(true);
    }
  });

  it('resolves fields by key and rejects unknown keys', () => {
    for (const providerType of providerTypes) {
      const field = allFieldsForProvider(providerType)[0]!;
      expect(fieldByKey(providerType, field.key)).toEqual(field);
      expect(fieldByKey(providerType, 'definitely_not_a_field')).toBeUndefined();
    }
  });

  it('builds defaults only from keys that exist in the registry', () => {
    for (const providerType of providerTypes) {
      const defaults = typeDataDefaultsFor(providerType);
      for (const key of Object.keys(defaults)) {
        expect(fieldByKey(providerType, key), `${providerType}.${key}`).toBeDefined();
      }
    }
  });

  it('strips administrator-only values before they reach a staff response', () => {
    for (const providerType of providerTypes) {
      const adminFields = adminOnlyFieldsFor(providerType);
      if (adminFields.length === 0) continue;
      const typeData: Record<string, unknown> = Object.fromEntries(
        adminFields.map((field, index) => [field.key, index]),
      );
      typeData.legal_name = 'Kept';
      const stripped = stripAdminOnlyTypeData(providerType, typeData);
      expect(stripped.legal_name).toBe('Kept');
      for (const field of adminFields) {
        expect(stripped).not.toHaveProperty(field.key);
      }
    }
  });

  it('reports every top-level field and every repeater sub-field', () => {
    for (const providerType of providerTypes) {
      const keys = registryKeysFor(providerType);
      const fields = allFieldsForProvider(providerType);
      expect(keys.fields).toEqual(fields.map((field) => field.key));
      expect(new Set(keys.fields).size).toBe(fields.length);
      const expectedSubFields = fields.flatMap((field) =>
        (field.items ?? []).map((item) => item.key),
      );
      expect(keys.subFields.length).toBeGreaterThanOrEqual(expectedSubFields.length);
    }
  });
});
