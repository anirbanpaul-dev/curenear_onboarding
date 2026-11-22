'use client';

import { useState } from 'react';
import { Badge, Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime, cn } from '@/lib/utils';

export interface SectionValueRow {
  label: string;
  value: string;
}

export interface SectionView {
  key: string;
  title: string;
  clause: string;
  rows: SectionValueRow[];
}

export interface DocumentView {
  id: string;
  fileName: string;
  role: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  previewUrl: string | null;
}

export interface LicenceView {
  id: string;
  number: string;
  role: string;
  authority: string | null;
  validTo: string | null;
  status: string;
}

export interface HistoryView {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  at: string;
  reason: string | null;
}

export interface ConsentView {
  id: string;
  label: string;
  text: string | null;
  method: string;
  version: string;
  capturedAt: string;
  capturedBy: string | null;
  revokedAt: string | null;
  evidenceUrl: string | null;
  doctorName: string | null;
}

export interface AgreementView {
  id: string;
  name: string;
  version: string;
  method: string;
  signedOn: string;
  place: string;
  signatoryName: string;
  signatoryDesignation: string;
  stampReference: string | null;
  witnesses: Array<Record<string, unknown>>;
  signedCopyUrl: string | null;
  revokedAt: string | null;
}

export interface AuditView {
  id: string;
  action: string;
  at: string;
  actorRole: string | null;
  actorUserId: string | null;
  reason: string | null;
  changedFieldKeys: string[];
}

function ExpiryBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return <Badge tone="danger">Expired</Badge>;
  if (days <= 30) return <Badge tone="danger">{days} days left</Badge>;
  if (days <= 60) return <Badge tone="warning">{days} days left</Badge>;
  return <Badge tone="success">{days} days left</Badge>;
}

