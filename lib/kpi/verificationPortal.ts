/**
 * Verification-portal helpers.
 *
 * Shared resolution logic for the public verification endpoints:
 *  - POST /api/submissions/track   (step 1: JWS -> submission summary)
 *  - POST /api/verify/kpis         (step 2: JWS + Org DID -> signed KPI table)
 *
 * Everything is resolved from a submission id (the tracking token's `sub`).
 * Note: a submission's KPI version isn't stored on Submission today, so we use
 * the asset's latest KpiRecord — an accepted MVP simplification.
 */

import prisma from "../prisma";
import { SCHEMA_KEY_MAP } from "./registry";
import { KPI_SECTIONS } from "./schema";
import type { KpiData } from "./schema";
import { TrustLayerClient } from "../connectors/TrustLayerClient";

export type OverallStatus = "Verifiziert" | "Ungültig" | "In Bearbeitung";
export type SigningStatus = "signed" | "pending" | "failed";

export interface SubmissionContext {
  submissionId: string;
  organizationId: string;
  assetId: string | null;
  asset: { externalId: string | null; address: string | null } | null;
  dataVersion: number | null;
  kpiData: KpiData | null;
  validationStatus: string;
  signingStatus: SigningStatus;
  gueltigBis: string | null;
  overallStatus: OverallStatus;
  /** C2 (Fraunhofer) energy-class calculation status for this submission. */
  fraunhofer: { status: string | null; energyClass: string | null };
}

function mapSigningStatus(raw: string | undefined): SigningStatus {
  if (raw === "SIGNED") return "signed";
  if (raw === "FAILED") return "failed";
  return "pending";
}

/** Pull KPI 7-7 (Gültig bis) out of the signed data, if present. */
function extractGueltigBis(kpiData: KpiData | null): string | null {
  if (!kpiData) return null;
  const energy = (kpiData as Record<string, unknown>)["Energy_Performance"] as
    | Record<string, { Value?: unknown }>
    | undefined;
  const el = energy?.["KPI_7_7_EPC_Expiry_Date"];
  const v = el?.Value;
  return v == null ? null : String(v);
}

export async function resolveSubmissionContext(
  submissionId: string,
): Promise<SubmissionContext | null> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      organizationId: true,
      resourceId: true,
      validationStatus: true,
    },
  });
  if (!submission) return null;

  const assetId = submission.resourceId;
  const [asset, latestRecord, latestSigning, fraunhoferRequest] =
    await Promise.all([
    assetId
      ? prisma.asset.findUnique({
          where: { id: assetId },
          select: { externalId: true, address: true },
        })
      : Promise.resolve(null),
    assetId
      ? prisma.kpiRecord.findFirst({
          where: { assetId },
          orderBy: { dataVersion: "desc" },
        })
      : Promise.resolve(null),
    assetId
      ? prisma.signingRequest.findFirst({
          where: { assetId },
          orderBy: { updatedAt: "desc" },
          select: { status: true },
        })
      : Promise.resolve(null),
    prisma.fraunhoferRequest.findUnique({
      where: { submissionId: submission.id },
      select: { status: true },
    }),
  ]);

  const signingStatus = mapSigningStatus(latestSigning?.status);
  const kpiData = (latestRecord?.kpiData as KpiData | null) ?? null;
  const energyClass =
    ((kpiData?.Energy_Performance as
      | { KPI_7_2_Energy_Class?: { Value?: string } }
      | undefined)?.KPI_7_2_Energy_Class?.Value) ?? null;
  const overallStatus: OverallStatus =
    signingStatus === "signed"
      ? "Verifiziert"
      : submission.validationStatus === "FAILED" || signingStatus === "failed"
        ? "Ungültig"
        : "In Bearbeitung";

  return {
    submissionId: submission.id,
    organizationId: submission.organizationId,
    assetId,
    asset,
    dataVersion: latestRecord?.dataVersion ?? null,
    kpiData,
    validationStatus: submission.validationStatus,
    signingStatus,
    gueltigBis: extractGueltigBis(kpiData),
    overallStatus,
    fraunhofer: { status: fraunhoferRequest?.status ?? null, energyClass },
  };
}

/** The Org DID lives on the accredited-partner record (same source as signing). */
export async function resolveOrgDid(
  organizationId: string,
): Promise<string | null> {
  const partner = await prisma.accreditedPartner.findFirst({
    where: { organizationId },
    select: { did: true },
  });
  return partner?.did ?? null;
}

export interface KpiRow {
  kpiNumber: string;
  section: string;
  label: string;
  value: unknown;
  unit: string | null;
  verified: boolean;
}

/** Flatten the signed KPI sections into a display table via the KPI registry. */
export function buildKpiTable(kpiData: KpiData, verified: boolean): KpiRow[] {
  const rows: KpiRow[] = [];
  for (const section of KPI_SECTIONS) {
    const sectionObj = (kpiData as Record<string, unknown>)[section] as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!sectionObj) continue;
    for (const [schemaKey, element] of Object.entries(sectionObj)) {
      if (!element || typeof element !== "object") continue;
      const value =
        "Value" in element
          ? element.Value
          : "Values" in element
            ? element.Values
            : undefined;
      if (value === undefined) continue;
      const def = SCHEMA_KEY_MAP.get(schemaKey);
      rows.push({
        kpiNumber: def?.number ?? schemaKey,
        section,
        label: def?.dataPointDE ?? schemaKey,
        value,
        unit: def?.unit ?? null,
        verified,
      });
    }
  }
  return rows;
}

/** Envelope-level Trust Layer verification (MVP: one verdict for the record). */
export async function verifyRecordSignature(
  assetId: string,
  kpiData: KpiData,
): Promise<boolean> {
  if (!(kpiData as Record<string, unknown>).Signature) return false;
  if (!process.env.TRUST_LAYER_URL) return false;

  const signingRequest = await prisma.signingRequest.findFirst({
    where: { assetId, status: "SIGNED" },
    orderBy: { updatedAt: "desc" },
  });
  if (!signingRequest?.verifierDetails) return false;

  const sectionData: Record<string, Record<string, unknown>> = {};
  for (const section of KPI_SECTIONS) {
    const v = (kpiData as Record<string, unknown>)[section];
    if (v) sectionData[section] = v as Record<string, unknown>;
  }

  const client = new TrustLayerClient();
  const result = await client.verifySignature({
    mode: "full",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    seal_response: signingRequest.verifierDetails as any,
    kpi_data: sectionData,
  });
  return result.status === "VERIFIED";
}
