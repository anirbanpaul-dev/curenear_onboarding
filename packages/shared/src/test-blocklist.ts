/**
 * Test-name screening for diagnostic catalogues.
 *
 * docs/field-spec.md 8.3 (Diagnostic cl. 6): a catalogue must never include or
 * allow sex-determination tests. The list lives here so the repeater schema,
 * the CSV import and the admin review queue all screen with the same rules.
 */

/** Names that are refused outright, wherever they appear in a catalogue. */
const sexDeterminationPatterns: readonly RegExp[] = [
  /sex[\s_-]*det(?:ermin\w*)?/i,
  /determin\w*[\s-]+(?:the\s+)?sex\b/i,
  /\b(?:foetal|fetal)[\s-]+sex\b/i,
  /\bbaby[\s-]+sex\b/i,
  /\bgender[\s-]+(?:determination|selection|reveal)\b/i,
  /\bsex[\s-]+selection\b/i,
  /\bsex[\s-]+reveal\b/i,
  /\bfemale[\s-]+foeticide\b/i,
  /\bpre[\s-]?conception[\s-]+sex\b/i,
];

/** Names that may be listed but need an administrator's review first. */
const prenatalPatterns: readonly RegExp[] = [
  /prenatal/i,
  /pre[\s-]?natal/i,
  /antenatal/i,
  /\bNT[\s-]?scan\b/i,
  /anomaly[\s-]+scan/i,
  /karyotyp/i,
  /amniocentesis/i,
  /chorionic[\s-]+villus/i,
  /\bobstetric/i,
  /\bpregnan/i,
];

export function isSexDeterminationTest(name: string): boolean {
  const value = name.trim();
  if (!value) return false;
  return sexDeterminationPatterns.some((pattern) => pattern.test(value));
}

export function isPrenatalTest(name: string, category?: string | null): boolean {
  const value = `${name} ${category ?? ''}`.trim();
  if (!value) return false;
  if (isSexDeterminationTest(name)) return false;
  return prenatalPatterns.some((pattern) => pattern.test(value));
}
