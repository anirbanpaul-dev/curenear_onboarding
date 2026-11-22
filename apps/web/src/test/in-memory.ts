import { randomUUID } from 'node:crypto';
import type {
  AuditEntry,
  CouncilRecord,
  DistrictRecord,
  DocumentTypeRecord,
  FacilityTypeRecord,
  IdempotencyRecord,
  LicenceTypeRecord,
  PincodeRecord,
  ServiceCategoryRecord,
  SpecialtyRecord,
  StateRecord,
  OutboxEventRecord,
  ProviderPin,
  ProviderRecord,
  ProviderRevisionRecord,
  Repositories,
  SessionRecord,
  StaffMemberRecord,
  UserRecord,
  VerificationRecord,
} from '@curenear/shared';

export interface InMemoryStore {
  providers: ProviderRecord[];
  pins: Map<string, ProviderPin[]>;
  audits: AuditEntry[];
  outbox: OutboxEventRecord[];
  revisions: ProviderRevisionRecord[];
  verifications: VerificationRecord[];
  users: Array<
    UserRecord & {
      passwordHash: string;
      status: 'ACTIVE' | 'INACTIVE' | 'LOCKED';
      mustChangePassword: boolean;
      failedLoginCount: number;
      lockedUntil: Date | null;
      mobile?: string | null;
      employeeCode?: string | null;
      createdByUserId?: string | null;
      lastLoginAt?: Date | null;
      version?: number;
      updatedAt?: Date;
    }
  >;
  /** Territory PINs per staff user (the unique pair is enforced by the set). */
  staffPins: Map<string, string[]>;
  sessions: Array<SessionRecord & { tokenHash: string; revokedAt: Date | null }>;
  idempotency: Array<IdempotencyRecord & { userId: string; endpoint: string }>;
  passwordResets: Array<{
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
  }>;
  /** Master data rows; tests seed only what they assert on. */
  master: {
    states: StateRecord[];
    districts: DistrictRecord[];
    pincodes: PincodeRecord[];
    specialties: SpecialtyRecord[];
    councils: CouncilRecord[];
    serviceCategories: ServiceCategoryRecord[];
    documentTypes: DocumentTypeRecord[];
    licenceTypes: LicenceTypeRecord[];
    facilityTypes: FacilityTypeRecord[];
  };
}

/**
 * Fakes implement the repository ports, so service tests exercise real business
 * rules without a database. Transaction semantics are irrelevant in memory.
 */
