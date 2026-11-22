import { AppError } from '@curenear/shared';

export interface ScanResult {
  clean: boolean;
  /** Scanner signature name when something was found. */
  signature?: string;
}

export interface ScanInput {
  key: string;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * Malware scanning hook. A document that has been confirmed while scanning is
 * enabled stays in PENDING_SCAN until the hook answers; an infected file is
 * marked REJECTED and removed from storage.
 */
export interface ScanProvider {
  scan(input: ScanInput): Promise<ScanResult>;
}

/** Development default: no scanner configured, every upload is accepted. */
export function createNoopScanProvider(): ScanProvider {
  return {
    async scan() {
      return { clean: true };
    },
  };
}

/**
 * ClamAV is not wired up yet. The stub fails loudly instead of reporting files
 * clean: enabling DOCUMENT_SCAN_ENABLED without a real scanner must not release
 * unscanned uploads. Implementing this means speaking clamd's INSTREAM protocol
 * and streaming the object through it.
 */
export function createClamAvScanProvider(): ScanProvider {
  return {
    async scan() {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Malware scanning is enabled but the ClamAV provider is not implemented',
      );
    },
  };
}

export function createScanProvider(enabled: boolean): ScanProvider {
  return enabled ? createClamAvScanProvider() : createNoopScanProvider();
}
