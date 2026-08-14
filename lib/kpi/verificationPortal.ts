/**
 * Verification-portal helpers.
 *
 * Shared resolution logic for the public verification endpoints:
 *  - POST /api/submissions/track   (step 1: JWS -> submission summary)
 *  - POST /api/verify/kpis         (step 2: JWS + Org DID -> signed KPI table)
 *
 * Everything is resolved from a submission id (the tracking token's `sub`), and
 * strictly scoped to that submission: its own KpiRecord (KpiRecord.submissionId)
 * and the signing attempts on that record (SigningRequest.kpiRecordId). Resolving
 * by asset instead would let a neighbouring submission on the same asset supply
 * the status or the KPI values.
 *
 * `resolveSigningStatuses` is exported because GET /api/submissions (the
 * erfassungs-app list) must derive the status the same way — the two views
 * disagreeing is a bug users see.
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
  /**
   * Which system submitted this: "Erfassungs App" or "Realcube Api" — the same
   * two values new submissions store. Used to display provenance for records
   * written before the `Source` field carried it.
   */
  dataSource: string;
  /** The submission's own KpiRecord, or null if it never produced one. */
  kpiRecordId: string | null;
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

/** True once the Trust Layer's signatures have been written onto the record. */
function hasSignature(kpiData: unknown): boolean {
  return Boolean((kpiData as Record<string, unknown> | null)?.Signature);
}

/**
 * Signing status per submission id, scoped to each submission's own KpiRecord.
 *
 * A submission with no record of its own (validation failed before one was
 * created) is "pending" — never the verdict of some other submission's attempt.
 *
 * Records whose signing requests predate SigningRequest.kpiRecordId and could
 * not be backfilled fall back to the record itself: signatures written onto the
 * KPI data mean it was signed.
 */
export async function resolveSigningStatuses(
  submissionIds: string[],
): Promise<Map<string, SigningStatus>> {
  const statuses = new Map<string, SigningStatus>(
    submissionIds.map((id) => [id, "pending" as SigningStatus]),
  );
  if (submissionIds.length === 0) return statuses;

  const records = await prisma.kpiRecord.findMany({
    where: { submissionId: { in: submissionIds } },
    select: { id: true, submissionId: true },
  });
  if (records.length === 0) return statuses;

  const requests = await prisma.signingRequest.findMany({
    where: { kpiRecordId: { in: records.map((r) => r.id) } },
    orderBy: { updatedAt: "desc" },
    select: { kpiRecordId: true, status: true },
  });

  // Most recent attempt per record.
  const latestByRecord = new Map<string, string>();
  for (const req of requests) {
    if (req.kpiRecordId && !latestByRecord.has(req.kpiRecordId)) {
      latestByRecord.set(req.kpiRecordId, req.status);
    }
  }

  // Legacy fallback — normally empty, so the extra read does not run.
  const unlinked = records.filter((r) => !latestByRecord.has(r.id));
  const signedWithoutRequest = new Set<string>();
  if (unlinked.length > 0) {
    const legacy = await prisma.kpiRecord.findMany({
      where: { id: { in: unlinked.map((r) => r.id) } },
      select: { id: true, kpiData: true },
    });
    for (const record of legacy) {
      if (hasSignature(record.kpiData)) signedWithoutRequest.add(record.id);
    }
  }

  for (const record of records) {
    if (!record.submissionId) continue;
    const raw = latestByRecord.get(record.id);
    statuses.set(
      record.submissionId,
      raw
        ? mapSigningStatus(raw)
        : signedWithoutRequest.has(record.id)
          ? "signed"
          : "pending",
    );
  }

  return statuses;
}

/**
 * Validation + signing state -> the German status both the portal and the
 * erfassungs-app show. Single source of truth for that mapping.
 */