export function createInMemoryRepositories(): {
  repositories: Repositories;
  store: InMemoryStore;
} {
  const store: InMemoryStore = {
    providers: [],
    pins: new Map(),
    audits: [],
    outbox: [],
    revisions: [],
    verifications: [],
    users: [],
    staffPins: new Map(),
    sessions: [],
    idempotency: [],
    passwordResets: [],
    master: {
      states: [],
      districts: [],
      pincodes: [],
      specialties: [],
      councils: [],
      serviceCategories: [],
      documentTypes: [],
      licenceTypes: [],
      facilityTypes: [],
    },
  };

  function toStaff(row: InMemoryStore['users'][number]): StaffMemberRecord {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      mobile: row.mobile ?? null,
      employeeCode: row.employeeCode ?? null,
      role: row.role,
      status: row.status,
      mustChangePassword: row.mustChangePassword,
      pinCodes: [...(store.staffPins.get(row.id) ?? [])].sort(),
      createdByUserId: row.createdByUserId ?? null,
      lastLoginAt: row.lastLoginAt ?? null,
      version: row.version ?? 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.createdAt,
      deletedAt: row.deletedAt,
    };
  }

  const repositories: Repositories = {
    // The in-memory store backs the legacy flat-provider tests; onboarding runs
    // against Prisma in the integration suite.
    onboarding: {} as Repositories['onboarding'],
    consents: {} as Repositories['consents'],
    staffWorkspace: {} as Repositories['staffWorkspace'],
    analytics: {} as Repositories['analytics'],
    reviews: {} as Repositories['reviews'],
    notifications: {} as Repositories['notifications'],
    system: {} as Repositories['system'],
    // Exports are covered by the integration suite against PostgreSQL.
    exports: {} as Repositories['exports'],
    documents: {} as Repositories['documents'],
    directory: {} as Repositories['directory'],
    providers: {
      async findById(id, options) {
        const found = store.providers.find((row) => row.id === id) ?? null;
        if (!found) return null;
        if (!options?.includeDeleted && found.deletedAt) return null;
        return { ...found };
      },

      async list(filters, page, sort) {
        let rows = store.providers.filter((row) => !row.deletedAt);
        if (filters.search) {
          const needle = filters.search.toLowerCase();
          rows = rows.filter((row) =>
            [row.displayName, row.legalName, row.city]
              .filter((value): value is string => Boolean(value))
              .some((value) => value.toLowerCase().includes(needle)),
          );
        }
        if (filters.providerTypes?.length) {
          rows = rows.filter((row) => filters.providerTypes?.includes(row.providerType));
        }
        if (filters.statuses?.length) {
          rows = rows.filter((row) => filters.statuses?.includes(row.status));
        }
        if (filters.createdByUserId) {
          rows = rows.filter((row) => row.createdByUserId === filters.createdByUserId);
        }
        if (filters.city) {
          rows = rows.filter((row) => row.city?.toLowerCase() === filters.city?.toLowerCase());
        }
        if (filters.pin) {
          rows = rows.filter((row) =>
            (store.pins.get(row.id) ?? []).some((pin) => pin.pinCode === filters.pin),
          );
        }
        rows = [...rows].sort((a, b) => {
          const direction = sort.order === 'asc' ? 1 : -1;
          if (sort.field === 'displayName') {
            return (a.displayName ?? '').localeCompare(b.displayName ?? '') * direction;
          }
          if (sort.field === 'status') return a.status.localeCompare(b.status) * direction;
          if (sort.field === 'providerType') {
            return a.providerType.localeCompare(b.providerType) * direction;
          }
          if (sort.field === 'updatedAt') {
            return (a.updatedAt.getTime() - b.updatedAt.getTime()) * direction;
          }
          return (a.createdAt.getTime() - b.createdAt.getTime()) * direction;
        });
        return {
          rows: rows.slice(page.skip, page.skip + page.take).map((row) => ({ ...row })),
          total: rows.length,
        };
      },

      async create(input) {
        const timestamp = new Date();
        const row: ProviderRecord = {
          id: randomUUID(),
          providerType: input.providerType,
          status: 'draft',
          displayName: input.displayName,
          legalName: input.legalName,
          data: input.data,
          primaryPinCode: input.primaryPinCode,
          city: input.city,
          version: input.version,
          createdByUserId: input.createdByUserId,
          submittedAt: null,
          reviewedAt: null,
          reviewedByUserId: null,
          decisionReason: null,
          deletedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        store.providers.push(row);
        store.pins.set(row.id, input.pins);
        return { ...row };
      },

      async updateOptimistic(input) {
        const index = store.providers.findIndex((row) => row.id === input.id);
        const current = store.providers[index];
        if (!current || current.deletedAt || current.version !== input.expectedVersion) return null;
        const updated: ProviderRecord = {
          ...current,
          ...input.patch,
          version: current.version + 1,
          updatedAt: new Date(),
        };
        store.providers[index] = updated;
        store.pins.set(updated.id, input.patch.pins);
        return { ...updated };
      },

      async changeStatus(input) {
        const index = store.providers.findIndex((row) => row.id === input.id);
        const current = store.providers[index];
        if (
          !current ||
          current.deletedAt ||
          current.version !== input.expectedVersion ||
          current.status !== input.fromStatus
        ) {
          return null;
        }
        const updated: ProviderRecord = {
          ...current,
          status: input.toStatus,
          version: current.version + 1,
          reviewedAt: input.reviewedAt,
          reviewedByUserId: input.reviewedByUserId,
          decisionReason: input.decisionReason,
          submittedAt: input.submittedAt ?? current.submittedAt,
          updatedAt: new Date(),
        };
        store.providers[index] = updated;
        return { ...updated };
      },

      async softDelete(input) {
        const index = store.providers.findIndex((row) => row.id === input.id);
        const current = store.providers[index];
        if (!current || current.deletedAt || current.version !== input.expectedVersion) return null;
        const updated: ProviderRecord = {
          ...current,
          deletedAt: input.deletedAt,
          decisionReason: input.reason,
          version: current.version + 1,
        };
        store.providers[index] = updated;
        return { ...updated };
      },

      async replacePins(providerId, pins) {
        store.pins.set(providerId, pins);
      },

      async createRevision(input) {
        store.revisions.push({
          id: input.id,
          providerId: input.providerId,
          version: input.version,
          status: input.status,
          changedByUserId: input.changedByUserId,
          changedFieldKeys: input.changedFieldKeys,
          createdAt: input.createdAt,
        });
      },

      async listRevisions(providerId, limit) {
        return store.revisions
          .filter((row) => row.providerId === providerId)
          .sort((a, b) => b.version - a.version)
          .slice(0, limit);
      },

      async countByStatus() {
        const counts = new Map<ProviderRecord['status'], number>();
        for (const row of store.providers.filter((entry) => !entry.deletedAt)) {
          counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
      },

      async countByType() {
        const counts = new Map<ProviderRecord['providerType'], number>();
        for (const row of store.providers.filter((entry) => !entry.deletedAt)) {
          counts.set(row.providerType, (counts.get(row.providerType) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([providerType, count]) => ({
          providerType,
          count,
        }));
      },

      async topPins(limit) {
        const counts = new Map<string, number>();
        for (const row of store.providers.filter((entry) => !entry.deletedAt)) {
          for (const pin of store.pins.get(row.id) ?? []) {
            counts.set(pin.pinCode, (counts.get(pin.pinCode) ?? 0) + 1);
          }
        }
        return Array.from(counts.entries())
          .map(([pinCode, count]) => ({ pinCode, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);
      },

      async listDataForExpiryScan(limit) {
        return store.providers
          .filter((row) => !row.deletedAt)
          .slice(0, limit)
          .map((row) => ({ id: row.id, data: row.data }));
      },
    },

    verifications: {
      async listByProvider(providerId) {
        return store.verifications.filter((row) => row.providerId === providerId);
      },
      async upsert(input) {
        const existing = store.verifications.find(
          (row) => row.providerId === input.providerId && row.item === input.item,
        );
        if (existing) {
          Object.assign(existing, input, { updatedAt: new Date() });
          return { ...existing };
        }
        const record: VerificationRecord = {
          ...input,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.verifications.push(record);
        return { ...record };
      },
    },

    audits: {
      async append(input) {
        store.audits.push({ ...input });
      },
      async listForEntity(entityType, entityId, limit) {
        return store.audits
          .filter((row) => row.entityType === entityType && row.entityId === entityId)
          .slice(-limit)
          .reverse();
      },
      async listRecent(limit) {
        return store.audits.slice(-limit).reverse();
      },
    },

    outbox: {
      async append(input) {
        store.outbox.push({
          id: input.id,
          eventType: input.eventType,
          eventVersion: input.eventVersion,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload: input.payload,
          occurredAt: input.occurredAt,
          publishedAt: null,
          attempts: 0,
          lastError: null,
          dedupeKey: input.dedupeKey ?? null,
        });
      },
      async claimBatch(limit) {
        return store.outbox.filter((row) => !row.publishedAt).slice(0, limit);
      },
      async markPublished(id) {
        const row = store.outbox.find((entry) => entry.id === id);
        if (row) row.publishedAt = new Date();
      },
      async markFailed(id, error) {
        const row = store.outbox.find((entry) => entry.id === id);
        if (row) {
          row.attempts += 1;
          row.lastError = error;
        }
      },
      async markDeadLettered(id, error) {
        const row = store.outbox.find((entry) => entry.id === id);
        if (row) {
          row.lastError = error;
        }
      },
    },

    users: {
      async findByEmail(email) {
        const row = store.users.find((user) => user.email === email.toLowerCase());
        return row ? { ...row } : null;
      },
      async findById(id) {
        const row = store.users.find((user) => user.id === id);
        return row ? { ...row } : null;
      },
      async findForAuth(email) {
        const row = store.users.find((user) => user.email === email.toLowerCase());
        return row ? { ...row, deletedAt: row.deletedAt } : null;
      },
      async findAuthById(id) {
        const row = store.users.find((user) => user.id === id);
        return row ? { ...row, deletedAt: row.deletedAt } : null;
      },
      async create(input) {
        const row = {
          id: input.id,
          email: input.email.toLowerCase(),
          name: input.name,
          role: input.role,
          isActive: true,
          status: 'ACTIVE' as const,
          mustChangePassword: input.mustChangePassword ?? false,
          failedLoginCount: 0,
          lockedUntil: null,
          createdAt: new Date(),
          deletedAt: null,
          passwordHash: input.passwordHash,
        };
        store.users.push(row);
        return { ...row };
      },
      async recordFailedLogin(input) {
        const row = store.users.find((user) => user.id === input.id);
        if (!row) return;
        row.failedLoginCount = input.failedLoginCount;
        row.lockedUntil = input.lockedUntil;
        if (input.lockedUntil) row.status = 'LOCKED';
      },
      async recordSuccessfulLogin(input) {
        const row = store.users.find((user) => user.id === input.id);
        if (!row) return;
        row.failedLoginCount = 0;
        row.lockedUntil = null;
        row.status = 'ACTIVE';
      },
      async setPassword(input) {
        const row = store.users.find((user) => user.id === input.id);
        if (!row) return;
        row.passwordHash = input.passwordHash;
        row.mustChangePassword = input.mustChangePassword;
        row.failedLoginCount = 0;
        row.lockedUntil = null;
        row.status = 'ACTIVE';
      },
      async list(options) {
        const rows = store.users.filter((user) => !user.deletedAt);
        return {
          rows: rows.slice(options.skip, options.skip + options.take).map((row) => ({ ...row })),
          total: rows.length,
        };
      },
      async softDelete(input) {
        const row = store.users.find((user) => user.id === input.id && !user.deletedAt);
        if (!row) return null;
        row.deletedAt = input.deletedAt;
        row.isActive = false;
        row.status = 'INACTIVE';
        return { ...row };
      },
      async listByRole(role) {
        return store.users
          .filter((user) => user.role === role && !user.deletedAt && user.status === 'ACTIVE')
          .map((user) => ({ ...user }));
      },
    },

    staff: {
      async findById(id, options) {
        const row = store.users.find(
          (user) => user.id === id && (options?.includeDeleted || !user.deletedAt),
        );
        return row ? toStaff(row) : null;
      },
      async findByEmail(email) {
        const row = store.users.find((user) => user.email === email.toLowerCase());
        return row ? toStaff(row) : null;
      },
      async findByEmployeeCode(employeeCode) {
        const row = store.users.find((user) => user.employeeCode === employeeCode);
        return row ? toStaff(row) : null;
      },
      async list(filters, page) {
        const search = filters.search?.trim().toLowerCase();
        let rows = store.users.filter((user) => !user.deletedAt && user.role === 'STAFF');
        if (filters.status) rows = rows.filter((user) => user.status === filters.status);
        if (search) {
          rows = rows.filter((user) =>
            [user.name, user.email, user.employeeCode ?? '', user.mobile ?? ''].some((value) =>
              value.toLowerCase().includes(search),
            ),
          );
        }
        rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
        return {
          rows: rows.slice(page.skip, page.skip + page.take).map(toStaff),
          total: rows.length,
        };
      },
      async create(input) {
        const row = {
          id: input.id,
          email: input.email.toLowerCase(),
          name: input.name,
          role: 'STAFF' as const,
          isActive: true,
          status: 'ACTIVE' as const,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          passwordHash: input.passwordHash,
          mobile: input.mobile,
          employeeCode: input.employeeCode,
          createdByUserId: input.createdByUserId,
          lastLoginAt: null,
          version: 1,
        };
        store.users.push(row);
        store.staffPins.set(input.id, [...new Set(input.pinCodes)]);
        return toStaff(row);
      },
      async update(input) {
        const row = store.users.find((user) => user.id === input.id);
        if (!row) return null;
        if (input.name !== undefined) row.name = input.name;
        if (input.mobile !== undefined) row.mobile = input.mobile;
        if (input.employeeCode !== undefined) row.employeeCode = input.employeeCode;
        if (input.pinCodes !== undefined) {
          store.staffPins.set(input.id, [...new Set(input.pinCodes)]);
        }
        row.version = (row.version ?? 1) + 1;
        row.updatedAt = new Date();
        return toStaff(row);
      },
      async setStatus(input) {
        const row = store.users.find((user) => user.id === input.id);
        if (!row) return null;
        row.status = input.status;
        row.isActive = input.status === 'ACTIVE';
        if (input.deletedAt !== undefined) row.deletedAt = input.deletedAt;
        row.version = (row.version ?? 1) + 1;
        row.updatedAt = new Date();
        return toStaff(row);
      },
      async countProviders(staffUserId) {
        return store.providers.filter((row) => row.createdByUserId === staffUserId).length;
      },
    },

    sessions: {
      async create(input) {
        const owner = store.users.find((user) => user.id === input.userId);
        store.sessions.push({
          id: input.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          createdAt: new Date(),
          lastSeenAt: null,
          revokedAt: null,
          role: owner?.role ?? 'STAFF',
          mustChangePassword: owner?.mustChangePassword ?? false,
          user: owner
            ? { ...owner }
            : {
                id: input.userId,
                email: 'staff@example.com',
                name: 'Staff',
                role: 'STAFF',
                isActive: true,
                createdAt: new Date(),
                deletedAt: null,
              },
        });
      },
      async touch(input) {
        const row = store.sessions.find((session) => session.id === input.id && !session.revokedAt);
        if (!row) return;
        row.expiresAt = input.expiresAt;
        row.lastSeenAt = input.lastSeenAt;
      },
      async revokeAllForUser(userId, revokedAt) {
        let count = 0;
        for (const session of store.sessions) {
          if (session.userId === userId && !session.revokedAt) {
            session.revokedAt = revokedAt;
            count += 1;
          }
        }
        return count;
      },
      async findValidByTokenHash(tokenHash, now) {
        return (
          store.sessions.find(
            (session) =>
              session.tokenHash === tokenHash && session.expiresAt > now && !session.revokedAt,
          ) ?? null
        );
      },
      async revokeByTokenHash(tokenHash, revokedAt) {
        const row = store.sessions.find(
          (session) => session.tokenHash === tokenHash && !session.revokedAt,
        );
        if (row) row.revokedAt = revokedAt;
      },
      async deleteExpired(now) {
        const before = store.sessions.length;
        store.sessions = store.sessions.filter((session) => session.expiresAt > now);
        return before - store.sessions.length;
      },
    },

    idempotency: {
      async find(input) {
        const row =
          store.idempotency.find(
            (entry) =>
              entry.userId === input.userId &&
              entry.endpoint === input.endpoint &&
              entry.key === input.key,
          ) ?? null;
        return row
          ? {
              key: row.key,
              requestHash: row.requestHash,
              response: row.response,
              createdAt: row.createdAt,
            }
          : null;
      },
      async save(input) {
        store.idempotency.push({ ...input, createdAt: new Date() });
      },
    },

    master: {
      states: {
        async list() {
          return [...store.master.states].sort((a, b) => a.name.localeCompare(b.name));
        },
      },

      districts: {
        async list(stateId) {
          return store.master.districts
            .filter((district) => !stateId || district.stateId === stateId)
            .sort((a, b) => a.name.localeCompare(b.name));
        },
      },

      pincodes: {
        async search({ q, limit }) {
          const needle = q.trim().toLowerCase();
          return store.master.pincodes
            .filter(
              (pin) =>
                pin.isActive &&
                (pin.pinCode.startsWith(needle) || pin.officeName.toLowerCase().startsWith(needle)),
            )
            .slice(0, limit);
        },
        async findByPin(pinCode) {
          return store.master.pincodes.find((pin) => pin.pinCode === pinCode) ?? null;
        },
        async stats() {
          return {
            totalPins: store.master.pincodes.length,
            totalDistricts: store.master.districts.length,
            lastUpdatedAt: null,
          };
        },
      },

      specialties: {
        async list(filters = {}) {
          const search = filters.search?.trim().toLowerCase();
          return store.master.specialties
            .filter((row) => filters.includeInactive || row.isActive)
            .filter(
              (row) =>
                !search ||
                row.code.toLowerCase().includes(search) ||
                row.name.toLowerCase().includes(search),
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        },
        async findById(id) {
          return store.master.specialties.find((row) => row.id === id) ?? null;
        },
        async findByCode(code) {
          return store.master.specialties.find((row) => row.code === code) ?? null;
        },
        async create(input) {
          const now = new Date();
          const row: SpecialtyRecord = {
            id: input.id,
            code: input.code,
            name: input.name,
            systemOfMedicine: input.systemOfMedicine,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
          store.master.specialties.push(row);
          return row;
        },
        async update(input) {
          const row = store.master.specialties.find((entry) => entry.id === input.id);
          if (!row) return null;
          Object.assign(row, {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.systemOfMedicine === undefined
              ? {}
              : { systemOfMedicine: input.systemOfMedicine }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            updatedAt: new Date(),
          });
          return row;
        },
      },

      councils: {
        async list(filters = {}) {
          const search = filters.search?.trim().toLowerCase();
          return store.master.councils
            .filter((row) => filters.includeInactive || row.isActive)
            .filter((row) => !filters.stateId || row.stateId === filters.stateId)
            .filter(
              (row) =>
                !search ||
                row.code.toLowerCase().includes(search) ||
                row.name.toLowerCase().includes(search),
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        },
        async findById(id) {
          return store.master.councils.find((row) => row.id === id) ?? null;
        },
        async findByCode(code) {
          return store.master.councils.find((row) => row.code === code) ?? null;
        },
        async create(input) {
          const now = new Date();
          const row: CouncilRecord = {
            id: input.id,
            code: input.code,
            name: input.name,
            kind: input.kind,
            stateId: input.stateId ?? null,
            stateName:
              store.master.states.find((state) => state.id === input.stateId)?.name ?? null,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
          store.master.councils.push(row);
          return row;
        },
        async update(input) {
          const row = store.master.councils.find((entry) => entry.id === input.id);
          if (!row) return null;
          Object.assign(row, {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.kind === undefined ? {} : { kind: input.kind }),
            ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            updatedAt: new Date(),
          });
          row.stateName =
            store.master.states.find((state) => state.id === row.stateId)?.name ?? null;
          return row;
        },
      },

      serviceCategories: {
        async list(filters = {}) {
          const search = filters.search?.trim().toLowerCase();
          return store.master.serviceCategories
            .filter((row) => filters.includeInactive || row.isActive)
            .filter((row) => !filters.providerType || row.providerType === filters.providerType)
            .filter(
              (row) =>
                !search ||
                row.code.toLowerCase().includes(search) ||
                row.name.toLowerCase().includes(search),
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        },
        async findById(id) {
          return store.master.serviceCategories.find((row) => row.id === id) ?? null;
        },
        async findByCode(code) {
          return store.master.serviceCategories.find((row) => row.code === code) ?? null;
        },
        async create(input) {
          const now = new Date();
          const row: ServiceCategoryRecord = {
            id: input.id,
            code: input.code,
            name: input.name,
            providerType: input.providerType,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
          store.master.serviceCategories.push(row);
          return row;
        },
        async update(input) {
          const row = store.master.serviceCategories.find((entry) => entry.id === input.id);
          if (!row) return null;
          Object.assign(row, {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.providerType === undefined ? {} : { providerType: input.providerType }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            updatedAt: new Date(),
          });
          return row;
        },
      },

      documentTypes: {
        async list(filters = {}) {
          const search = filters.search?.trim().toLowerCase();
          return store.master.documentTypes
            .filter((row) => filters.includeInactive || row.isActive)
            .filter(
              (row) => !filters.providerType || row.providerTypes.includes(filters.providerType),
            )
            .filter(
              (row) =>
                !search ||
                row.code.toLowerCase().includes(search) ||
                row.name.toLowerCase().includes(search),
            )
            .sort((a, b) => a.name.localeCompare(b.name));
        },
        async findById(id) {
          return store.master.documentTypes.find((row) => row.id === id) ?? null;
        },
        async findByCode(code) {
          return store.master.documentTypes.find((row) => row.code === code) ?? null;
        },
        async create(input) {
          const now = new Date();
          const row: DocumentTypeRecord = {
            id: input.id,
            code: input.code,
            name: input.name,
            providerTypes: [...input.providerTypes],
            requiresExpiry: input.requiresExpiry,
            expiryReminderDays: [...input.expiryReminderDays],
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };
          store.master.documentTypes.push(row);
          return row;
        },
        async update(input) {
          const row = store.master.documentTypes.find((entry) => entry.id === input.id);
          if (!row) return null;
          Object.assign(row, {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.providerTypes === undefined
              ? {}
              : { providerTypes: [...input.providerTypes] }),
            ...(input.requiresExpiry === undefined ? {} : { requiresExpiry: input.requiresExpiry }),
            ...(input.expiryReminderDays === undefined
              ? {}
              : { expiryReminderDays: [...input.expiryReminderDays] }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            updatedAt: new Date(),
          });
          return row;
        },
      },

      licenceTypes: {
        async list() {
          return store.master.licenceTypes;
        },
      },

      facilityTypes: {
        async list() {
          return store.master.facilityTypes;
        },
      },
    },

    passwordResets: {
      async create(input) {
        store.passwordResets.push({ ...input, usedAt: null });
      },
      async findValid(tokenHash, now) {
        const row = store.passwordResets.find(
          (token) => token.tokenHash === tokenHash && !token.usedAt && token.expiresAt > now,
        );
        return row ? { id: row.id, userId: row.userId } : null;
      },
      async markUsed(input) {
        const row = store.passwordResets.find((token) => token.id === input.id && !token.usedAt);
        if (row) row.usedAt = input.usedAt;
      },
      async invalidateForUser(input) {
        for (const token of store.passwordResets) {
          if (token.userId === input.userId && !token.usedAt) token.usedAt = input.usedAt;
        }
      },
    },
  };

  return { repositories, store };
}
