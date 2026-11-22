'use client';

import { useEffect, useRef, useState } from 'react';
import {
  documentMaxBytes,
  allowedDocumentMimeTypes,
  type DocumentRequirement,
} from '@curenear/shared';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { DocumentDto } from '@/lib/types';

export interface DocumentTypeOption {
  id: string;
  code: string;
  name: string;
  requiresExpiry: boolean;
}

export interface DocumentUploaderProps {
  ownerType: 'provider' | 'provider_organization';
  ownerId: string;
  /** The registry requirement being fulfilled (label, clause, conditional note). */
  requirement: DocumentRequirement;
  documentType: DocumentTypeOption;
  existing?: DocumentDto | null;
  onUploaded?: (document: DocumentDto) => void;
  onRemoved?: () => void;
}

function sha256Hex(file: File): Promise<string> {
  return file
    .arrayBuffer()
    .then((buffer) => crypto.subtle.digest('SHA-256', buffer))
    .then((digest) =>
      Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    );
}

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Storage rejected the upload (${request.status})`));
    };
    request.onerror = () => reject(new Error('Could not reach the storage service'));
    request.send(file);
  });
}

/**
 * Upload flow: ask for a presigned PUT URL, upload straight to storage with
 * progress, then confirm so the server verifies size, checksum and the real
 * mime type. `expires_on` is mandatory when the document type tracks expiry.
 */
export function DocumentUploader({
  ownerType,
  ownerId,
  requirement,
  documentType,
  existing = null,
  onUploaded,
  onRemoved,
}: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const previewable = Boolean(existing && existing.status !== 'REJECTED');
  const existingId = existing?.id ?? null;
  const existingMime = existing?.mimeType ?? null;

  useEffect(() => {
    if (!existingId || !previewable || !existingMime?.startsWith('image/')) {
      setImageUrl(null);
      return;
    }
    let active = true;
    api
      .get<{ url: string }>(`/api/v1/documents/${existingId}/download-url`)
      .then((response) => {
        if (active) setImageUrl(response.data.url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [existingId, existingMime, previewable]);

  function accept(next: File | undefined): void {
    if (!next) return;
    setError(null);
    if (
      !allowedDocumentMimeTypes.includes(next.type as (typeof allowedDocumentMimeTypes)[number])
    ) {
      setError('Upload a PDF, JPG or PNG file.');
      return;
    }
    if (next.size > documentMaxBytes) {
      setError('Files are limited to 10 MB.');
      return;
    }
    setFile(next);
  }

  async function upload(): Promise<void> {
    if (!file) return;
    if (documentType.requiresExpiry && !expiresOn) {
      setError('Choose the expiry date for this document.');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const initiated = await api.post<{
        document: DocumentDto;
        upload_url: string;
        upload_headers: Record<string, string>;
      }>('/api/v1/documents/upload-url', {
        owner_type: ownerType,
        owner_id: ownerId,
        document_type_id: documentType.id,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        ...(expiresOn ? { expires_on: expiresOn } : {}),
      });

      await putWithProgress(
        initiated.data.upload_url,
        file,
        initiated.data.upload_headers,
        setProgress,
      );

      const confirmed = await api.post<DocumentDto>(
        `/api/v1/documents/${initiated.data.document.id}/confirm`,
        { size_bytes: file.size, checksum_sha256: await sha256Hex(file) },
      );

      // A replace is upload-then-remove: the old file only goes once the new
      // document has been verified by the server.
      if (existing) {
        await api.delete(`/api/v1/documents/${existing.id}`).catch(() => undefined);
      }
      setFile(null);
      setProgress(null);
      onUploaded?.(confirmed.data);
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof ApiClientError ? caught.message : 'The upload did not complete.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/api/v1/documents/${existing.id}`);
      onRemoved?.();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Could not remove the document.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(): Promise<void> {
    if (!existing) return;
    try {
      const response = await api.get<{ url: string }>(
        `/api/v1/documents/${existing.id}/download-url`,
      );
      window.open(response.data.url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not open the document.');
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {requirement.label}
            {requirement.requirement === 'required' ? (
              <span className="ml-1 text-destructive">*</span>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {requirement.clause}
            {requirement.conditionNote ? ` · ${requirement.conditionNote}` : ''}
          </p>
        </div>
        {existing ? (
          <span className="rounded-full border px-2 py-0.5 text-xs">{existing.status}</span>
        ) : null}
      </div>

      {existing ? (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-2">
          {/* Presigned URL, not a local asset for next/image. */}
          {imageUrl ? (
            <img src={imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
          ) : null}
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium">{existing.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {existing.documentTypeName}
              {existing.expiresOn ? ` · expires ${existing.expiresOn.slice(0, 10)}` : ''}
            </p>
            {existing.rejectionReason ? (
              <p className="text-xs text-destructive">{existing.rejectionReason}</p>
            ) : null}
          </div>
          {previewable ? (
            <Button variant="outline" size="sm" onClick={openPreview} disabled={busy}>
              Preview
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
            Remove
          </Button>
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        aria-label={`Choose a file for ${requirement.label}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files[0]);
        }}
        className={cn(
          'cursor-pointer rounded-md border border-dashed px-4 py-6 text-center text-sm',
          dragging ? 'border-primary bg-accent/40' : 'border-input bg-muted/20',
        )}
      >
        <p>
          {file
            ? file.name
            : existing
              ? 'Drop a replacement file or click to choose'
              : 'Drop a file here, or click to choose'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">PDF, JPG or PNG · up to 10 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(event) => accept(event.target.files?.[0])}
        />
      </div>

      {documentType.requiresExpiry ? (
        <div>
          <Label htmlFor={`expires-${requirement.key}`} required>
            Expiry date
          </Label>
          <Input
            id={`expires-${requirement.key}`}
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </div>
      ) : null}

      {progress !== null ? (
        <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-label="Upload progress">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {file ? (
          <Button variant="ghost" size="sm" onClick={() => setFile(null)} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        <Button size="sm" onClick={upload} disabled={!file || busy}>
          {existing ? 'Replace' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}
