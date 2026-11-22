import Link from 'next/link';
import {
  adminProviderListQuerySchema,
  organizationStatusLabels,
  providerTypeLabels,
} from '@curenear/shared';
import { requirePermission } from '@/server/session';
import { getServices } from '@/server/services';
import { formatDate } from '@/lib/utils';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

const statusTone = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  SUSPENDED: 'danger',
  REJECTED: 'danger',
  TERMINATED: 'danger',
} as const;

export default async function AdminOverviewPage() {
  const session = await requirePermission('provider.read.all');
  const services = getServices();

  const query = adminProviderListQuerySchema.parse({ pageSize: '6' });
  const [overview, recent, missing] = await Promise.all([
    services.directory.list(session.actor, query),
    services.directory.list(session.actor, query),
    services.directory.list(session.actor, {
      ...query,
      pageSize: 1,
      missingDocuments: true,
    }),
  ]);

  const statusCount = (status: string): number =>
    overview.facets.byStatus.find((row) => row.status === status)?.count ?? 0;
  const awaitingReview = statusCount('SUBMITTED') + statusCount('UNDER_REVIEW');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every provider onboarded into CureNear, across all staff members.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/providers" className={buttonVariants({ variant: 'outline' })}>
            Open directory
          </Link>
          <Link href="/staff/providers/new" className={buttonVariants()}>
            Onboard a provider
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total providers</CardDescription>
            <CardTitle className="text-3xl">
              {overview.meta.total.toLocaleString('en-IN')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">All live onboarding records</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Awaiting review</CardDescription>
            <CardTitle className="text-3xl">{awaitingReview.toLocaleString('en-IN')}</CardTitle>
            <p className="text-xs text-muted-foreground">Submitted or under review</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Approved</CardDescription>
            <CardTitle className="text-3xl">
              {statusCount('APPROVED').toLocaleString('en-IN')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">Live provider records</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Missing documents</CardDescription>
            <CardTitle className="text-3xl">{missing.meta.total.toLocaleString('en-IN')}</CardTitle>
            <p className="text-xs text-muted-foreground">Required document gaps</p>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>Recently added</CardTitle>
            <CardDescription>Newest onboarding records first.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      No providers yet. Start by onboarding one.
                    </TableCell>
                  </TableRow>
                ) : null}
                {recent.rows.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/admin/providers/${provider.id}`}
                      >
                        {provider.legalName ?? provider.tradeName ?? 'Untitled draft'}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {provider.code}
                      </span>
                    </TableCell>
                    <TableCell>{providerTypeLabels[provider.providerType]}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone[provider.status]}>
                        {organizationStatusLabels[provider.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {provider.primaryPinCode ?? '—'}
                    </TableCell>
                    <TableCell>{formatDate(provider.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4">
              <Link
                href="/admin/providers"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                View the full directory →
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>By status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {overview.facets.byStatus.length === 0 ? (
                <p className="text-muted-foreground">No data yet.</p>
              ) : null}
              {overview.facets.byStatus.map((row) => (
                <div key={row.status} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {organizationStatusLabels[row.status]}
                  </span>
                  <span className="font-medium">{row.count.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {overview.facets.byType.map((row) => (
                <div key={row.providerType} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {providerTypeLabels[row.providerType]}
                  </span>
                  <span className="font-medium">{row.count.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