function Empty({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function humanise(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const label = mimeType.includes('pdf')
    ? 'PDF'
    : mimeType.startsWith('image/')
      ? 'IMG'
      : mimeType.includes('word')
        ? 'DOC'
        : 'FILE';
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-secondary/60 font-mono text-[9px] font-semibold text-muted-foreground">
      {label}
    </span>
  );
}

type TabGroup = 'sections' | 'consents' | 'documents' | 'licences' | 'history' | 'audit';

export function ProviderDetailTabs({
  sections,
  documents,
  licences,
  history,
  audit,
  consents,
  agreements,
}: {
  sections: SectionView[];
  documents: DocumentView[];
  licences: LicenceView[];
  history: HistoryView[];
  audit: AuditView[];
  consents: ConsentView[];
  agreements: AgreementView[];
}) {
  const [sectionKey, setSectionKey] = useState<string>(sections[0]?.key ?? 'sections');
  const [group, setGroup] = useState<TabGroup>('sections');

  const active = sections.find((section) => section.key === sectionKey) ?? sections[0];

  const groups: Array<{ key: TabGroup; label: string; count?: number }> = [
    { key: 'sections', label: 'Details' },
    { key: 'consents', label: 'Consents', count: consents.length + agreements.length },
    { key: 'documents', label: 'Documents', count: documents.length },
    { key: 'licences', label: 'Licences', count: licences.length },
    { key: 'history', label: 'Status history', count: history.length },
    { key: 'audit', label: 'Audit', count: audit.length },
  ];

  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center gap-1 border-b bg-secondary/30 px-2 py-2">
        {groups.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setGroup(entry.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              group === entry.key
                ? 'bg-card font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
            )}
          >
            {entry.label}
            {typeof entry.count === 'number' ? (
              <span className="rounded-full bg-secondary px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {entry.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {group === 'sections' && active ? (
        <div>
          <div className="flex flex-wrap gap-1 overflow-x-auto border-b px-3 py-2">
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setSectionKey(section.key)}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors',
                  active.key === section.key
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-secondary',
                )}
              >
                {section.title}
              </button>
            ))}
          </div>

          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold">{active.title}</h3>
                <p className="text-xs text-muted-foreground">{active.clause}</p>
              </div>
              <Badge tone="neutral">Read-only</Badge>
            </div>

            {active.rows.length === 0 ? (
              <div className="p-5">
                <Empty>This section has no saved values.</Empty>
              </div>
            ) : (
              <dl className="divide-y">
                {active.rows.map((row) => (
                  <div
                    key={row.label}
                    className="grid gap-1 px-5 py-2.5 text-sm odd:bg-secondary/20 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4"
                  >
                    <dt className="text-xs text-muted-foreground">{row.label}</dt>
                    <dd className="break-words">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </div>
      ) : null}

      {group === 'consents' ? (
        <CardContent className="p-0">
          {consents.length === 0 && agreements.length === 0 ? (
            <div className="p-5">
              <Empty>No consents or agreements recorded.</Empty>
            </div>
          ) : (
            <div className="divide-y">
              <div>
                <p className="bg-secondary/40 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Consent records
                </p>
                {consents.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted-foreground">No consents recorded.</p>
                ) : (
                  <ul className="divide-y">
                    {consents.map((consent) => (
                      <li
                        key={consent.id}
                        className="flex flex-wrap items-center gap-3 px-5 py-3 odd:bg-secondary/20"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {consent.label}
                            {consent.doctorName ? (
                              <span className="text-muted-foreground"> · {consent.doctorName}</span>
                            ) : null}
                          </p>
                          {consent.text ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">{consent.text}</p>
                          ) : null}
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {humanise(consent.method)} · {formatDateTime(consent.capturedAt)} · v
                            {consent.version}
                            {consent.capturedBy ? ` · recorded by ${consent.capturedBy}` : ''}
                          </p>
                        </div>
                        {consent.revokedAt ? (
                          <Badge tone="danger">Revoked {formatDate(consent.revokedAt)}</Badge>
                        ) : (
                          <Badge tone="success">Active</Badge>
                        )}
                        {consent.evidenceUrl ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={async () => {
                              const response = await fetch(consent.evidenceUrl!);
                              const body = (await response.json()) as {
                                data?: { url?: string };
                              };
                              if (body.data?.url) {
                                window.open(body.data.url, '_blank', 'noopener,noreferrer');
                              }
                            }}
                          >
                            Evidence
                          </Button>
                        ) : (
                          <Badge tone="neutral">No file</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="bg-secondary/40 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Agreements
                </p>
                {agreements.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted-foreground">No agreement recorded.</p>
                ) : (
                  <ul className="divide-y">
                    {agreements.map((agreement) => (
                      <li
                        key={agreement.id}
                        className="flex flex-wrap items-center gap-3 px-5 py-3 odd:bg-secondary/20"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {agreement.name} · {agreement.version}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {agreement.signatoryName} ({agreement.signatoryDesignation}) ·{' '}
                            {agreement.place} · {formatDate(agreement.signedOn)} ·{' '}
                            {humanise(agreement.method)}
                          </p>
                          {agreement.stampReference ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Stamp reference: {agreement.stampReference}
                            </p>
                          ) : null}
                          {agreement.witnesses.length > 0 ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Witness:{' '}
                              {agreement.witnesses
                                .map((witness) => String(witness.name ?? 'unnamed'))
                                .join(', ')}
                            </p>
                          ) : null}
                        </div>
                        {agreement.revokedAt ? <Badge tone="danger">Revoked</Badge> : null}
                        {agreement.signedCopyUrl ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={async () => {
                              const response = await fetch(agreement.signedCopyUrl!);
                              const body = (await response.json()) as {
                                data?: { url?: string };
                              };
                              if (body.data?.url) {
                                window.open(body.data.url, '_blank', 'noopener,noreferrer');
                              }
                            }}
                          >
                            Signed copy
                          </Button>
                        ) : (
                          <Badge tone="neutral">No file</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </CardContent>
      ) : null}

      {group === 'documents' ? (
        <CardContent className="p-0">
          {documents.length === 0 ? (
            <div className="p-5">
              <Empty>No documents uploaded.</Empty>
            </div>
          ) : (
            <ul className="divide-y">
              {documents.map((document) => (
                <li
                  key={document.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 odd:bg-secondary/20"
                >
                  <FileIcon mimeType={document.mimeType} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{document.fileName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {humanise(document.role)} ·{' '}
                      {Math.max(1, Math.round(document.sizeBytes / 1024))} KB · uploaded{' '}
                      {formatDate(document.createdAt)}
                    </p>
                  </div>
                  {document.previewUrl ? (
                    <div className="flex items-center gap-2">
                      {document.mimeType.startsWith('image/') ? (
                        <a href={document.previewUrl} target="_blank" rel="noreferrer">
                          <img
                            src={document.previewUrl}
                            alt={document.fileName}
                            className="h-10 w-10 rounded border object-cover"
                          />
                        </a>
                      ) : null}
                      <a href={document.previewUrl} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline" className="h-8">
                          Preview
                        </Button>
                      </a>
                    </div>
                  ) : (
                    <Badge tone="neutral">No file stored</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      ) : null}

      {group === 'licences' ? (
        <CardContent className="p-0">
          {licences.length === 0 ? (
            <div className="p-5">
              <Empty>No licences recorded.</Empty>
            </div>
          ) : (
            <ul className="divide-y">
              {licences.map((licence) => (
                <li
                  key={licence.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 odd:bg-secondary/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm">{licence.number}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {humanise(licence.role)}
                      {licence.authority ? ` · ${licence.authority}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {licence.validTo ?? 'No validity date'}
                    </span>
                    <ExpiryBadge value={licence.validTo} />
                  </div>
                  <Badge tone={licence.status === 'active' ? 'success' : 'neutral'}>
                    {humanise(licence.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      ) : null}

      {group === 'history' ? (
        <CardContent className="p-5">
          {history.length === 0 ? (
            <Empty>No status changes yet.</Empty>
          ) : (
            <ol className="relative space-y-5 border-l pl-5">
              {history.map((entry) => (
                <li key={entry.id} className="relative text-sm">
                  <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
                  <p className="font-medium">
                    {entry.fromStatus ? (
                      <span className="text-muted-foreground">{entry.fromStatus} → </span>
                    ) : null}
                    {entry.toStatus}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(entry.at)}</p>
                  {entry.reason ? (
                    <p className="mt-1 rounded-md bg-secondary/60 px-2 py-1 text-xs">
                      {entry.reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      ) : null}

      {group === 'audit' ? (
        <CardContent className="p-5">
          {audit.length === 0 ? (
            <Empty>No audit entries for this provider.</Empty>
          ) : (
            <ol className="relative space-y-5 border-l pl-5">
              {audit.map((entry) => (
                <li key={entry.id} className="relative text-sm">
                  <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-slate-400" />
                  <p className="font-mono text-xs font-medium">{entry.action}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTime(entry.at)} · {entry.actorRole ?? 'system'}
                    {entry.actorUserId ? ` · ${entry.actorUserId.slice(0, 8)}` : ''}
                  </p>
                  {entry.changedFieldKeys.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.changedFieldKeys.slice(0, 8).map((field) => (
                        <span
                          key={field}
                          className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {field}
                        </span>
                      ))}
                      {entry.changedFieldKeys.length > 8 ? (
                        <span className="text-[10px] text-muted-foreground">
                          +{entry.changedFieldKeys.length - 8} more
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {entry.reason ? (
                    <p className="mt-1 text-xs text-muted-foreground">{entry.reason}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
