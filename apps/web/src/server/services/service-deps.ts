import type { Repositories, UnitOfWork } from '@curenear/shared';

/** The persistence and clock dependencies every service receives. */
export interface ServiceDeps {
  repositories: Repositories;
  unitOfWork: UnitOfWork;
  now: () => Date;
  newId: () => string;
  sessionTtlHours?: number;
}

/** Request metadata recorded on audit rows. */
export interface RequestContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}
