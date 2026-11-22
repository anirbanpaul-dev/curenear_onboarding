'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import {
  organizationStatusLabels,
  providerTypeLabels,
  reviewVerificationStatusLabels,
  reviewVerificationStatuses,
  suspensionScopeLabels,
  suspensionScopes,
  type OrganizationStatus,
  type ReviewChecklistProgress,
  type ReviewDetail,
  type ReviewVerificationDto,
} from '@curenear/shared';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const statusTone: Record<
  OrganizationStatus,
  'neutral' | 'info' | 'success' | 'warning' | 'danger'
> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  SUSPENDED: 'danger',
  REJECTED: 'danger',
  TERMINATED: 'danger',
};

const verificationTone = {
  PENDING: 'neutral',
  VERIFIED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
  NOT_APPLICABLE: 'neutral',
} as const;

type VerificationForm = {
  status: ReviewVerificationDto['status'];
  source: string;
  evidence: string;
  reason: string;
  next: string;
};

function formOf(item: ReviewVerificationDto): VerificationForm {
  return {
    status: item.status,
    source: item.source ?? '',
    evidence: item.evidenceRef ?? '',
    reason: item.reason ?? '',
    next: item.nextVerificationOn ?? '',
  };
}

function progressPercent(checklist: ReviewChecklistProgress): number {
  if (checklist.required === 0) return 100;
  return Math.round(((checklist.verified + checklist.notApplicable) / checklist.required) * 100);
}

