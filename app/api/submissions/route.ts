/**
 * Submissions API
 *
 * GET /api/submissions - List all submissions for authenticated organization
 */

import { NextResponse } from "next/server";
import { withAuth, type ApiHandler } from "@/lib/api-auth";
import { submissionService } from "@/lib/services";
import { handleError } from "@/lib/core/ErrorHandler";
import { calculateSkip, createPaginatedResult } from "@/lib/domain/shared";
import prisma from "@/lib/prisma";
import { mintTrackingToken } from "@/lib/auth/trackingToken";
import type { SubmissionStatus, ValidationStatus, SubmissionType, SourceTag } from "@prisma/client";

/**
 * Map a submission's validation + latest signing state to the German status the
 * "Meine Nachrichten" page shows.
 */
function deriveOverallStatus(
  validationStatus: ValidationStatus,
  signingStatus: "signed" | "pending" | "failed",
): "Verifiziert" | "Ungültig" | "In Bearbeitung" {
  if (signingStatus === "signed") return "Verifiziert";
  if (validationStatus === "FAILED" || signingStatus === "failed") return "Ungültig";
  return "In Bearbeitung";
}

// =============================================================================
// GET - List Submissions for Organization
// =============================================================================

const handleGet: ApiHandler = async (request, auth) => {
  try {
    const url = new URL(request.url);

    // Pagination
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
    const skip = calculateSkip(page, limit);

    // Optional filters
    const filters: {
      status?: SubmissionStatus;
      validationStatus?: ValidationStatus;
      submissionType?: SubmissionType;
      sourceTag?: SourceTag;
    } = {};

    const statusParam = url.searchParams.get("status");
    if (statusParam) {
      filters.status = statusParam as SubmissionStatus;
    }

    const validationStatusParam = url.searchParams.get("validationStatus");
    if (validationStatusParam) {
      filters.validationStatus = validationStatusParam as ValidationStatus;
    }

    const submissionTypeParam = url.searchParams.get("submissionType");
    if (submissionTypeParam) {
      filters.submissionType = submissionTypeParam as SubmissionType;
    }

    const sourceTagParam = url.searchParams.get("sourceTag");
    if (sourceTagParam) {
      filters.sourceTag = sourceTagParam as SourceTag;
    }

    // Fetch submissions and total count
    const [submissions, total] = await Promise.all([
      submissionService.findManyByOrganization({
        organizationId: auth.organizationId!,
        skip,
        take: limit,
        filters,
      }),
      submissionService.countByOrganization({
        organizationId: auth.organizationId!,
        filters,
      }),
    ]);

    // Enrich each submission with the asset address, current signing status, an
    // overall status, and a re-minted tracking token (the "Copy JWS" button in
    // the erfassungs-app reads this). The token is re-minted on read — never stored.
    const assetIds = [
      ...new Set(
        submissions
          .map((s) => s.resourceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const [assets, signingRequests] = await Promise.all([
      prisma.asset.findMany({
        where: { id: { in: assetIds }, organizationId: auth.organizationId! },
        select: { id: true, externalId: true, address: true },
      }),
      prisma.signingRequest.findMany({
        where: { assetId: { in: assetIds } },
        orderBy: { updatedAt: "desc" },
        select: { assetId: true, status: true },
      }),
    ]);

    const assetById = new Map(assets.map((a) => [a.id, a]));
    // First (most recent) signing status per asset
    const signingByAsset = new Map<string, string>();
    for (const sr of signingRequests) {
      if (!signingByAsset.has(sr.assetId)) signingByAsset.set(sr.assetId, sr.status);
    }

    const rows = await Promise.all(
      submissions.map(async (s) => {
        const asset = s.resourceId ? assetById.get(s.resourceId) : undefined;
        const rawSigning = s.resourceId ? signingByAsset.get(s.resourceId) : undefined;
        const signingStatus: "signed" | "pending" | "failed" =
          rawSigning === "SIGNED" ? "signed" : rawSigning === "FAILED" ? "failed" : "pending";

        return {
          id: s.id,
          createdAt: s.submittedAt,
          asset: {
            externalId: asset?.externalId ?? null,
            address: asset?.address ?? null,
          },
          validationStatus: s.validationStatus,
          signingStatus,
          overallStatus: deriveOverallStatus(s.validationStatus, signingStatus),
          trackingToken: await mintTrackingToken({
            submissionId: s.id,
            organizationId: s.organizationId,
            assetId: s.resourceId ?? undefined,
            externalId: asset?.externalId ?? undefined,
          }),
        };
      }),
    );

    return NextResponse.json(createPaginatedResult(rows, page, limit, total));
  } catch (error) {
    return handleError(error);
  }
};

// =============================================================================
// Route Export
// =============================================================================

export const GET = withAuth(handleGet, {
  requiredScopes: ["submissions:read"],
});
