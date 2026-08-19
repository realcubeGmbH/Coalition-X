/**
 * Submission Tracking (Verification Portal — Step 1)
 *
 * POST /api/submissions/track
 * Body: { jws }  — the tracking token issued at submission.
 * Returns the request summary + status. PUBLIC (JWS is the credential).
 * CAPTCHA/rate-limiting to be added later.
 */

import { NextResponse } from "next/server";
import { handleError } from "@/lib/core/ErrorHandler";
import { verifyTrackingToken } from "@/lib/auth/trackingToken";
import { resolveSubmissionContext } from "@/lib/kpi/verificationPortal";

export async function POST(request: Request) {
  try {
    let body: { jws?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!body.jws) {
      return NextResponse.json(
        { error: "invalid_request", message: "jws is required" },
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

    return NextResponse.json({
      asset: ctx.asset ?? { externalId: null, address: null },
      dataVersion: ctx.dataVersion,
      organizationName: ctx.organizationName,
      validationStatus: ctx.validationStatus,
      signing: { status: ctx.signingStatus },
      fraunhofer: ctx.fraunhofer,
      overallStatus: ctx.overallStatus,
      ausgestelltAm: ctx.ausgestelltAm,
      gueltigBis: ctx.gueltigBis,
    });
  } catch (error) {
    return handleError(error);
  }
}
