/**
 * Minimal PDF writer for agreements. The portal only needs text (the agreement
 * body with the provider's data filled in), so this avoids pulling a PDF
 * toolchain into the worker-heavy dependency tree. Output is PDF 1.4 with the
 * standard Helvetica fonts, which every viewer renders.
 */

function escapeText(value: string): string {
  return value.replace(/[\\()]/g, (character) => `\\${character}`).replace(/[^\x20-\x7E]/g, '?');
}

function wrapLine(value: string, width: number): string[] {
  if (value.length <= width) return [value];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function contentStream(lines: string[], title: string, subtitle: string | null): string {
  const body: string[] = [];
  body.push('BT');
  body.push('/F2 16 Tf');
  body.push('56 782 Td');
  body.push(`(${escapeText(title)}) Tj`);
  let y = -26;
  if (subtitle) {
    body.push('/F1 10 Tf');
    body.push(`0 ${y} Td`);
    body.push(`(${escapeText(subtitle)}) Tj`);
    y = -30;
  }
  body.push('/F1 10 Tf');
  body.push(`0 ${y} Td`);
  body.push('15 TL');
  for (const line of lines) {
    body.push(`(${escapeText(line)}) Tj`);
    body.push('T*');
  }
  body.push('ET');
  return body.join('\n');
}

export function renderAgreementPdf(input: {
  title: string;
  subtitle?: string | null;
  body: string;
}): Buffer {
  const width = 92;
  const perPage = 44;
  const wrapped = input.body
    .split('\n')
    .flatMap((line) => (line.trim() === '' ? [''] : wrapLine(line, width)));
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += perPage) {
    pages.push(wrapped.slice(index, index + perPage));
  }
  if (pages.length === 0) pages.push(['']);

  const pageCount = pages.length;
  const fontRegularId = 3 + pageCount * 2;
  const fontBoldId = fontRegularId + 1;

  const objects: string[] = [];
  // 1: catalog, 2: page tree
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  pages.forEach((lines, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = contentStream(
      lines,
      input.title,
      index === 0 ? (input.subtitle ?? null) : (input.subtitle ?? null),
    );
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (value: string) => {
    const buffer = Buffer.from(value, 'latin1');
    chunks.push(buffer);
    offset += buffer.length;
  };

  push('%PDF-1.4\n');
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(offset);
    push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });

  const xrefOffset = offset;
  const xrefLines = [`xref`, `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const objectOffset of offsets) {
    xrefLines.push(`${objectOffset.toString().padStart(10, '0')} 00000 n `);
  }
  push(`${xrefLines.join('\n')}\n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
