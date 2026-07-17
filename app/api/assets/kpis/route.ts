/**
 * Partner KPI Submission API
 *
 * POST /api/assets/kpis - Submit KPIs for an asset by external_id or asset_id
 *
 * This endpoint is designed for partners to submit KPIs using their own
 * identifiers (external_id) without needing to know Coalition X internal IDs.
 */

import { NextResponse } from "next/server";
import {
  withAuth,
  type ApiHandler,
  getClientIp,
  getUserAgent,
} from "@/lib/api-auth";
import { ApiError, handleError } from "@/lib/core/ErrorHandler";
import { kpiService } from "@/lib/kpi";
import { createServiceContext } from "@/lib/domain/shared";

// =============================================================================
// Types
// =============================================================================

interface SubmitKpiBody {
  asset_id?: string;
  external_id?: string;
  asset_name?: string;
  asset_address?: string;
  kpis: Record<string, unknown>;
  schema_version?: string;
  idempotency_key?: string;
}

// =============================================================================
// POST /api/assets/kpis - Submit KPI by identifier
// =============================================================================

const handlePost: ApiHandler = async (request, auth) => {
  try {
    // Parse body
    let body: SubmitKpiBody;
    try {
      body = await request.json();
    } catch {
      throw ApiError.invalidJson();
    }

    // Validate required fields
    if (!body.kpis) {
      throw ApiError.missingField("kpis");
    }

    if (!body.asset_id && !body.external_id) {
      throw ApiError.validation("Either asset_id or external_id is required");
    }

    const ctx = createServiceContext({
      userId: auth.userId,
      organizationId: auth.organizationId,
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
      isOrgLevel: auth.isOrgLevel,
      isSystemAdmin: auth.isSystemAdmin,
    });

    const result = await kpiService.submitKpiByIdentifier({
      assetId: body.asset_id,
      externalId: body.external_id,
      organizationId: auth.organizationId!,
      kpis: body.kpis,
      schemaVersion: body.schema_version,
      idempotencyKey: body.idempotency_key,
      assetName: body.asset_name,
      assetAddress: body.asset_address,
      ctx,
    });

    return NextResponse.json(
      {
        data: result.data,
        transactionId: result.transactionId,
        ...(result.trackingToken && { trackingToken: result.trackingToken }),
        ...(result.idempotent && { idempotent: true }),
      },
      { status: result.status }
    );
  } catch (error) {
    return handleError(error);
  }
};

// =============================================================================
// Route Export
// =============================================================================

export const POST = withAuth(handlePost, {
  requiredScopes: ["kpis:write"],
});
