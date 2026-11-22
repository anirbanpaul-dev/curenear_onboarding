import type { AllowedDocumentMimeType } from '@curenear/shared';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * The declared mime type and the file extension are caller-supplied, so the
 * server identifies the file from its magic bytes after upload. Anything that
 * does not match the allowlist is rejected.
 */
export function sniffAllowedMimeType(bytes: Uint8Array): AllowedDocumentMimeType | null {
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

export function extensionForMimeType(mimeType: AllowedDocumentMimeType): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
}
