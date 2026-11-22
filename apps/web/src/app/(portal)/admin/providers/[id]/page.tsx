import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AppError,
  documentRequirementsFor,
  organizationStatusLabels,
  providerTypeLabels,
  sectionsForProvider,
  type ProviderField,
} from '@curenear/shared';
import { requirePermission } from '@/server/session';
import { getServices } from '@/server/services';
import { createS3ObjectStorage } from '@/server/documents/object-storage';
import type { OrganizationDetail } from '@/server/services/provider-onboarding-service';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReviewActions } from '@/components/admin/review-actions';
import {
  ProviderDetailTabs,
  type AgreementView,
  type AuditView,
  type ConsentView,
  type DocumentView,
  type HistoryView,
  type LicenceView,
  type SectionView,
} from '@/components/admin/provider-detail-tabs';

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

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

function formatValue(field: ProviderField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (field.type === 'money') {
      return `₹${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    const strings = value.filter((entry): entry is string => typeof entry === 'string');
    if (strings.length === value.length) return strings.length ? strings.join(', ') : '—';
    return `${value.length} entr${value.length === 1 ? 'y' : 'ies'}`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.file_name === 'string') return String(record.file_name);
    if (record.line1) {
      return [record.line1, record.city, record.pin].filter(Boolean).join(', ');
    }
    const json = JSON.stringify(record);
    return json.length > 120 ? `${json.slice(0, 117)}…` : json;
  }
  if (field.type === 'date') return formatDate(String(value));
  return String(value);
}

function relatedSummary(field: ProviderField, detail: OrganizationDetail): string | null {
  if (field.storage.kind !== 'related') return null;
  const { table, role } = field.storage;
  switch (table) {
    case 'provider_licences': {
      const rows = detail.licences.filter((licence) =>
        role ? licence.details.role === role : true,
      );
      if (rows.length === 0) return '—';
      return rows
        .map(
          (licence) =>
            `${licence.number}${licence.validTo ? ` (to ${formatDate(licence.validTo)})` : ''}`,
        )
        .join('; ');
    }
    case 'provider_insurance':
      return detail.insurance.length === 0
        ? '—'
        : detail.insurance.map((row) => `${row.insurer} · ${row.policyNo}`).join('; ');
    case 'provider_locations':
      return detail.locations.length === 0
        ? '—'
        : detail.locations
            .map(
              (row) =>
                `${row.name}, ${row.city} ${row.pinCode}${row.isPrimary ? ' (primary)' : ''}`,
            )
            .join('; ');
    case 'provider_contacts':
      return detail.contacts.length === 0
        ? '—'
        : detail.contacts.map((row) => `${row.role}: ${row.name} · ${row.phone}`).join('; ');
    case 'provider_service_pins': {
      const rows = detail.servicePins.filter((row) => (role ? row.serviceKind === role : true));
      return rows.length === 0 ? '—' : rows.map((row) => row.pinCode).join(', ');
    }
    case 'provider_documents': {
      const rows = detail.documents.filter((row) => (role ? row.role === role : true));
      return rows.length === 0 ? '—' : rows.map((row) => row.fileName).join(', ');
    }
    case 'doctor_profiles':
      return detail.doctorProfile
        ? `${detail.doctorProfile.fullName} · ${detail.doctorProfile.registrationNo}`
        : '—';
    case 'doctor_locations':
      return `${detail.doctorPractices?.length ?? 0} practice(s)`;
    default:
      return '—';
  }
}

function initials(name: string | null | undefined): string {
  if (!name) return '—';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default async function AdminProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission('provider.read.all');
  const { id } = await params;
  const services = getServices();

  let record;
  try {
    record = await services.directory.get(session.actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const [duplicates, consentOverview] = await Promise.all([
    services.onboarding
      .listDuplicateWarnings(session.actor, id)
      .catch(() => ({ warnings: [], blocked: [] })),
    services.consents.get(session.actor, id),
  ]);

  const { detail, statusHistory, audit, staff } = record;
  const organization = detail.organization;

  // Presigned previews are generated on the server; the browser never sees keys.
  const storage = createS3ObjectStorage();
  const documentViews: DocumentView[] = await Promise.all(
    detail.documents.map(async (document) => {
      let previewUrl: string | null = null;
      if (document.storageKey) {
        try {
          previewUrl = await storage.createDownloadUrl({
            key: document.storageKey,
            expiresInSeconds: 600,
          });
        } catch {
          previewUrl = null;
        }
      }
      return {
        id: document.id,
        fileName: document.fileName,
        role: document.role ?? 'unclassified',
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        createdAt: document.createdAt.toISOString(),
        previewUrl,
      };
    }),
  );

  const licenceViews: LicenceView[] = detail.licences.map((licence) => ({
    id: licence.id,
    number: licence.number,
    role: typeof licence.details.role === 'string' ? licence.details.role : 'licence',
    authority: licence.authority,
    validTo: licence.validTo ? licence.validTo.toISOString().slice(0, 10) : null,
    status: licence.status,
  }));

  const sections: SectionView[] = sectionsForProvider(organization.providerType)
    .filter((section) => section.fields.length > 0)
    .map((section) => {
      const rows = section.fields
        .map((field) => {
          if (field.storage.kind === 'related') {
            return { label: field.label, value: relatedSummary(field, detail) ?? '—' };
          }
          if (field.storage.kind === 'column') {
            const column = field.storage.column;
            if (column.startsWith('profile_data.')) {
              return {
                label: field.label,
                value: formatValue(field, readPath(organization.profileData, column.slice(13))),
              };
            }
            if (column.startsWith('publication_consents.')) {
              return {
                label: field.label,
                value: formatValue(
                  field,
                  readPath(organization.publicationConsents, column.slice(21)),
                ),
              };
            }
            const key = column.startsWith('provider_organizations.')
              ? column.slice('provider_organizations.'.length)
              : column;
            const values: Record<string, unknown> = {
              legal_name: organization.legalName,
              trade_name: organization.tradeName,
              constitution_type: organization.constitutionType,
              registration_number: organization.registrationNumber,
              established_on: organization.establishedOn,
              website: organization.website,
              email: organization.email,
              mobile: organization.mobile,
              provider_type: organization.providerType,
            };
            return { label: field.label, value: formatValue(field, values[key]) };
          }
          return {
            label: field.label,
            value: formatValue(field, organization.typeData[field.key]),
          };
        })
        .filter((row) => row.value !== '—');

      return {
        key: section.key,
        title: section.title,
        clause: section.clause,
        rows,
      };
    });

  const doctorNameFor = (doctorProfileId: string | null): string | null => {
    if (!doctorProfileId) return null;
    const link = detail.clinicDoctors?.find((row) => row.doctor.id === doctorProfileId);
    return link?.doctor.fullName ?? detail.doctorProfile?.fullName ?? null;
  };

  const consentViews: ConsentView[] = consentOverview.consents.map((consent) => {
    const declarationKey =
      typeof consent.confirmationMeta.declarationKey === 'string'
        ? consent.confirmationMeta.declarationKey
        : null;
    const declaration = declarationKey
      ? consentOverview.declarations.find((entry) => entry.key === declarationKey)
      : null;
    const label = declaration
      ? declaration.label
      : consent.consentType === 'publication'
        ? 'Publication permission'
        : consent.consentType === 'data_privacy_notice'
          ? 'Privacy notice acknowledgement'
          : consent.consentType === 'doctor_confirmation'
            ? 'Doctor confirmation'
            : 'Partner agreement';
    return {
      id: consent.id,
      label,
      text: declaration?.text ?? null,
      method: consent.method,
      version: consent.textVersion,
      capturedAt: consent.capturedAt.toISOString(),
      capturedBy: consent.capturedByUserId
        ? consent.capturedByUserId === organization.createdByUserId
          ? (staff?.name ?? 'Staff')
          : 'Staff'
        : 'Provider (confirmation link)',
      revokedAt: consent.revokedAt ? consent.revokedAt.toISOString() : null,
      evidenceUrl: consent.evidenceDocumentId
        ? `/api/v1/providers/${organization.id}/consents/${consent.id}/evidence`
        : null,
      doctorName: doctorNameFor(consent.doctorProfileId),
    };
  });

  const agreementViews: AgreementView[] = consentOverview.agreements.map((agreement) => ({
    id: agreement.id,
    name: agreement.templateName ?? 'Partner agreement',
    version: agreement.templateVersion ?? '',
    method: agreement.method,
    signedOn: agreement.signedOn.toISOString(),
    place: agreement.place,
    signatoryName: agreement.signatoryName,
    signatoryDesignation: agreement.signatoryDesignation,
    stampReference: agreement.stampReference,
    witnesses: agreement.witnesses,
    signedCopyUrl: agreement.signedDocumentId
      ? `/api/v1/providers/${organization.id}/agreements/${agreement.id}/evidence`
      : null,
    revokedAt: agreement.revokedAt ? agreement.revokedAt.toISOString() : null,
  }));

  const history: HistoryView[] = statusHistory.map((entry) => ({
    id: entry.id,
    fromStatus: entry.fromStatus ? organizationStatusLabels[entry.fromStatus] : null,
    toStatus: organizationStatusLabels[entry.toStatus],
    at: entry.at.toISOString(),
    reason: entry.reason,
  }));

  const auditViews: AuditView[] = audit.map((entry) => ({
    id: entry.id,
    action: entry.action,
    at: entry.createdAt.toISOString(),
    actorRole: entry.actorRole,
    actorUserId: entry.actorUserId,
    reason: entry.reason,
    changedFieldKeys: entry.changedFieldKeys,
  }));

  const missingDocuments = documentRequirementsFor(organization.providerType).filter(
    (requirement) =>
      requirement.requirement === 'required' &&
      !detail.documents.some((document) => document.role === requirement.key),
  );

  const duplicateMatches = [...duplicates.blocked, ...duplicates.warnings];
  const openIssues =
    missingDocuments.length + duplicateMatches.length + consentOverview.gaps.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/providers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">←</span> Provider directory
        </Link>
        <Link
          href="/admin/providers"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          All providers
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-5 shadow-sm">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {organization.legalName ?? organization.tradeName ?? 'Untitled draft'}
            </h1>
            <Badge tone={statusTone[organization.status]}>
              {organizationStatusLabels[organization.status]}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded border bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {organization.code}
            </span>
            <span>{providerTypeLabels[organization.providerType]}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{organization.primaryPinCode ?? 'No PIN'}</span>
            <span aria-hidden="true">·</span>
            <span>
              {organization.submittedAt
                ? `Submitted ${formatDateTime(organization.submittedAt)}`
                : 'Not submitted'}
            </span>
            {organization.tradeName && organization.legalName ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{organization.tradeName}</span>
              </>
            ) : null}
          </div>
        </div>
        <ReviewActions providerId={organization.id} />
      </div>

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Onboarded by
          </p>
          <p className="mt-1.5 truncate text-sm font-semibold">{staff?.name ?? 'Unknown'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {staff?.email ?? organization.createdByUserId}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Created
          </p>
          <p className="mt-1.5 text-sm font-semibold">{formatDate(organization.createdAt)}</p>
          <p className="text-xs text-muted-foreground">Version {organization.version}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Completeness
          </p>
          <p className="mt-1.5 text-sm font-semibold">
            {detail.completeness.complete ? 'Complete' : 'Incomplete'}
          </p>
          <p className="text-xs text-muted-foreground">
            {detail.completeness.missingRequiredFields.length} field(s),{' '}
            {detail.completeness.missingDocuments.length} document(s) missing
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Licences
          </p>
          <p className="mt-1.5 text-sm font-semibold">{detail.licences.length}</p>
          <p className="text-xs text-muted-foreground">
            {licenceViews.filter((licence) => licence.validTo).length} with a validity date
          </p>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <ProviderDetailTabs
            sections={sections}
            documents={documentViews}
            licences={licenceViews}
            history={history}
            audit={auditViews}
            consents={consentViews}
            agreements={agreementViews}
          />
        </div>

        <aside className="space-y-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Needs attention</CardTitle>
                <Badge tone={openIssues > 0 ? 'warning' : 'success'}>
                  {openIssues > 0 ? `${openIssues} open` : 'Clear'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Required documents
                </p>
                {missingDocuments.length === 0 ? (
                  <p className="mt-1 text-emerald-700">All required documents uploaded.</p>
                ) : (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {missingDocuments.map((requirement) => (
                      <li key={requirement.key}>
                        <Badge tone="warning">{requirement.label}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Consents
                </p>
                {consentOverview.gaps.length === 0 ? (
                  <p className="mt-1 text-emerald-700">All required consents recorded.</p>
                ) : (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {consentOverview.gaps.map((gap) => (
                      <li key={`${gap.kind}:${gap.key}`}>
                        <Badge tone="warning">{gap.label}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Possible duplicates
                </p>
                {duplicateMatches.length === 0 ? (
                  <p className="mt-1 text-muted-foreground">No duplicate warnings.</p>
                ) : (
                  <ul className="mt-1.5 space-y-2">
                    {duplicateMatches.map((match) => (
                      <li key={`${match.kind}-${match.providerId}`} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={match.hardBlock ? 'danger' : 'warning'}>
                            {match.hardBlock ? 'Blocking' : 'Warning'}
                          </Badge>
                          <Link
                            href={`/admin/providers/${match.providerId}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {match.providerName ?? match.providerCode}
                          </Link>
                        </div>
                        <p className="text-xs text-muted-foreground">{match.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Onboarding</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {initials(staff?.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{staff?.name ?? 'Unknown'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {staff?.email ?? 'No staff account'}
                  </p>
                </div>
              </div>

              {staff ? (
                <Link
                  href={`/admin/staff/${staff.id}`}
                  className="inline-block text-xs text-primary underline-offset-4 hover:underline"
                >
                  View staff profile and their providers →
                </Link>
              ) : null}

              <dl className="space-y-1.5 border-t pt-3 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{formatDate(organization.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd>
                    {organization.submittedAt ? formatDate(organization.submittedAt) : 'Not yet'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Approved</dt>
                  <dd>
                    {organization.approvedAt ? formatDate(organization.approvedAt) : 'Not yet'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Version</dt>
                  <dd className="font-mono">{organization.version}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
