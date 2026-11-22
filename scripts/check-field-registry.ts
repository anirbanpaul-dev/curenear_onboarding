import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  commonFieldSections,
  providerDefinition,
  registryKeysFor,
} from '../packages/shared/src/index';
import { providerTypes, type ProviderType } from '../packages/shared/src/enums';

/**
 * Checks the field registry against docs/field-spec.md.
 *
 *   pnpm check:fields            # report, exit 1 on missing keys
 *   pnpm check:fields --strict   # also fail on extra keys (registry keys not in the spec)
 *
 * Spec sections 9 (agreement execution), 10 (admin verification) and 11 plus the
 * appendix are out of scope for the onboarding data model, so they are reported
 * as skipped rather than missing.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const candidates = [
  path.join(repoRoot, 'docs', 'field-spec.md'),
  path.join(repoRoot, 'docs', 'CureNear_Provider_Onboarding_Field_Spec.md'),
];
const specPath = candidates.find((candidate) => existsSync(candidate));

if (!specPath) {
  process.stderr.write(`No field spec found. Looked for:\n  ${candidates.join('\n  ')}\n`);
  process.exit(1);
}

const OUT_OF_SCOPE_PREFIXES = ['9', '10', '11', 'A'];

/** Which spec section defines each provider type's fields. */
const SPEC_SECTION: Record<ProviderType, string> = {
  doctor: '4',
  care_provider: '5',
  clinic: '6',
  pharmacy: '7',
  diagnostic_centre: '8',
};

interface SpecSection {
  id: string;
  title: string;
  keys: string[];
}

