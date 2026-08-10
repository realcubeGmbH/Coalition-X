/**
 * KPI Service
 *
 * Handles KPI record creation with:
 * - Automatic data versioning per asset
 * - Schema version FK reference
 * - Validation status tracking
 * - Audit logging
 */

import prisma from "../prisma";
import { ApiError } from "../core/ErrorHandler";
import { Logger } from "../core/Logger";
import { schemaService } from "./SchemaService";
import { isJsonObject, toJsonValue } from "../utils/json";
import { computeChecksum, verifyChecksum } from "../utils/checksum";
import { normalizeKpiInput } from "./normalizer";
import { C1InputSchema } from "./c1-input";
import type { C1Input } from "./c1-input";
import { enrichKpiInput } from "./enricher";
import { mergeKpiData, evaluateCompleteness } from "./merger";
import type { MergeResult } from "./merger";
import { KpiDataSchema } from "./schema";
import type { KpiData } from "./schema";
import { validateDependencies } from "./validators";
import type { ValidationError } from "./validators";
import {
  validateInitialSubmission,
  extractScenarioInputs,
  isRecognisedBuildingUse,
  RECOGNISED_BUILDING_USES,
} from "./scenarios";
import { getKpiSigningService } from "../connectors/KpiSigningService";
import { getFraunhoferService } from "../connectors/FraunhoferService";
import { mintTrackingToken } from "../auth/trackingToken";
import type { KpiRecord, ValidationStatus, DataSource } from "@prisma/client";
import type { ServiceContext } from "../domain/shared";

// =============================================================================
// Types
// =============================================================================

export interface GetKpiParams {
  assetId: string;
  organizationId: string;
  version?: number;
}

export interface ListKpiParams {
  assetId: string;
  organizationId: string;
  limit?: number;
  offset?: number;
}

export interface KpiVersionWithSchema {
  id: string;
  assetId: string;
  dataVersion: number;
  schemaVersion: string;
  kpiData: unknown;
  validationStatus: ValidationStatus;
  validationErrors: unknown;
  source: DataSource;
  createdAt: Date;
}

export interface SubmitKpiWithValidationParams {
  assetId: string;
  organizationId: string;
  kpis: Record<string, unknown>;
  schemaVersion?: string;
  idempotencyKey?: string;
  ctx: ServiceContext;
}

export interface KpiSubmissionResult {
  data: {
    id: string;
    assetId: string;
    externalId?: string | null;
    dataVersion: number;
    schemaVersion: string;
    validationStatus: ValidationStatus;
    validationErrors?: object[];
    signingStatus?: "signed" | "pending" | "failed" | "skipped";
    createdAt: Date;
  };
  transactionId: string;
  /** Signed JWS the user presents later to track this submission / verify it. */
  trackingToken?: string;
  idempotent?: boolean;
  status: number;
}

export interface SubmitKpiByIdentifierParams {
  assetId?: string;
  externalId?: string;
  organizationId: string;
  kpis: Record<string, unknown>;
  schemaVersion?: string;
  idempotencyKey?: string;
  assetName?: string;
  assetAddress?: string;
  ctx: ServiceContext;
}

export interface KpiHistoryItem {
  id: string;
  dataVersion: number;
  schemaVersion: string;
  validationStatus: ValidationStatus;
  source: DataSource;
  createdAt: Date;
}

export interface KpiHistoryResult {
  data: KpiHistoryItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// =============================================================================
// KPI Service
// =============================================================================

export class KpiService {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger({ connector: "KpiService" });
  }

  /**
   * Create a new logger instance for a specific context
   */
  withLogger(logger: Logger): KpiService {
    return new KpiService(logger);
  }

  /**
   * Get latest KPI record for an asset
   */
  async getLatestKpi(params: GetKpiParams): Promise<KpiRecord | null> {
    const { assetId, organizationId } = params;

    const record = await prisma.kpiRecord.findFirst({
      where: {
        assetId,
        organizationId,
      },
      orderBy: { dataVersion: "desc" },
    });

    return record;
  }

