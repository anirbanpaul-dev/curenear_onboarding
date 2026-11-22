import Link from 'next/link';
import {
  organizationStatusLabels,
  providerTypeLabels,
  type OrganizationStatus,
  type ProviderType,
} from '@curenear/shared';
import { requireUser } from '@/server/session';
import { getServices } from '@/server/services';
import { formatDate, formatDateTime } from '@/lib/utils';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}

function Distribution({
  rows,
  labelFor,
}: {
  rows: Array<{ key: string; count: number }>;
  labelFor: (key: string) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-center justify-between text-xs">
            <span>{labelFor(row.key)}</span>
            <span className="tabular-nums text-muted-foreground">{row.count}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((row.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function StaffHomePage() {
  const session = await requireUser();
  const dashboard = await getServices().staffWorkspace.dashboard(session.actor);

  const count = (status: OrganizationStatus): number =>
    dashboard.byStatus.find((entry) => entry.status === status)?.count ?? 0;
  const awaitingReview = count('SUBMITTED') + count('UNDER_REVIEW');
  const monthDelta = dashboard.monthly.count - dashboard.monthly.previousCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back, {session.user.name}. This page only counts providers you onboarded.
          </p>
        </div>
        <Link href="/staff/providers/new" className={buttonVariants()}>
          Onboard a provider
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="My providers"
          value={dashboard.total}
          hint={`${dashboard.draftCount} still in draft`}
        />
        <Stat label="Drafts" value={count('DRAFT')} hint="Editable now" />
        <Stat label="Awaiting review" value={awaitingReview} hint="Submitted or under review" />
        <Stat
          label="Changes requested"
          value={count('CHANGES_REQUESTED')}
          hint="Returned by a reviewer"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Drafts needing attention</CardTitle>
                  <CardDescription>
                    Completeness measured against this provider type&apos;s required fields.
                  </CardDescription>
                </div>
                <Link
                  href="/staff/providers?status=DRAFT"
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  All drafts →
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {dashboard.drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No drafts in progress.</p>
              ) : (
                <ul className="divide-y">
                  {dashboard.drafts.map((draft) => (
                    <li key={draft.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/staff/providers/${draft.id}/edit`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {draft.legalName ?? 'Untitled draft'}
                          </Link>
                          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{draft.code}</span>
                            <span aria-hidden="true">·</span>
                            <span>{providerTypeLabels[draft.providerType]}</span>
                            <span aria-hidden="true">·</span>
                            <span>updated {formatDate(draft.updatedAt)}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-32">
                            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${draft.completenessPercent}%` }}
                              />
                            </div>
                            <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
                              {draft.completenessPercent}% complete
                            </p>
                          </div>
                          <Link
                            href={`/staff/providers/${draft.id}/edit`}
                            className={buttonVariants({ variant: 'outline', size: 'sm' })}
                          >
                            Resume
                          </Link>
                        </div>
                      </div>
                      {draft.missingRequired > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {draft.missingRequired} required field
                          {draft.missingRequired === 1 ? '' : 's'} missing
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {dashboard.draftCount > dashboard.drafts.length ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing the {dashboard.drafts.length} least complete of {dashboard.draftCount}{' '}
                  drafts.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Returned for changes</CardTitle>
              <CardDescription>
                Reviewers&apos; comments on your submissions, as addressed to you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dashboard.returned.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has been returned to you.</p>
              ) : (
                <ul className="space-y-3">
                  {dashboard.returned.map((item) => (
                    <li key={item.organizationId} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/staff/providers/${item.organizationId}/edit`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {item.organizationName ?? 'Untitled draft'}
                          </Link>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {item.organizationCode}
                          </p>
                        </div>
                        <Link
                          href={`/staff/providers/${item.organizationId}/edit`}
                          className={buttonVariants({ size: 'sm' })}
                        >
                          Fix changes
                        </Link>
                      </div>
                      <blockquote className="mt-2 border-l-2 pl-3 text-sm">
                        {item.comment}
                      </blockquote>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.requestedByName ? `${item.requestedByName} · ` : ''}
                        {formatDateTime(item.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expiring soon</CardTitle>
              <CardDescription>
                Licences and insurance on your providers expiring within 60 days, or already
                expired.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dashboard.expiring.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing expiring in the next 60 days.
                </p>
              ) : (
                <ul className="divide-y">
                  {dashboard.expiring.map((item) => (
                    <li
                      key={`${item.kind}:${item.organizationId}:${item.label}:${item.expiresOn}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/staff/providers/${item.organizationId}/edit`}
                          className="text-sm font-medium underline-offset-4 hover:underline"
                        >
                          {item.organizationName ?? 'Untitled draft'}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {item.label} · <span className="font-mono">{item.organizationCode}</span>
                        </p>
                      </div>
                      <Badge
                        tone={
                          new Date(item.expiresOn).getTime() < Date.now() ? 'danger' : 'warning'
                        }
                      >
                        {new Date(item.expiresOn).getTime() < Date.now() ? 'Expired' : 'Expires'}{' '}
                        {formatDate(item.expiresOn)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>This month</CardTitle>
              <CardDescription>{monthLabel(dashboard.monthly.month)}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{dashboard.monthly.count}</p>
              <p className="text-sm text-muted-foreground">
                provider{dashboard.monthly.count === 1 ? '' : 's'} onboarded
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {monthLabel(dashboard.monthly.previousMonth)}: {dashboard.monthly.previousCount}
                {monthDelta === 0
                  ? ' · same pace'
                  : ` · ${monthDelta > 0 ? '+' : ''}${monthDelta} vs last month`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By status</CardTitle>
            </CardHeader>
            <CardContent>
              <Distribution
                rows={dashboard.byStatus.map((entry) => ({
                  key: entry.status,
                  count: entry.count,
                }))}
                labelFor={(key) => organizationStatusLabels[key as OrganizationStatus] ?? key}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By type</CardTitle>
            </CardHeader>
            <CardContent>
              <Distribution
                rows={dashboard.byType.map((entry) => ({
                  key: entry.providerType,
                  count: entry.count,
                }))}
                labelFor={(key) => providerTypeLabels[key as ProviderType] ?? key}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Changes recorded on your providers.</CardDescription>
            </CardHeader>
            <CardContent>
              {dashboard.activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {dashboard.activity.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <p>
                        <span className="font-mono text-xs text-muted-foreground">
                          {entry.action}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.organizationName ?? 'Provider'} · {formatDateTime(entry.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