function parseSpec(text: string): { sections: SpecSection[]; outOfScope: SpecSection[] } {
  const sections: SpecSection[] = [];
  const outOfScope: SpecSection[] = [];
  let current: SpecSection | null = null;
  let inAppendix = false;

  for (const line of text.split(/\r?\n/)) {
    if (/^##\s+Appendix\s+A/i.test(line)) inAppendix = true;

    const heading = /^#{2,4}\s+(\d+(?:\.\d+)?[a-z]?)\b\s*(.*)$/.exec(line);
    if (heading) {
      const id = heading[1];
      const title = heading[2].trim();
      const out =
        inAppendix ||
        OUT_OF_SCOPE_PREFIXES.some((prefix) => id === prefix || id.startsWith(`${prefix}.`));
      // Sections 1 and 2 hold conventions and prose, not field tables.
      if (!out && !scopeOf(id)) {
        current = null;
        continue;
      }
      current = { id, title, keys: [] };
      (out ? outOfScope : sections).push(current);
      continue;
    }

    if (!current || !line.trim().startsWith('|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const keyCell = cells[1];
    if (!keyCell || keyCell === 'Key' || /^-+$/.test(keyCell)) continue;
    // Only backticked cells are keys; other tables put the type or Req value in
    // this column.
    if (!keyCell.includes('`')) continue;

    for (const match of keyCell.matchAll(/`([^`]+)`/g)) {
      const key = match[1].trim();
      if (key && !key.includes(' ')) current.keys.push(key);
    }
  }

  // The same key can appear in several sections (for example doc_full_name in
  // 6.5); keep one entry per section but de-duplicate inside a section.
  for (const section of [...sections, ...outOfScope]) {
    section.keys = Array.from(new Set(section.keys));
  }

  return { sections, outOfScope };
}

function scopeOf(sectionId: string): 'common' | ProviderType | null {
  if (sectionId.startsWith('3.')) return 'common';
  if (sectionId.startsWith('4.')) return 'doctor';
  if (sectionId.startsWith('5.')) return 'care_provider';
  if (sectionId.startsWith('6.')) return 'clinic';
  if (sectionId.startsWith('7.')) return 'pharmacy';
  if (sectionId.startsWith('8.')) return 'diagnostic_centre';
  return null;
}

const specText = readFileSync(specPath, 'utf8');
const { sections, outOfScope } = parseSpec(specText);

const specKeys = new Set<string>();
const specKeysByScope = new Map<string, Set<string>>();
for (const section of sections) {
  for (const key of section.keys) {
    specKeys.add(key);
    const scope = scopeOf(section.id);
    if (!scope) continue;
    const existing = specKeysByScope.get(scope) ?? new Set<string>();
    existing.add(key);
    specKeysByScope.set(scope, existing);
  }
}

const commonKeys = new Set(
  commonFieldSections().flatMap((section) => section.fields.map((field) => field.key)),
);
const typeKeys = new Map<ProviderType, Set<string>>();
for (const providerType of providerTypes) {
  typeKeys.set(
    providerType,
    new Set(providerDefinition(providerType).sections.flatMap((s) => s.fields.map((f) => f.key))),
  );
}

const registryKeys = new Set<string>(commonKeys);
for (const keys of typeKeys.values()) for (const key of keys) registryKeys.add(key);

// Repeater sub-fields are keys too (loc_*, test_*, cp_*); the spec lists them as
// their own rows. They are checked for presence but never reported as extras,
// because a sub-key can legitimately be structural (`name`, `open`).
const subKeys = new Set<string>();
for (const providerType of providerTypes) {
  for (const { subFields } of [registryKeysFor(providerType)]) {
    for (const key of subFields) subKeys.add(key);
  }
}

const knownKeys = new Set<string>([...registryKeys, ...subKeys]);

/**
 * Keys the registry needs but the spec has no row for: repeater containers and
 * a key the spec only names inside another field's Notes cell. Documented in
 * docs/decisions.md under "Structural field keys".
 */
const STRUCTURAL_KEYS: Record<string, string> = {
  locations: 'repeater container for the loc_* rows in section 3.4',
  cp_service_categories: 'repeater container for the cp_* rows in section 5.2',
  dc_tests: 'repeater container for the test_* rows in section 8.3',
  clinic_ce_exempt_reason:
    'named inside the clinic_ce_applicable Notes cell in section 6.1, not as its own row',
  practice_locations: 'repeater container for the prac_* fields in section 4.3',
  // The spec types these licence fields as "text, file"; the document half is
  // its own field so the form can upload it.
  clinic_bmw_doc: 'document half of the clinic_bmw "text, file" field (section 6.1)',
  clinic_aerb_doc: 'document half of the clinic_aerb "text, file" field (section 6.1)',
  ph_fssai_doc: 'document half of the ph_fssai "text, file" field (section 7.1)',
  dc_pcpndt_doc: 'document half of the dc_pcpndt "text, file" field (section 8.1)',
  dc_bmw_doc: 'document half of the dc_bmw "text, file" field (section 8.1)',
  cp_bmw_doc: 'document half of the cp_bmw "text, file" field (section 5.1)',
};

const missing = [...specKeys].filter((key) => !knownKeys.has(key)).sort();
const extra = [...registryKeys]
  .filter((key) => !specKeys.has(key) && !(key in STRUCTURAL_KEYS))
  .sort();
const structural = [...registryKeys].filter((key) => !specKeys.has(key) && key in STRUCTURAL_KEYS);

const lines: string[] = [];
lines.push(`Field registry check against ${path.relative(repoRoot, specPath)}`);
lines.push('');

for (const [scope, keys] of specKeysByScope) {
  const registrySet = scope === 'common' ? commonKeys : typeKeys.get(scope as ProviderType);
  if (!registrySet) continue;
  const scopeMissing = [...keys].filter((key) => !registrySet.has(key));
  const reused = scopeMissing.filter((key) => knownKeys.has(key));
  const unknown = scopeMissing.filter((key) => !knownKeys.has(key));
  const label =
    scope === 'common'
      ? 'common (section 3)'
      : `${scope} (section ${SPEC_SECTION[scope as ProviderType]})`;
  lines.push(
    `${label.padEnd(28)} spec ${String(keys.size).padStart(3)}  registry ${String(
      registrySet.size,
    ).padStart(
      3,
    )}${reused.length ? `  reused ${reused.length}` : ''}${unknown.length ? `  missing ${unknown.length}` : ''}`,
  );
  if (reused.length) lines.push(`  reused from the registry: ${reused.sort().join(', ')}`);
  if (unknown.length) lines.push(`  MISSING: ${unknown.sort().join(', ')}`);
}

lines.push('');
if (missing.length) {
  lines.push(`Missing keys (${missing.length}):`);
  for (const key of missing) lines.push(`  - ${key}`);
} else {
  lines.push('Missing keys: none');
}

if (extra.length) {
  lines.push(`Extra keys not in the spec (${extra.length}):`);
  for (const key of extra) lines.push(`  - ${key}`);
} else {
  lines.push('Extra keys: none');
}

if (structural.length) {
  lines.push(`Structural keys accepted (${structural.length}):`);
  for (const key of structural) lines.push(`  - ${key}: ${STRUCTURAL_KEYS[key]}`);
}

if (outOfScope.length) {
  lines.push('');
  lines.push(
    `Skipped sections (out of scope for this data model): ${outOfScope
      .map((section) => section.id)
      .join(', ')}`,
  );
}

process.stdout.write(`${lines.join('\n')}\n`);

const strict = process.argv.includes('--strict');
if (missing.length > 0 || (strict && extra.length > 0)) process.exit(1);