  /**
   * Get specific version of KPI record for an asset
   */
  async getKpiByVersion(
    params: GetKpiParams & { version: number },
  ): Promise<KpiRecord | null> {
    const { assetId, organizationId, version } = params;

    const record = await prisma.kpiRecord.findFirst({
      where: {
        assetId,
        organizationId,
        dataVersion: version,
      },
    });

    return record;
  }

  /**
   * Get KPI version with schema info - throws if not found
   */
  async getKpiVersionWithSchema(
    assetId: string,
    version: number,
    organizationId: string,
  ): Promise<KpiVersionWithSchema> {
    // Verify asset exists and belongs to org
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    if (!asset) {
      throw ApiError.assetNotFound(assetId);
    }

    const record = await prisma.kpiRecord.findFirst({
      where: {
        assetId,
        dataVersion: version,
      },
      include: {
        schemaRegistry: {
          select: { version: true, name: true },
        },
      },
    });

    if (!record) {
      throw ApiError.notFound("KPI version", String(version));
    }

    return {
      id: record.id,
      assetId: record.assetId,
      dataVersion: record.dataVersion,
      schemaVersion: record.schemaRegistry.version,
      kpiData: record.kpiData,
      validationStatus: record.validationStatus,
      validationErrors: record.validationErrors,
      source: record.source,
      createdAt: record.createdAt,
    };
  }

