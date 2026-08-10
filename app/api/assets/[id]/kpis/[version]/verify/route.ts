/**
 * KPI Signature Verification API
 *
 * GET /api/assets/:id/kpis/:version/verify - Verify signatures on a KPI record
 */

import { NextResponse } from "next/server";
import { withAuth, type ApiHandler } from "@/lib/api-auth";
import { handleError } from "@/lib/core/ErrorHandler";
import prisma from "@/lib/prisma";
import { TrustLayerClient } from "@/lib/connectors/TrustLayerClient";
import type { KpiData } from "@/lib/kpi/schema";
import { KPI_SECTIONS } from "@/lib/kpi/schema";

/**
 * Extract only the 4 KPI section keys from a full KpiData document.
 * This matches the scope that was signed by the Trust Layer (request.data).
 */
function extractSectionData(
  kpiData: KpiData,
): Record<string, Record<string, unknown>> {
  const sections: Record<string, Record<string, unknown>> = {};
  for (const section of KPI_SECTIONS) {
    const sectionValue = kpiData[section];
    if (sectionValue) {
      sections[section] = sectionValue as Record<string, unknown>;
    }
  }
  return sections;
}

const handleGet: ApiHandler = async (_request, auth, context) => {
  try {
    const { id, version } = await context.params;
    const dataVersion = parseInt(version, 10);

    if (isNaN(dataVersion)) {
      return NextResponse.json(
        { error: "Invalid version parameter" },
        { status: 400 },
      );
    }

    if (!auth.organizationId) {
      return NextResponse.json(
        { error: "Organization context required" },
        { status: 403 },
      );
    }

    const kpiRecord = await prisma.kpiRecord.findFirst({
      where: {
        assetId: id,
        organizationId: auth.organizationId,
        dataVersion,
      },
    });

    if (!kpiRecord) {
      return NextResponse.json(
        { error: "KPI record not found" },
        { status: 404 },
      );
    }

    const kpiData = kpiRecord.kpiData as KpiData;

    if (!kpiData.Signature) {
      return NextResponse.json({
        status: "UNSIGNED",
        message: "This KPI record has not been signed",
      });
    }

    if (!process.env.TRUST_LAYER_URL) {
      return NextResponse.json(
        { error: "Trust Layer is not configured" },
        { status: 503 },
      );
    }

    const client = new TrustLayerClient();

    // The seal for *this* version. The asset's newest seal belongs to whatever
    // version was signed last and would not match this record's data.
    const signingRequest = await prisma.signingRequest.findFirst({
      where: { kpiRecordId: kpiRecord.id, status: "SIGNED" },
      orderBy: { updatedAt: "desc" },
    });

    if (signingRequest?.verifierDetails) {
      const sealResponse = signingRequest.verifierDetails as Record<string, unknown>;
      const sectionData = extractSectionData(kpiData);

      const result = await client.verifySignature({
        mode: "full",
        seal_response: sealResponse as any,
        kpi_data: sectionData,
      });

      return NextResponse.json({
        status: result.status,
        dataVersion: kpiRecord.dataVersion,
        assetId: kpiRecord.assetId,
        verifiedAt: new Date().toISOString(),
        verificationMode: "full",
        ...(result.status === "FAILED" && { reason: result.reason }),
        ...(result.status === "VERIFIED" && {
          org_did: result.org_did,
          transaction_id: result.transaction_id,
          kpi_count: result.kpi_count,
        }),
      });
    }

    // Fallback for legacy records without stored seal_response:
    // Verify per-section using KPI mode with proper kpi_element
    const sectionData = extractSectionData(kpiData);
    const failures: string[] = [];

    for (const [section, kpis] of Object.entries(sectionData)) {
      for (const [kpiKey, kpiValue] of Object.entries(kpis)) {
        const element = kpiValue as Record<string, unknown>;
        if (!element.Signature) continue;

        const result = await client.verifySignature({
          mode: "kpi",
          jws: element.Signature as string,
          kpi_element: element,
        });

        if (result.status === "FAILED") {
          failures.push(`${section}.${kpiKey}: ${result.reason}`);
        }
      }
    }

    if (failures.length > 0) {
      return NextResponse.json({
        status: "FAILED",
        dataVersion: kpiRecord.dataVersion,
        assetId: kpiRecord.assetId,
        verifiedAt: new Date().toISOString(),
        verificationMode: "kpi_fallback",
        failures,
      });
    }

    return NextResponse.json({
      status: "VERIFIED",
      dataVersion: kpiRecord.dataVersion,
      assetId: kpiRecord.assetId,
      verifiedAt: new Date().toISOString(),
      verificationMode: "kpi_fallback",
    });
  } catch (err) {
    return handleError(err);
  }
};

export const GET = withAuth(handleGet);
