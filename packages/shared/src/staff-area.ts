import { z } from 'zod';
import { adminProviderListQuerySchema, type AdminProviderDirectoryRow } from './admin-directory';
import type { OrganizationStatus } from './provider-lifecycle';
import type { ProviderType } from './enums';

/**
 * The staff workspace (`/staff`).
 *
 * Everything here is scoped to `provider_organizations.created_by_user_id = me`:
 * the filter query deliberately has no `onboardedBy`, state or admin-only
 * filters, because a staff member must not be able to widen the scope through
 * a URL.
 */

export const staffProviderListQuerySchema = adminProviderListQuerySchema.omit({
  onboardedBy: true,
  state: true,
  district: true,
  licenceExpiringDays: true,
  missingDocuments: true,
});
export type StaffProviderListQuery = z.infer<typeof staffProviderListQuerySchema>;

/** A provider row in the staff list, with the one admin note addressed to them. */
export interface StaffProviderRow extends AdminProviderDirectoryRow {
  /** Latest CHANGES_REQUESTED comment; null unless the provider was returned. */
  changeRequest: { comment: string; at: Date } | null;
}

/** A provider returned by the reviewer, with the comment explaining why. */
export interface StaffChangeRequestRecord {
  organizationId: string;
  organizationCode: string;
  organizationName: string | null;
  comment: string;
  at: Date;
  requestedByName: string | null;
}

/** A licence or insurance policy of one of my providers that expires soon. */
export interface StaffExpiryRecord {
  organizationId: string;
  organizationCode: string;
  organizationName: string | null;
  kind: 'licence' | 'insurance';
  label: string;
  expiresOn: Date;
}

/** One audit entry on an organization I onboarded. */
export interface StaffActivityRecord {
  id: string;
  action: string;
  organizationId: string;
  organizationName: string | null;
  at: Date;
  actorRole: string | null;
}

/** A draft that is not ready to submit, with its completeness percentage. */
export interface StaffDraftAttention {
  id: string;
  code: string;
  legalName: string | null;
  providerType: ProviderType;
  completenessPercent: number;
  missingRequired: number;
  updatedAt: Date;
}

export interface StaffDashboard {
  total: number;
  byStatus: Array<{ status: OrganizationStatus; count: number }>;
  byType: Array<{ providerType: ProviderType; count: number }>;
  /** Incomplete drafts, least complete first. */
  drafts: StaffDraftAttention[];
  draftCount: number;
  returned: StaffChangeRequestRecord[];
  expiring: StaffExpiryRecord[];
  activity: StaffActivityRecord[];
  monthly: {
    /** `YYYY-MM` for the current month. */
    month: string;
    count: number;
    previousMonth: string;
    previousCount: number;
  };
}
