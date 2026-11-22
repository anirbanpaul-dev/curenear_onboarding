import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AppError,
  adminProviderListQuerySchema,
  organizationStatusLabels,
  providerTypeLabels,
  staffStatusLabels,
  type StaffStatus,
} from '@curenear/shared';
import { requirePermission } from '@/server/session';
import { getServices } from '@/server/services';
import { formatDate, formatDateTime } from '@/lib/utils';
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

export const dynamic = 'force-dynamic';

const statusTone: Record<StaffStatus, 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  LOCKED: 'warning',
  INACTIVE: 'danger',
};

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('staff.manage');
  const { id } = await params;

  let detail;
  try {
    detail = await getServices().staff.get(session.actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const { staff, recentAudit } = detail;
  const directory = await getServices().directory.list(
    session.actor,
    adminProviderListQuerySchema.parse({
      onboardedBy: staff.id,
      pageSize: 100,
      sort: 'created_at',
      order: 'desc',
    }),
  );
  const providers = directory.rows;
  const providerCount = directory.meta.total;
  const byStatus = directory.facets.byStatus;
  const byType = directory.facets.byType;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/staff" className="text-sm text-muted-foreground hover:underline">
          ← Staff
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{staff.name}</h1>
          <Badge tone={statusTone[staff.status]}>{staffStatusLabels[staff.status]}</Badge>
          {staff.mustChangePassword ? <Badge tone="info">Password change pending</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{staff.email}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Created {formatDate(staff.createdAt)}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-3 text-sm">
              <dt className="text-muted-foreground">Employee code</dt>
              <dd className="font-mono">{staff.employeeCode ?? '—'}</dd>
              <dt className="text-muted-foreground">Mobile</dt>
              <dd className="font-mono">{staff.mobile ?? '—'}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{staff.role === 'ADMIN' ? 'Administrator' : 'Onboarding staff'}</dd>
              <dt className="text-muted-foreground">Last sign-in</dt>
              <dd>{staff.lastLoginAt ? formatDateTime(staff.lastLoginAt) : 'Never'}</dd>
              <dt className="text-muted-foreground">Updated</dt>
              <dd>{formatDateTime(staff.updatedAt)}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Territory</CardTitle>
            <CardDescription>
              Reference only — access is decided by who onboarded the provider.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Assigned PIN codes
              </p>
              {staff.pinCodes.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No territory assigned.</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {staff.pinCodes.map((pin) => (
                    <li key={pin}>
                      <Badge tone="info" className="font-mono">
                        {pin}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-md border bg-secondary/50 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Providers onboarded
              </p>
              <p className="mt-1 text-2xl font-semibold">{providerCount}</p>
              <p className="text-xs text-muted-foreground">
                Records this account created, whatever their current status.
              </p>
            </div>
            {providerCount > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">By status</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {byStatus.map((entry) => (
                      <li key={entry.status} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          {organizationStatusLabels[entry.status]}
                        </span>
                        <span className="tabular-nums">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">By type</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {byType.map((entry) => (
                      <li key={entry.providerType} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          {providerTypeLabels[entry.providerType]}
                        </span>
                        <span className="tabular-nums">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Providers onboarded</CardTitle>
          <CardDescription>
            Newest first, up to 100. Open a provider to review its sections, documents and history.
          </CardDescription>
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
              {providers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    This person has not onboarded a provider yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {providers.map((provider) => (
                <TableRow key={provider.id}>
                  <TableCell>
                    <Link
                      href={`/admin/providers/${provider.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {provider.legalName ?? 'Untitled draft'}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {provider.code}
                    </span>
                  </TableCell>
                  <TableCell>{provider.providerType}</TableCell>
                  <TableCell>{provider.status}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {provider.primaryPinCode ?? '—'}
                  </TableCell>
                  <TableCell>{formatDate(provider.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Account changes recorded in the audit trail.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>When</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentAudit.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No activity yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {recentAudit.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell>{entry.actorRole ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