export function ReviewDetailView({ initial }: { initial: ReviewDetail }) {
  const [detail, setDetail] = useState(initial);
  const [forms, setForms] = useState<Record<string, VerificationForm>>(() =>
    Object.fromEntries(initial.verifications.map((item) => [item.item, formOf(item)])),
  );
  const [comments, setComments] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  const [changeComment, setChangeComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [scope, setScope] = useState<(typeof suspensionScopes)[number]>('WHOLE_PROFILE');
  const [scopeRef, setScopeRef] = useState('');
  const [reinstateReason, setReinstateReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const organization = detail.organization;

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/admin/review/${organization.id}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error?.message ?? 'Could not reload this provider');
      return;
    }
    const next = body.data as ReviewDetail;
    setDetail(next);
    setForms(Object.fromEntries(next.verifications.map((item) => [item.item, formOf(item)])));
  }, [organization.id]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function saveVerification(item: ReviewVerificationDto) {
    const form = forms[item.item];
    if (!form) return;
    await run(`verify:${item.item}`, async () => {
      const response = await fetch(
        `/api/v1/admin/review/${organization.id}/verifications/${encodeURIComponent(item.item)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: form.status,
            ...(form.source ? { source: form.source } : {}),
            ...(form.evidence ? { evidence_ref: form.evidence } : {}),
            ...(form.reason ? { reason: form.reason } : {}),
            ...(form.next ? { next_verification_on: form.next } : {}),
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? 'Could not save this item');
      }
      setNotice(`${item.label} saved`);
      await load();
    });
  }

  async function addComment(sectionKey: string) {
    const bodyText = comments[sectionKey]?.trim() ?? '';
    if (bodyText.length < 3) {
      setError('Write at least a few words before adding a comment');
      return;
    }
    await run(`comment:${sectionKey}`, async () => {
      const response = await fetch(`/api/v1/admin/review/${organization.id}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ section_key: sectionKey, body: bodyText }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Could not add the comment');
      setComments((current) => ({ ...current, [sectionKey]: '' }));
      setNotice('Comment added');
      await load();
    });
  }

  async function decide(payload: Record<string, unknown>, label: string) {
    await run(`decision:${label}`, async () => {
      const response = await fetch(`/api/v1/admin/review/${organization.id}/decisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const blocking = body?.error?.details?.blocking;
        throw new Error(
          blocking?.length
            ? `Verify every required item first: ${blocking
                .map((entry: { label: string }) => entry.label)
                .join(', ')}`
            : (body?.error?.message ?? 'Could not record the decision'),
        );
      }
      setNotice('Decision recorded and the onboarding staff notified');
      await load();
    });
  }

  const commentsBySection = useMemo(() => {
    const map = new Map<string, ReviewDetail['comments']>();
    for (const comment of detail.comments) {
      map.set(comment.sectionKey, [...(map.get(comment.sectionKey) ?? []), comment]);
    }
    return map;
  }, [detail.comments]);

  const knownSectionKeys = new Set(detail.sections.map((section) => section.key));
  const otherComments = detail.comments.filter(
    (comment) => !knownSectionKeys.has(comment.sectionKey),
  );

  const pendingBlocking = detail.verifications.filter(
    (item) => item.required && item.status !== 'VERIFIED' && item.status !== 'NOT_APPLICABLE',
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/admin/review"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">←</span> Review queue
        </Link>
        <Link
          href={`/admin/providers/${organization.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Full provider record
        </Link>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {organization.legalName ?? organization.code}
              </h1>
              <Badge tone={statusTone[organization.status]}>
                {organizationStatusLabels[organization.status]}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded border bg-secondary/60 px-1.5 py-0.5 font-mono">
                {organization.code}
              </span>
              <span>{providerTypeLabels[organization.providerType]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{organization.primaryPinCode ?? 'No PIN'}</span>
              <span aria-hidden="true">·</span>
              <span>
                {organization.submittedAt
                  ? `Submitted ${new Date(organization.submittedAt).toLocaleString('en-IN')}`
                  : 'Not submitted'}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Onboarded by {detail.staff?.name ?? 'unknown staff'}
              {detail.staff?.email ? ` (${detail.staff.email})` : ''}
              {detail.assignment
                ? ` · Reviewer: ${detail.assignment.reviewerName}`
                : ' · Unassigned'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run('assign', async () => {
                  const response = await fetch(`/api/v1/admin/review/${organization.id}/assign`, {
                    method: 'POST',
                  });
                  const body = await response.json().catch(() => null);
                  if (!response.ok) {
                    throw new Error(body?.error?.message ?? 'Could not assign');
                  }
                  setNotice('Assigned to you');
                  await load();
                })
              }
            >
              Assign to me
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Checklist
            </p>
            <p className="mt-1 text-lg font-semibold">
              {detail.checklist.verified + detail.checklist.notApplicable}/
              {detail.checklist.required} settled
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{ width: `${progressPercent(detail.checklist)}%` }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Blocking items
            </p>
            <p className="mt-1 text-lg font-semibold">{detail.checklist.blocking}</p>
            <p className="text-xs text-muted-foreground">
              Required checks that are not verified yet
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Documents
            </p>
            <p className="mt-1 text-lg font-semibold">{detail.documents.length}</p>
            <p className="text-xs text-muted-foreground">Uploaded evidence files</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {detail.sections.map((section) => (
            <Card key={section.key}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-sm">{section.title}</CardTitle>
                  <Badge tone={flagged.includes(section.key) ? 'warning' : 'neutral'}>
                    {flagged.includes(section.key) ? 'Flagged for changes' : section.key}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid gap-2 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <div key={field.key} className="rounded border bg-secondary/20 p-2">
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {field.label}
                      </dt>
                      <dd className="mt-0.5 break-words text-sm">{field.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="rounded border p-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Section comments
                  </p>
                  {(commentsBySection.get(section.key) ?? []).length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">No comments yet.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {(commentsBySection.get(section.key) ?? []).map((comment) => (
                        <li key={comment.id} className="rounded bg-secondary/40 p-2 text-xs">
                          <p>{comment.body}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {comment.authorName} ·{' '}
                            {new Date(comment.createdAt).toLocaleString('en-IN')}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={comments[section.key] ?? ''}
                      placeholder="Comment visible to the onboarding staff"
                      onChange={(event) =>
                        setComments((current) => ({
                          ...current,
                          [section.key]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void addComment(section.key)}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {otherComments.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Other section notes</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-xs">
                  {otherComments.map((comment) => (
                    <li key={comment.id}>
                      <span className="font-mono text-muted-foreground">{comment.sectionKey}:</span>{' '}
                      {comment.body}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.documents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No documents uploaded.</p>
              ) : (
                detail.documents.map((document) => (
                  <a
                    key={document.id}
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded border p-2 text-xs hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{document.fileName}</span>
                      <span className="text-muted-foreground">{document.documentTypeName}</span>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </a>
                ))
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Verification checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {detail.verifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Checklist items are generated when the provider submits.
            </p>
          ) : (
            detail.verifications.map((item) => {
              const form = forms[item.item] ?? formOf(item);
              return (
                <div key={item.id} className="rounded border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {item.label}
                        {item.required ? (
                          <span className="ml-2 text-[11px] text-muted-foreground">required</span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.sectionKey ?? 'general'}
                        {item.verifiedAt
                          ? ` · checked ${new Date(item.verifiedAt).toLocaleString('en-IN')}`
                          : ''}
                      </p>
                    </div>
                    <Badge tone={verificationTone[item.status]}>
                      {reviewVerificationStatusLabels[item.status]}
                    </Badge>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <label className="space-y-1 text-[11px]">
                      <span className="text-muted-foreground">Status</span>
                      <select
                        className="h-8 w-full rounded-md border bg-card px-2 text-xs"
                        value={form.status}
                        onChange={(event) =>
                          setForms((current) => ({
                            ...current,
                            [item.item]: {
                              ...form,
                              status: event.target.value as VerificationForm['status'],
                            },
                          }))
                        }
                      >
                        {reviewVerificationStatuses.map((status) => (
                          <option key={status} value={status}>
                            {reviewVerificationStatusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-[11px]">
                      <span className="text-muted-foreground">Source</span>
                      <Input
                        value={form.source}
                        placeholder="NMC register"
                        onChange={(event) =>
                          setForms((current) => ({
                            ...current,
                            [item.item]: { ...form, source: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-[11px]">
                      <span className="text-muted-foreground">Evidence ref</span>
                      <Input
                        value={form.evidence}
                        onChange={(event) =>
                          setForms((current) => ({
                            ...current,
                            [item.item]: { ...form, evidence: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-[11px]">
                      <span className="text-muted-foreground">Reason</span>
                      <Input
                        value={form.reason}
                        onChange={(event) =>
                          setForms((current) => ({
                            ...current,
                            [item.item]: { ...form, reason: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="space-y-1 text-[11px]">
                      <span className="text-muted-foreground">Re-verify on</span>
                      <Input
                        type="date"
                        value={form.next}
                        onChange={(event) =>
                          setForms((current) => ({
                            ...current,
                            [item.item]: { ...form, next: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['VERIFIED', 'REJECTED', 'NOT_APPLICABLE'] as const).map((status) => (
                      <Button
                        key={status}
                        size="sm"
                        variant={status === 'REJECTED' ? 'destructive' : 'outline'}
                        disabled={busy !== null}
                        onClick={() => {
                          const nextForm = { ...form, status } as VerificationForm;
                          if (status === 'REJECTED' && !nextForm.reason.trim()) {
                            setError('Give a reason before rejecting this item');
                            return;
                          }
                          setForms((current) => ({ ...current, [item.item]: nextForm }));
                          void run(`verify:${item.item}`, async () => {
                            const response = await fetch(
                              `/api/v1/admin/review/${organization.id}/verifications/${encodeURIComponent(item.item)}`,
                              {
                                method: 'PATCH',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({
                                  status,
                                  ...(nextForm.source ? { source: nextForm.source } : {}),
                                  ...(nextForm.evidence ? { evidence_ref: nextForm.evidence } : {}),
                                  ...(nextForm.reason ? { reason: nextForm.reason } : {}),
                                  ...(nextForm.next ? { next_verification_on: nextForm.next } : {}),
                                }),
                              },
                            );
                            const body = await response.json().catch(() => null);
                            if (!response.ok) {
                              throw new Error(body?.error?.message ?? 'Could not save this item');
                            }
                            setNotice(`${item.label} marked ${status.toLowerCase()}`);
                            await load();
                          });
                        }}
                      >
                        {status === 'VERIFIED'
                          ? 'Verify'
                          : status === 'REJECTED'
                            ? 'Reject'
                            : 'Not applicable'}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => void saveVerification(item)}
                    >
                      Save details
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">Decision</CardTitle>
            {pendingBlocking.length > 0 ? (
              <Badge tone="warning">
                {pendingBlocking.length} required item(s) must be settled before approval
              </Badge>
            ) : (
              <Badge tone="success">Approval ready</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy !== null ||
                !detail.canApprove ||
                (organization.status !== 'SUBMITTED' && organization.status !== 'UNDER_REVIEW')
              }
              onClick={() => void decide({ decision: 'approve' }, 'approve')}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null || detail.canSuspend === false}
              onClick={() => {
                setError(null);
                setNotice('Fill the suspension scope and reason below, then confirm suspension');
              }}
            >
              Suspend…
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null || !detail.canReinstate}
              onClick={() => {
                setError(null);
                setNotice('Add a reinstatement reason below, then confirm');
              }}
            >
              Reinstate…
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded border p-3">
              <p className="text-sm font-medium">Request changes</p>
              <p className="text-xs text-muted-foreground">
                Flag the sections the staff must fix and leave a comment. At least one section and a
                comment are required.
              </p>
              <div className="flex flex-wrap gap-2">
                {detail.sections.map((section) => (
                  <label key={section.key} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={flagged.includes(section.key)}
                      onChange={(event) =>
                        setFlagged((current) =>
                          event.target.checked
                            ? [...current, section.key]
                            : current.filter((key) => key !== section.key),
                        )
                      }
                    />
                    {section.title}
                  </label>
                ))}
              </div>
              <textarea
                className="min-h-20 w-full rounded-md border bg-card p-2 text-sm"
                placeholder="What needs to change?"
                value={changeComment}
                onChange={(event) => setChangeComment(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || flagged.length === 0 || changeComment.trim().length < 5}
                onClick={() =>
                  void decide(
                    {
                      decision: 'request_changes',
                      comment: changeComment.trim(),
                      sections: flagged,
                    },
                    'changes',
                  )
                }
              >
                Request changes
              </Button>
            </div>

            <div className="space-y-2 rounded border p-3">
              <p className="text-sm font-medium">Reject</p>
              <textarea
                className="min-h-20 w-full rounded-md border bg-card p-2 text-sm"
                placeholder="Reason shown to the onboarding staff"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={busy !== null || rejectReason.trim().length < 5}
                onClick={() =>
                  void decide({ decision: 'reject', reason: rejectReason.trim() }, 'reject')
                }
              >
                Reject application
              </Button>
            </div>

            <div className="space-y-2 rounded border p-3">
              <p className="text-sm font-medium">Suspend (approved providers)</p>
              <select
                className="h-9 w-full rounded-md border bg-card px-2 text-sm"
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value as typeof scope);
                  setScopeRef('');
                }}
              >
                {suspensionScopes.map((value) => (
                  <option key={value} value={value}>
                    {suspensionScopeLabels[value]}
                  </option>
                ))}
              </select>
              {scope === 'LOCATION' ? (
                <select
                  className="h-9 w-full rounded-md border bg-card px-2 text-sm"
                  value={scopeRef}
                  onChange={(event) => setScopeRef(event.target.value)}
                >
                  <option value="">Choose a location</option>
                  {detail.scopeOptions.locations.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {scope === 'SERVICE_CATEGORY' ? (
                <select
                  className="h-9 w-full rounded-md border bg-card px-2 text-sm"
                  value={scopeRef}
                  onChange={(event) => setScopeRef(event.target.value)}
                >
                  <option value="">Choose a service category</option>
                  {detail.scopeOptions.services.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <textarea
                className="min-h-16 w-full rounded-md border bg-card p-2 text-sm"
                placeholder="Suspension reason"
                value={suspendReason}
                onChange={(event) => setSuspendReason(event.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  busy !== null ||
                  !detail.canSuspend ||
                  suspendReason.trim().length < 5 ||
                  (scope !== 'WHOLE_PROFILE' && !scopeRef)
                }
                onClick={() =>
                  void decide(
                    {
                      decision: 'suspend',
                      reason: suspendReason.trim(),
                      scope,
                      ...(scopeRef ? { scope_ref_id: scopeRef } : {}),
                    },
                    'suspend',
                  )
                }
              >
                Suspend
              </Button>
              {detail.suspension ? (
                <p className="text-xs text-muted-foreground">
                  Last suspension: {detail.suspension.scopeLabel ?? 'whole profile'} ·{' '}
                  {detail.suspension.reason ?? 'no reason recorded'}
                </p>
              ) : null}
            </div>

            <div className="space-y-2 rounded border p-3">
              <p className="text-sm font-medium">Reinstate</p>
              <textarea
                className="min-h-16 w-full rounded-md border bg-card p-2 text-sm"
                placeholder="Why is the suspension lifted?"
                value={reinstateReason}
                onChange={(event) => setReinstateReason(event.target.value)}
              />
              <Button
                size="sm"
                disabled={
                  busy !== null || !detail.canReinstate || reinstateReason.trim().length < 5
                }
                onClick={() =>
                  void decide(
                    { decision: 'reinstate', reason: reinstateReason.trim() },
                    'reinstate',
                  )
                }
              >
                Reinstate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
