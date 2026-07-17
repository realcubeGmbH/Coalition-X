/**
 * Verification Portal — Step 2
 *
 * POST /api/verify/kpis
 * Body: { jws, orgDid } — the JWS from step 1 + the Org DID.
 * Returns the full signed KPI table (with per-KPI verified state). PUBLIC.
 *
 * Security: the JWS is the entitlement; orgDid must match the submission's
 * organization DID before any KPI detail is returned.
 * CAPTCHA/rate-limiting to be added later. PDF (AC3) not yet implemented.
 */

import { NextResponse } from "next/server";
import { handleError } from "@/lib/core/ErrorHandler";
import { verifyTrackingToken } from "@/lib/auth/trackingToken";
import {
  resolveSubmissionContext,
  resolveOrgDid,
  buildKpiTable,
  verifyRecordSignature,
} from "@/lib/kpi/verificationPortal";

export async function POST(request: Request) {
  try {
    let body: { jws?: string; orgDid?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.jws || !body.orgDid) {
      return NextResponse.json(
        { error: "invalid_request", message: "jws and orgDid are required" },
        { status: 400 },
      );
    }

    let payload;
    try {
      payload = await verifyTrackingToken(body.jws);
    } catch {
      return NextResponse.json(
        { error: "invalid_token", message: "Token is invalid or expired" },
        { status: 400 },
      );
    }

    const ctx = await resolveSubmissionContext(payload.sub);
    if (!ctx) {
      return NextResponse.json(
        { error: "not_found", message: "Submission not found" },
        { status: 404 },
      );
    }

    // DID gate — the input DID must match the submission's organization DID.
    const actualDid = await resolveOrgDid(ctx.organizationId);
    if (!actualDid || actualDid !== body.orgDid) {
      return NextResponse.json(
        { error: "did_mismatch", message: "Org DID does not match this submission" },
        { status: 403 },
      );
    }

    if (!ctx.kpiData) {
      return NextResponse.json(
        { error: "not_found", message: "No KPI data found for this submission" },
        { status: 404 },
      );
    }

    const verified = ctx.assetId
      ? await verifyRecordSignature(ctx.assetId, ctx.kpiData)
      : false;

    return NextResponse.json({
      asset: ctx.asset ?? { externalId: null, address: null },
      dataVersion: ctx.dataVersion,
      orgDid: body.orgDid,
      overallStatus: ctx.overallStatus,
      gueltigBis: ctx.gueltigBis,
      kpis: buildKpiTable(ctx.kpiData, verified),
    });
  } catch (error) {
    return handleError(error);
  }
}