  /**
   * List KPI records for an asset (history)
   */
  async listKpiHistory(params: ListKpiParams): Promise<{
    records: KpiRecord[];
    total: number;
  }> {
    const { assetId, organizationId, limit = 10, offset = 0 } = params;

    const [records, total] = await Promise.all([
      prisma.kpiRecord.findMany({
        where: {
          assetId,
          organizationId,
        },
        orderBy: { dataVersion: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.kpiRecord.count({
        where: {
          assetId,
          organizationId,
        },
      }),
    ]);

    return { records, total };
  }

  /**
   * List KPI history with schema info - formatted for API response
   */
  async listKpiHistoryWithSchema(
    params: ListKpiParams,
  ): Promise<KpiHistoryResult> {
    const { assetId, organizationId, limit = 10, offset = 0 } = params;

    // Verify asset exists
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    if (!asset) {
      throw ApiError.assetNotFound(assetId);
    }

    const [records, total] = await Promise.all([
      prisma.kpiRecord.findMany({
        where: { assetId, organizationId },
        orderBy: { dataVersion: "desc" },
        take: limit,
        skip: offset,
        include: {
          schemaRegistry: {
            select: { version: true },
          },
        },
      }),
      prisma.kpiRecord.count({
        where: { assetId, organizationId },
      }),
    ]);

    return {
      data: records.map((record) => ({
        id: record.id,
        dataVersion: record.dataVersion,
        schemaVersion: record.schemaRegistry.version,
        validationStatus: record.validationStatus,
        source: record.source,
        createdAt: record.createdAt,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + records.length < total,
      },
    };
  }

  /**
   * Submit KPI with full V0.9.2 validation + enrichment + merge workflow
   */
  async submitKpiWithValidation(
    params: SubmitKpiWithValidationParams,
  ): Promise<KpiSubmissionResult> {
    const {
      assetId,
      organizationId,
      kpis,
      schemaVersion,
      idempotencyKey,
      ctx,
    } = params;

    const startTime = Date.now();

    this.logger.setContext({
      organizationId,
      userId: ctx.userId,
      assetId,
    });

    // 1. Get schema
    const schema = await schemaService.getSchema(schemaVersion);

    // 2. Verify asset exists
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, organizationId },
    });

    if (!asset) {
      throw ApiError.assetNotFound(assetId);
    }

    // 3. Idempotency check
    if (idempotencyKey) {
      const existing = await prisma.submission.findUnique({
        where: { idempotencyKey },
        include: {
          kpiRecord: {
            include: {
              schemaRegistry: { select: { version: true } },
            },
          },
        },
      });

      if (existing && existing.kpiRecord) {
        this.logger.info("Idempotent request - returning existing result");
        return {
          data: {
            id: existing.kpiRecord.id,
            assetId: existing.kpiRecord.assetId,
            dataVersion: existing.kpiRecord.dataVersion,
            schemaVersion: existing.kpiRecord.schemaRegistry.version,
            validationStatus: existing.kpiRecord.validationStatus,
            validationErrors: existing.kpiRecord.validationErrors as
              | object[]
              | undefined,
            createdAt: existing.kpiRecord.createdAt,
          },
          transactionId: existing.id,
          idempotent: true,
          status: 200,
        };
      }
    }

    // 4. Normalize input (accepts kpi_1-1, 1-1, schema keys, or pre-sectioned)
    const normalized = normalizeKpiInput(kpis as Record<string, unknown>);

    if (normalized.unknownFields.length > 0) {
      this.logger.warn("Unknown KPI fields in submission", {
        unknownFields: normalized.unknownFields,
        assetId,
      });
    }

    // 5. Parse normalized input through C1 schema
    const c1Input: C1Input = {
      asset_id: assetId,
      schema_version: "0.9.2",
      kpis: normalized.kpis as C1Input["kpis"],
    };
    const parseResult = C1InputSchema.safeParse(c1Input);

    let validationStatus: ValidationStatus = "PASSED";
    let validationErrors: object[] = [];

    if (!parseResult.success) {
      validationStatus = "FAILED";
      validationErrors = parseResult.error.issues.map((e) => ({
        field: e.path.join("."),
        code: e.code,
        message: e.message,
      }));
    }

    // 6. Enrich slim input into V0.9.2 rich objects
    let enrichedData: KpiData | null = null;
    if (parseResult.success) {
      enrichedData = enrichKpiInput(parseResult.data, {
        userId: ctx.userId,
      });
    }

    // 7. Load latest KpiRecord — determines initial vs patch
    let mergeResult: MergeResult | null = null;
    let mergedData: KpiData | null = null;
    if (enrichedData) {
      const latestRecord = await prisma.kpiRecord.findFirst({
        where: { assetId },
        orderBy: { dataVersion: "desc" },
        select: {
          id: true,
          dataVersion: true,
          kpiData: true,
          checksum: true,
          validationStatus: true,
          submissionId: true,
          createdAt: true,
        },
      });

      const isInitialSubmission = !latestRecord;

      // 7a. Initial submission — enforce mandatory KPIs
      if (isInitialSubmission) {
        const scenarioInputs = extractScenarioInputs(enrichedData);

        if (!scenarioInputs) {
          validationStatus = "FAILED";
          validationErrors = [
            {
              field: "Property_Related_Data.KPI_1_2_Building_Completion_Year",
              code: "MISSING_REQUIRED",
              message:
                "KPI 1-2 (Year of construction) is required on initial submission to determine building scenario",
            },
            {
              field: "Property_Related_Data.KPI_3_1_Main_Use_Of_Building",
              code: "MISSING_REQUIRED",
              message:
                "KPI 3-1 (Primary use of building) is required on initial submission to determine building scenario",
            },
          ];
          enrichedData = null;
        } else if (!isRecognisedBuildingUse(scenarioInputs.primaryUse)) {
          // 3-1 is present but not a use we know (e.g. a raw ZIA code). Deriving
          // a scenario from it would silently assume Nichtwohnen and then report
          // that scenario's missing KPIs instead of the actual problem.
          validationStatus = "FAILED";
          validationErrors = [
            {
              field: "Property_Related_Data.KPI_3_1_Main_Use_Of_Building",
              code: "INVALID_VALUE",
              message: `KPI 3-1 (Primary use of building) must be one of: ${RECOGNISED_BUILDING_USES.join(", ")} — received "${String(scenarioInputs.primaryUse)}"`,
            },
          ];
          enrichedData = null;
        } else {
          const initialResult = validateInitialSubmission(
            enrichedData,
            scenarioInputs.constructionYear,
            scenarioInputs.primaryUse,
          );

          this.logger.info("Initial submission scenario derived", {
            scenario: initialResult.scenario,
            assetId,
          });

          if (!initialResult.valid) {
            validationStatus = "FAILED";
            validationErrors = initialResult.missingKpis.map((kpi) => ({
              field: `${kpi.section}.${kpi.schemaKey}`,
              code: "MISSING_REQUIRED",
              message: `KPI ${kpi.kpiNumber} (${kpi.label}) is required for ${initialResult.scenario} on initial submission`,
            }));
            enrichedData = null;
          }
        }
      }

      // 7b. Merge (initial: enriched data only; patch: merge with existing)
      if (enrichedData) {
        const existingData = latestRecord?.kpiData as KpiData | null;

        mergeResult = mergeKpiData(existingData, enrichedData, {
          submittedBy: ctx.userId,
        });
        mergedData = mergeResult.merged;

        // 7c. Checksum deduplication — skip if merged data is identical to latest
        if (latestRecord?.checksum && mergedData) {
          if (verifyChecksum(mergedData, latestRecord.checksum)) {
            this.logger.info("Duplicate submission detected via checksum", {
              assetId,
              checksum: latestRecord.checksum,
            });

            return {
              data: {
                id: latestRecord.id,
                assetId,
                externalId: asset.externalId,
                dataVersion: latestRecord.dataVersion,
                schemaVersion: schema.version,
                validationStatus: latestRecord.validationStatus,
                createdAt: latestRecord.createdAt,
              },
              transactionId: latestRecord.submissionId ?? latestRecord.id,
              idempotent: true,
              status: 200,
            };
          }
        }

        // 8. Validate merged result against V0.9.2 schema
        const schemaResult = KpiDataSchema.safeParse(mergedData);
        if (!schemaResult.success) {
          validationStatus = "FAILED";
          validationErrors = schemaResult.error.issues.map(
            (e: { path: PropertyKey[]; code: string; message: string }) => ({
              field: e.path.map(String).join("."),
              code: e.code,
              message: e.message,
            }),
          );
          mergedData = null;
        }

        // 9. Validate dependencies (unwraps .Value from elements)
        if (mergedData) {
          const depResult = validateDependencies(mergedData);
          if (!depResult.valid) {
            validationStatus = "FAILED";
            validationErrors = depResult.errors.map((e: ValidationError) => ({
              field: e.field,
              code: "DEPENDENCY_ERROR",
              message: e.message,
            }));
          }
        }
      }
    }

    // 10. Create submission record (always, for audit trail)
    const submission = await prisma.submission.create({
      data: {
        organizationId,
        userId: ctx.isOrgLevel ? null : ctx.userId,
        submissionType: "SINGLE",
        resourceType: "KpiRecord",
        resourceId: assetId,
        sourceTag: "PARTNER",
        status: validationStatus === "PASSED" ? "SUCCESS" : "FAILED",
        validationStatus,
        validationErrors:
          validationErrors.length > 0
            ? toJsonValue(validationErrors)
            : undefined,
        idempotencyKey,
        requestPayload: toJsonValue(kpis),
        kpiVersion: schema.version,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    // 11. If validation failed, return early
    if (validationStatus === "FAILED" || !mergedData) {
      const responseTime = Date.now() - startTime;
      await prisma.submission.update({
        where: { id: submission.id },
        data: { responseTime, completedAt: new Date() },
      });

      await this.logger.audit({
        action: "SUBMISSION_FAILED",
        resource: "Submission",
        resourceId: submission.id,
        payload: kpis,
        response: { validationStatus, validationErrors },
        schemaVersion: schema.version,
        statusCode: 400,
        ipAddress: ctx.ipAddress || undefined,
        userAgent: ctx.userAgent || undefined,
      });

      return {
        data: {
          id: submission.id,
          assetId,
          externalId: asset.externalId,
          dataVersion: 0,
          schemaVersion: schema.version,
          validationStatus,
          validationErrors,
          createdAt: submission.submittedAt,
        },
        transactionId: submission.id,
        status: 400,
      };
    }

    // 11b. C2 — Fraunhofer energy-class calculation (BEFORE C3 signing, so the
    // computed KPI 7-2 is part of the signed record). Source-agnostic: runs the
    // same whether the submission came from the app or a machine API call.
    // Never fails the submission — a Fraunhofer error is recorded, not thrown.
    try {
      const c2 = await getFraunhoferService().calculateAndApply({
        kpiData: mergedData,
        rawKpis: kpis as Record<string, unknown>,
        assetId,
        submissionId: submission.id,
        userId: ctx.userId,
      });
      if (c2.applied) {
        this.logger.info("C2 applied energy class", {
          data: { energyClass: c2.energyClass },
        });
      } else if (c2.error) {
        this.logger.warn("C2 failed; continuing without computed class", {
          data: { error: c2.error },
        });
      }
    } catch (err) {
      this.logger.warn("C2 step errored; continuing", {
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }

    // 12. Evaluate completeness and determine validationStatus
    const completeness = evaluateCompleteness(mergedData);
    const recordValidationStatus: ValidationStatus = completeness.isComplete
      ? "PASSED"
      : "PENDING";

    // 13. Create KPI record with merged data (optimistic locking via dataVersion)
    const latestVersion = await prisma.kpiRecord.findFirst({
      where: { assetId },
      orderBy: { dataVersion: "desc" },
      select: { dataVersion: true },
    });
    const nextDataVersion = (latestVersion?.dataVersion ?? 0) + 1;

    const checksum = computeChecksum(mergedData);

    const kpiRecord = await prisma.kpiRecord.create({
      data: {
        assetId,
        organizationId,
        submissionId: submission.id,
        dataVersion: nextDataVersion,
        schemaVersionId: schema.id,
        kpiData: toJsonValue(mergedData),
        checksum,
        validationStatus: recordValidationStatus,
        externalAssetId: asset.externalId || undefined,
        source: "API",
      },
    });

    // 14. Trust Layer signing via C3
    let signingStatus: "signed" | "failed" | "skipped" = "skipped";
    let signedKpiData: Record<string, unknown> | undefined;

    if (recordValidationStatus === "PASSED" && process.env.TRUST_LAYER_URL) {
      try {
        const result = await getKpiSigningService().signSubmittedKpis(
          kpiRecord.id,
          organizationId,
          assetId,
          { userId: ctx.userId, isOrgLevel: ctx.isOrgLevel },
        );

        if (result.signed) {
          signingStatus = "signed";
          signedKpiData = result.signedKpiData as Record<string, unknown> | undefined;
        } else {
          signingStatus = "failed";
          this.logger.warn("Trust Layer signing failed", {
            data: { kpiRecordId: kpiRecord.id, error: result.error },
          });
        }
      } catch (err) {
        signingStatus = "failed";
        this.logger.warn("Trust Layer signing exception", {
          data: {
            kpiRecordId: kpiRecord.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    // 15. Complete submission (after signing attempt)
    const responseTime = Date.now() - startTime;
    await prisma.submission.update({
      where: { id: submission.id },
      data: { responseTime, completedAt: new Date() },
    });

    // 16. Audit log
    await this.logger.audit({
      action: "KPI_SUBMITTED",
      resource: "KpiRecord",
      resourceId: kpiRecord.id,
      payload: kpis,
      response: {
        dataVersion: nextDataVersion,
        validationStatus: recordValidationStatus,
        mergeResult: mergeResult
          ? {
              changed: mergeResult.changedKpis.length,
              added: mergeResult.addedKpis.length,
              conflicts: mergeResult.conflictedKpis.length,
            }
          : undefined,
      },
      schemaVersion: schema.version,
      statusCode: 201,
      ipAddress: ctx.ipAddress || undefined,
      userAgent: ctx.userAgent || undefined,
    });

    // Signed tracking token — the user presents this later to track / verify.
    const trackingToken = await mintTrackingToken({
      submissionId: submission.id,
      assetId: kpiRecord.assetId,
      externalId: asset.externalId,
      dataVersion: kpiRecord.dataVersion,
      organizationId,
    });

    return {
      data: {
        id: kpiRecord.id,
        assetId: kpiRecord.assetId,
        externalId: asset.externalId,
        dataVersion: kpiRecord.dataVersion,
        schemaVersion: schema.version,
        validationStatus: recordValidationStatus,
        signingStatus,
        createdAt: kpiRecord.createdAt,
        ...(signingStatus === "signed" && signedKpiData && { kpiData: signedKpiData }),
      },
      transactionId: submission.id,
      trackingToken,
      status: 201,
    };
  }

  /**
   * Submit KPI by asset_id or external_id (for partner API)
   * Finds asset by identifier, returns error if not found
   */
  async submitKpiByIdentifier(
    params: SubmitKpiByIdentifierParams,
  ): Promise<KpiSubmissionResult> {
    const {
      assetId,
      externalId,
      organizationId,
      kpis,
      schemaVersion,
      idempotencyKey,
      ctx,
    } = params;

    // Set logger context for audit logging
    this.logger.setContext({
      organizationId,
      userId: ctx.userId,
      endpoint: "/api/assets/kpis",
      method: "POST",
    });

    // Validate that at least one identifier is provided
    if (!assetId && !externalId) {
      this.logger.warn("KPI submission missing identifier", {
        organizationId,
      });
      throw ApiError.validation("Either asset_id or external_id is required");
    }

    // Find or create asset by identifier
    let asset;
    if (assetId) {
      asset = await prisma.asset.findFirst({
        where: { id: assetId, organizationId },
      });
      if (!asset) {
        this.logger.warn("KPI submission for unknown asset_id", {
          assetId,
          organizationId,
        });
        throw ApiError.assetNotFound(assetId);
      }
    } else if (externalId) {
      // Find existing asset or create new one
      asset = await prisma.asset.findFirst({
        where: { externalId, organizationId },
      });

      if (!asset) {
        this.logger.info("Creating new asset for external_id", {
          externalId,
          organizationId,
        });

        asset = await prisma.asset.create({
          data: {
            organizationId,
            externalId,
            name: params.assetName || externalId,
            address: params.assetAddress,
            dataSource: "API",
            sourceTag: "PARTNER",
          },
        });

        this.logger.info("Asset created successfully", {
          assetId: asset.id,
          externalId,
        });
      }
    }

    this.logger.info("Asset found for KPI submission", {
      assetId: asset!.id,
      externalId: asset!.externalId,
    });

    // Delegate to existing method
    return this.submitKpiWithValidation({
      assetId: asset!.id,
      organizationId,
      kpis,
      schemaVersion,
      idempotencyKey,
      ctx,
    });
  }

  /**
   * Get full KPI record with schema info
   */
  async getKpiWithSchema(kpiRecordId: string, organizationId: string) {
    const record = await prisma.kpiRecord.findFirst({
      where: {
        id: kpiRecordId,
        organizationId,
      },
      include: {
        schemaRegistry: {
          select: {
            version: true,
            name: true,
          },
        },
        asset: {
          select: {
            id: true,
            name: true,
            externalId: true,
          },
        },
      },
    });

    return record;
  }

  /**
   * Update validation status
   */
  async updateValidationStatus(
    kpiRecordId: string,
    status: ValidationStatus,
    errors?: object,
  ): Promise<KpiRecord> {
    const record = await prisma.kpiRecord.update({
      where: { id: kpiRecordId },
      data: {
        validationStatus: status,
        validationErrors: errors,
      },
    });

    this.logger.info("Validation status updated", {
      id: kpiRecordId,
      status,
      hasErrors: !!errors,
    });

    return record;
  }

  /**
   * Get count of KPI records for an asset
   */
  async getVersionCount(assetId: string): Promise<number> {
    return prisma.kpiRecord.count({
      where: { assetId },
    });
  }

  /**
   * Compare two KPI records and return changed fields
   */
  async compareVersions(
    assetId: string,
    version1: number,
    version2: number,
  ): Promise<{
    changedFields: string[];
    record1: KpiRecord | null;
    record2: KpiRecord | null;
  }> {
    const [record1, record2] = await Promise.all([
      prisma.kpiRecord.findFirst({
        where: { assetId, dataVersion: version1 },
      }),
      prisma.kpiRecord.findFirst({
        where: { assetId, dataVersion: version2 },
      }),
    ]);

    const changedFields: string[] = [];

    if (record1 && record2) {
      // Safely extract KPI data using type guard
      const data1 = isJsonObject(record1.kpiData) ? record1.kpiData : {};
      const data2 = isJsonObject(record2.kpiData) ? record2.kpiData : {};

      // Find all unique keys
      const allKeys = new Set([...Object.keys(data1), ...Object.keys(data2)]);

      for (const key of allKeys) {
        if (JSON.stringify(data1[key]) !== JSON.stringify(data2[key])) {
          changedFields.push(key);
        }
      }
    }

    return { changedFields, record1, record2 };
  }
}

// =============================================================================
// Default Instance
// =============================================================================

export const kpiService = new KpiService();
