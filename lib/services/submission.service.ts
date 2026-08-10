/**
 * Submission Service
 *
 * Handles submission record management:
 * - Create submission records for KPI submissions
 * - Idempotency key checking
 * - Submission completion tracking
 */

import prisma from "@/lib/prisma";
import type {
  Submission,
  SubmissionType,
  SourceTag,
  SubmissionStatus,
  ValidationStatus,
  Prisma,
} from "@prisma/client";
import type { ServiceContext } from "@/lib/domain/shared";

// =============================================================================
// Types
// =============================================================================

export interface CreateSubmissionDto {
  submissionType: SubmissionType;
  resourceType: string;
  resourceId?: string;
  sourceTag?: SourceTag;
  status?: SubmissionStatus;
  validationStatus?: ValidationStatus;
  validationErrors?: Prisma.InputJsonValue;
  idempotencyKey?: string;
  requestPayload?: Prisma.InputJsonValue;
  kpiVersion?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  totalRecords?: number;
}

export interface SubmissionWithKpiRecord extends Submission {
  kpiRecord: {
    id: string;
    assetId: string;
    dataVersion: number;
    validationStatus: ValidationStatus;
    validationErrors: Prisma.JsonValue;
    createdAt: Date;
    schemaRegistry: {
      version: string;
    };
  } | null;
}

// =============================================================================
// Submission Service
// =============================================================================

export class SubmissionService {
  /**
   * Create a new submission record
   */
  async create(
    dto: CreateSubmissionDto,
    ctx: ServiceContext
  ): Promise<Submission> {
    return prisma.submission.create({
      data: {
        organizationId: ctx.organizationId!,
        userId: ctx.isOrgLevel ? null : ctx.userId,
        submissionType: dto.submissionType,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        sourceTag: dto.sourceTag ?? "PARTNER",
        status: dto.status ?? "PENDING",
        validationStatus: dto.validationStatus ?? "PENDING",
        validationErrors: dto.validationErrors,
        idempotencyKey: dto.idempotencyKey,
        requestPayload: dto.requestPayload,
        kpiVersion: dto.kpiVersion,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        totalRecords: dto.totalRecords ?? 1,
      },
    });
  }

  /**
   * Find submission by idempotency key with KPI record.
   *
   * The organization is required, not optional: an idempotency key is the
   * caller's own reference, so a key-only lookup can resolve to another
   * tenant's submission.
   */
  async findByIdempotencyKey(
    key: string,
    organizationId: string
  ): Promise<SubmissionWithKpiRecord | null> {
    return prisma.submission.findFirst({
      where: { idempotencyKey: key, organizationId },
      include: {
        kpiRecord: {
          include: {
            schemaRegistry: {
              select: { version: true },
            },
          },
        },
      },
    });
  }

  /**
   * Complete a submission with response time
   */
  async complete(id: string, responseTime: number): Promise<void> {
    await prisma.submission.update({
      where: { id },
      data: {
        responseTime,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Update submission status
   */
  async updateStatus(
    id: string,
    status: SubmissionStatus,
    validationStatus?: ValidationStatus,
    validationErrors?: Prisma.InputJsonValue
  ): Promise<Submission> {
    return prisma.submission.update({
      where: { id },
      data: {
        status,
        ...(validationStatus && { validationStatus }),
        ...(validationErrors && { validationErrors }),
      },
    });
  }

  /**
   * Get submission by ID
   */
  async getById(id: string): Promise<Submission | null> {
    return prisma.submission.findUnique({
      where: { id },
    });
  }

  /**
   * Get submission by ID with KPI record
   */
  async getByIdWithKpi(id: string): Promise<SubmissionWithKpiRecord | null> {
    return prisma.submission.findUnique({
      where: { id },
      include: {
        kpiRecord: {
          include: {
            schemaRegistry: {
              select: { version: true },
            },
          },
        },
      },
    });
  }

  /**
   * Find many submissions by organization with pagination
   */
  async findManyByOrganization(params: {
    organizationId: string;
    skip?: number;
    take?: number;
    filters?: {
      status?: SubmissionStatus;
      validationStatus?: ValidationStatus;
      submissionType?: SubmissionType;
      sourceTag?: SourceTag;
    };
  }): Promise<Submission[]> {
    const { organizationId, skip = 0, take = 20, filters = {} } = params;

    return prisma.submission.findMany({
      where: {
        organizationId,
        ...(filters.status && { status: filters.status }),
        ...(filters.validationStatus && {
          validationStatus: filters.validationStatus,
        }),
        ...(filters.submissionType && {
          submissionType: filters.submissionType,
        }),
        ...(filters.sourceTag && { sourceTag: filters.sourceTag }),
      },
      orderBy: {
        submittedAt: "desc",
      },
      skip,
      take,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Count submissions by organization
   */
  async countByOrganization(params: {
    organizationId: string;
    filters?: {
      status?: SubmissionStatus;
      validationStatus?: ValidationStatus;
      submissionType?: SubmissionType;
      sourceTag?: SourceTag;
    };
  }): Promise<number> {
    const { organizationId, filters = {} } = params;

    return prisma.submission.count({
      where: {
        organizationId,
        ...(filters.status && { status: filters.status }),
        ...(filters.validationStatus && {
          validationStatus: filters.validationStatus,
        }),
        ...(filters.submissionType && {
          submissionType: filters.submissionType,
        }),
        ...(filters.sourceTag && { sourceTag: filters.sourceTag }),
      },
    });
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const submissionService = new SubmissionService();
