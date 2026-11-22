'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api-client';
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import type { DocumentDto } from '@/lib/types';

export interface DocumentListProps {
  ownerType: 'provider' | 'provider_organization';
  ownerId: string;
}

const toneByStatus = {
  UPLOADED: 'info',
  PENDING_SCAN: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
} as const;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Lists the documents an owner has uploaded, with preview and remove actions. */
export function DocumentList({ ownerType, ownerId }: DocumentListProps) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['documents', ownerType, ownerId],
    queryFn: () =>
      api.get<DocumentDto[]>(`/api/v1/documents?owner_type=${ownerType}&owner_id=${ownerId}`),
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['documents', ownerType, ownerId] });
  }

  async function preview(document: DocumentDto): Promise<void> {
    setError(null);
    try {
      const response = await api.get<{ url: string }>(
        `/api/v1/documents/${document.id}/download-url`,
      );
      window.open(response.data.url, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not open the document.');
    }
  }

  async function remove(document: DocumentDto): Promise<void> {
    setBusyId(document.id);
    setError(null);
    try {
      await api.delete(`/api/v1/documents/${document.id}`);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Could not remove the document.',
      );
    } finally {
      setBusyId(null);
    }
  }

  const rows = query.data?.data ?? [];

  return (
    <div className="space-y-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading documents…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Size</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((document) => (
              <TableRow key={document.id}>
                <TableCell>
                  <p className="font-medium">{document.documentTypeName}</p>
                  <p className="text-xs text-muted-foreground">{document.fileName}</p>
                </TableCell>
                <TableCell>
                  <Badge tone={toneByStatus[document.status]}>{document.status}</Badge>
                </TableCell>
                <TableCell>{formatDate(document.expiresOn)}</TableCell>
                <TableCell>{formatSize(document.sizeBytes)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => preview(document)}>
                    Preview
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(document)}
                    disabled={busyId === document.id}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
