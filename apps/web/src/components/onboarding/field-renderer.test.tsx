import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProviderField } from '@curenear/shared';
import { FieldRenderer } from './field-renderer';
import { isFieldRequired, isFieldVisible } from './section-values';

function field(overrides: Partial<ProviderField>): ProviderField {
  return {
    key: 'legal_name',
    label: 'Legal name',
    type: 'text',
    requirement: 'required',
    section: 'legal_entity',
    clause: '3.2',
    storage: { kind: 'type_data' },
    ...overrides,
  };
}

const noop = () => undefined;

describe('FieldRenderer', () => {
  it('renders a text field with its label and current value', () => {
    const markup = renderToStaticMarkup(
      <FieldRenderer
        field={field({})}
        value="Sunrise Clinic"
        values={{}}
        providerType="clinic"
        onChange={noop}
      />,
    );
    expect(markup).toContain('Legal name');
    expect(markup).toContain('value="Sunrise Clinic"');
  });

  it('renders a select from registry options and a checked boolean', () => {
    const select = renderToStaticMarkup(
      <FieldRenderer
        field={field({
          key: 'constitution_type',
          label: 'Constitution type',
          type: 'select',
          validation: { options: ['individual', 'partnership'] },
        })}
        value="partnership"
        values={{}}
        providerType="clinic"
        onChange={noop}
      />,
    );
    expect(select).toContain('<option value="partnership" selected="">');

    const boolean = renderToStaticMarkup(
      <FieldRenderer
        field={field({ key: 'consent', label: 'Consent', type: 'boolean' })}
        value={true}
        values={{}}
        providerType="clinic"
        onChange={noop}
      />,
    );
    expect(boolean).toContain('type="checkbox"');
    expect(boolean).toContain('checked=""');
  });

  it('renders money in rupees and pins as 6-digit inputs', () => {
    const money = renderToStaticMarkup(
      <FieldRenderer
        field={field({ key: 'amount', label: 'Amount', type: 'money' })}
        value={1250}
        values={{}}
        providerType="clinic"
        onChange={noop}
      />,
    );
    expect(money).toContain('value="1250"');

    const pin = renderToStaticMarkup(
      <FieldRenderer
        field={field({ key: 'reg_pin', label: 'PIN code', type: 'pin' })}
        value="700091"
        values={{}}
        providerType="clinic"
        onChange={noop}
      />,
    );
    expect(pin).toContain('maxLength="6"');
    expect(pin).toContain('value="700091"');
  });

  it('honours conditional visibility and requirements from the registry', () => {
    const registration = field({
      key: 'registration_number',
      label: 'Registration number',
      requirement: 'conditional',
      condition: { field: 'constitution_type', op: 'notEquals', value: 'individual' },
    });

    expect(isFieldVisible(registration, { constitution_type: 'partnership' }, 'clinic')).toBe(true);
    expect(isFieldVisible(registration, { constitution_type: 'individual' }, 'clinic')).toBe(false);
    expect(isFieldRequired(registration, { constitution_type: 'partnership' })).toBe(true);
    expect(isFieldRequired(registration, { constitution_type: 'individual' })).toBe(false);

    const hidden = renderToStaticMarkup(
      <FieldRenderer
        field={registration}
        value=""
        values={{ constitution_type: 'individual' }}
        providerType="clinic"
        onChange={noop}
      />,
    );
    expect(hidden).toBe('');

    const shown = renderToStaticMarkup(
      <FieldRenderer
        field={registration}
        value=""
        values={{ constitution_type: 'partnership' }}
        providerType="clinic"
        onChange={noop}
      />,
    );
    expect(shown).toContain('Registration number');
  });

  it('hides fields the registry excludes for the provider type', () => {
    const tradeName = field({
      key: 'trade_name',
      label: 'Trade name',
      excludedFor: ['doctor'],
    });
    expect(isFieldVisible(tradeName, {}, 'doctor')).toBe(false);
    expect(isFieldVisible(tradeName, {}, 'clinic')).toBe(true);
  });
});