export function deriveOverallStatus(
  validationStatus: string,
  signingStatus: SigningStatus,
): OverallStatus {
  if (signingStatus === "signed") return "Verifiziert";
  if (validationStatus === "FAILED" || signingStatus === "failed") {
    return "Ungültig";
  }
  return "In Bearbeitung";
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
      userId: true,
      resourceId: true,
      validationStatus: true,
    },
  });
  if (!submission) return null;

  const assetId = submission.resourceId;
  // The submission's *own* record — not the asset's latest. On an asset with
  // several submissions those differ, and the report must show the data this
  // submission produced. A submission that failed validation has no record.
  const [asset, ownRecord, signingStatuses, fraunhoferRequest] =
    await Promise.all([
    assetId
      ? prisma.asset.findUnique({
          where: { id: assetId },
          select: { externalId: true, address: true },
        })
      : Promise.resolve(null),
    prisma.kpiRecord.findUnique({
      where: { submissionId: submission.id },
    }),
    resolveSigningStatuses([submission.id]),
    prisma.fraunhoferRequest.findUnique({
      where: { submissionId: submission.id },
      select: { status: true },
    }),
  ]);

  const signingStatus = signingStatuses.get(submission.id) ?? "pending";
  // Submission.userId is null exactly when an org-level (machine) token was used,
  // so it distinguishes the app from any integration — including for old records.
  const dataSource = submission.userId ? "Erfassungs App" : "Realcube Api";
  const kpiData = (ownRecord?.kpiData as KpiData | null) ?? null;
  const energyClass =
    ((kpiData?.Energy_Performance as
      | { KPI_7_2_Energy_Class?: { Value?: string } }
      | undefined)?.KPI_7_2_Energy_Class?.Value) ?? null;
  const overallStatus = deriveOverallStatus(
    submission.validationStatus,
    signingStatus,
  );

  return {
    submissionId: submission.id,
    organizationId: submission.organizationId,
    assetId,
    asset,
    dataSource,
    kpiRecordId: ownRecord?.id ?? null,
    dataVersion: ownRecord?.dataVersion ?? null,
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
  /** ISO timestamp the value was submitted (KPI element `SubmittedAt`). */
  submittedAt: string | null;
  /** Free-text origin of the value (KPI element `Source`). */
  source: string | null;
}

/** Flatten the signed KPI sections into a display table via the KPI registry. */
/**
 * Values stored before provenance existed carry the literal "input", which means
 * nothing to a verifier. Replace it with the submitting system, derived from the
 * submission itself. Everything else — the ZIA enum on 7-2, "FraunhoferMethode",
 * a real system name — is passed through untouched.
 */
const LEGACY_SOURCE = "input";

export function buildKpiTable(
  kpiData: KpiData,
  verified: boolean,
  dataSource?: string,
): KpiRow[] {
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
      // Provenance for the report table's "Datum" / "Datensatzherkunft"
      // columns. Both are optional in the V0.9.2 schema.
      const submittedAt =
        typeof element.SubmittedAt === "string" ? element.SubmittedAt : null;
      let source = typeof element.Source === "string" ? element.Source : null;
      if (source === LEGACY_SOURCE && dataSource) source = dataSource;
      rows.push({
        kpiNumber: def?.number ?? schemaKey,
        section,
        label: def?.dataPointDE ?? schemaKey,
        value,
        unit: def?.unit ?? null,
        verified,
        submittedAt,
        source,
      });
    }
  }
  return rows;
}

/**
 * Envelope-level Trust Layer verification (MVP: one verdict for the record).
 *
 * The seal must come from the signing request for *this* record — another
 * version's seal would not match this data and would fail verification anyway.
 */
export async function verifyRecordSignature(
  kpiRecordId: string,
  kpiData: KpiData,
): Promise<boolean> {
  if (!hasSignature(kpiData)) return false;
  if (!process.env.TRUST_LAYER_URL) return false;

  const signingRequest = await prisma.signingRequest.findFirst({
    where: { kpiRecordId, status: "SIGNED" },
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
