import prisma from "../prisma";
import { Logger } from "../core/Logger";
import { toJsonValue } from "../utils/json";
import { computeChecksum } from "../utils/checksum";
import { TrustLayerClient, TrustLayerError } from "./TrustLayerClient";
import type {
  SigningRequest,
  SigningResponse,
  KpiSignatureDetail,
  EnvelopeSignatureDetail,
} from "./TrustLayerClient";
import type { KpiData, KpiSectionName } from "../kpi/schema";
import { KPI_SECTIONS } from "../kpi/schema";

// =============================================================================
// Types
// =============================================================================

export interface SigningContext {
  userId: string;
  isOrgLevel?: boolean;
}

export interface SigningResult {
  signed: boolean;
  signingRequestId: string;
  transactionId?: string;
  kpiCount?: number;
  signedKpiData?: KpiData;
  error?: string;
}

// =============================================================================
// KPI Signing Service
// =============================================================================

export class KpiSigningService {
  private client: TrustLayerClient;
  private logger: Logger;

  constructor(config?: { client?: TrustLayerClient; logger?: Logger }) {
    this.client =
      config?.client ??
      new TrustLayerClient({
        logger: new Logger({ connector: "KpiSigningService" }),
      });
    this.logger =
      config?.logger ?? new Logger({ connector: "KpiSigningService" });
  }

  /**
   * Main entry point — signs the KPIs in a just-created KpiRecord.
   * Non-blocking: failures are recorded but do not throw.
   */
  async signSubmittedKpis(
    kpiRecordId: string,
    organizationId: string,
    assetId: string,
    ctx: SigningContext,
  ): Promise<SigningResult> {
    const kpiRecord = await prisma.kpiRecord.findUniqueOrThrow({
      where: { id: kpiRecordId },
      include: {
        schemaRegistry: { select: { version: true } },
        submission: { select: { id: true } },
      },
    });

    const kpiData = kpiRecord.kpiData as KpiData;
    const orgDid = await this.resolveOrgDid(organizationId);
    const transactionId = kpiRecord.submission?.id ?? kpiRecordId;

    const signingRequest = this.buildSigningRequest(
      kpiData,
      orgDid,
      assetId,
      transactionId,
      kpiRecord.schemaRegistry.version,
    );

    return this.submitForSigning(
      signingRequest,
      assetId,
      kpiData,
      kpiRecordId,
      organizationId,
      transactionId,
      kpiRecord.schemaRegistry.version,
      ctx,
    );
  }

  /**
   * Looks up the organization's DID from AccreditedPartner records.
   */
  async resolveOrgDid(organizationId: string): Promise<string> {
    const partner = await prisma.accreditedPartner.findFirst({
      where: { organizationId },
      select: { did: true },
    });

    if (!partner?.did) {
      throw new Error(
        `No DID found for organization ${organizationId} — is the partner accredited?`,
      );
    }

    return partner.did;
  }

  /**
   * Transforms kpiData into the Trust Layer's seal request format.
   */
  buildSigningRequest(
    kpiData: KpiData,
    orgDid: string,
    assetId: string,
    transactionId: string,
    schemaVersion: string,
  ): SigningRequest {
    const data: Record<string, Record<string, unknown>> = {};

    for (const section of KPI_SECTIONS) {
      const sectionData = kpiData[section as KpiSectionName];
      if (sectionData && Object.keys(sectionData).length > 0) {
        data[section] = sectionData as Record<string, unknown>;
      }
    }

    return {
      data,
      identity: {
        submitter_did: orgDid,
        asset_id: assetId,
      },
      metadata: {
        transaction_id: transactionId,
        schema_version: schemaVersion,
      },
    };
  }

  /**
   * Sends the request to the Trust Layer, manages the SigningRequest lifecycle,
   * and persists the signed KPI data on success.
   */
  private async submitForSigning(
    signingRequest: SigningRequest,
    assetId: string,
    kpiData: KpiData,
    kpiRecordId: string,
    organizationId: string,
    transactionId: string,
    schemaVersion: string,
    ctx: SigningContext,
  ): Promise<SigningResult> {
    const signingRecord = await prisma.signingRequest.create({
      data: {
        assetId,
        // Scopes the request to the exact record/version being signed, so a
        // status consumer never picks up another submission's attempt.
        kpiRecordId,
        status: "PENDING",
        requestPayload: toJsonValue(signingRequest),
        holderIdentity: signingRequest.identity.submitter_did,
        kpiVersion: schemaVersion,
        userId: ctx.isOrgLevel ? undefined : ctx.userId,
        systemId: process.env.TRUST_LAYER_SYSTEM_DID ?? undefined,
      },
    });

    await this.logger.audit({
      action: "SIGNING_REQUESTED",
      resource: "SigningRequest",
      resourceId: signingRecord.id,
      payload: {
        assetId,
        transactionId,
        kpiRecordId,
      },
    });

    const startTime = Date.now();

    try {
      const response = await this.client.signAndEncrypt(signingRequest);

      const requestDuration = Date.now() - startTime;

      const updatedKpiData = this.applySignaturesToKpiData(
        kpiData,
        response.kpi_signatures,
        response.envelope_signature,
        response.dataset_signature,
      );

      await this.updateKpiRecordWithSignatures(kpiRecordId, updatedKpiData);

      await prisma.signingRequest.update({
        where: { id: signingRecord.id },
        data: {
          status: "SIGNED",
          trustLayerRequestId: response.transaction_id,
          verifierDetails: toJsonValue(response),
          attemptCount: 1,
          lastAttemptAt: new Date(),
          requestDuration,
          responseDuration: Date.now() - startTime,
        },
      });

      await this.logger.audit({
        action: "SIGNING_COMPLETED",
        resource: "SigningRequest",
        resourceId: signingRecord.id,
        response: {
          transaction_id: response.transaction_id,
          kpi_count: response.kpi_signatures.length,
          org_did: response.org_did,
        },
      });

      return {
        signed: true,
        signingRequestId: signingRecord.id,
        transactionId: response.transaction_id,
        kpiCount: response.kpi_signatures.length,
        signedKpiData: updatedKpiData,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      const statusCode =
        err instanceof TrustLayerError ? err.statusCode : undefined;

      await prisma.signingRequest.update({
        where: { id: signingRecord.id },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          lastError: errorMessage,
          requestDuration: Date.now() - startTime,
        },
      });

      await this.logger.audit({
        action: "SIGNING_FAILED",
        resource: "SigningRequest",
        resourceId: signingRecord.id,
        statusCode,
        response: { error: errorMessage },
      });

      return {
        signed: false,
        signingRequestId: signingRecord.id,
        error: errorMessage,
      };
    }
  }

  /**
   * Applies per-KPI detached JWS signatures to the Signature field of each
   * element, and sets the root-level Signature from the dataset signature
   * (JCS of full dataset minus Signature fields) or falls back to envelope JWS.
   * Uses the `combined` array when multiple signers are present (cosign).
   */
  applySignaturesToKpiData(
    kpiData: KpiData,
    kpiSignatures: KpiSignatureDetail[],
    envelopeSignature?: EnvelopeSignatureDetail,
    datasetSignature?: string,
  ): KpiData {
    const updated = structuredClone(kpiData);

    for (const sig of kpiSignatures) {
      const dotIndex = sig.kpi_id.indexOf(".");
      if (dotIndex === -1) continue;

      const section = sig.kpi_id.slice(0, dotIndex);
      const kpiKey = sig.kpi_id.slice(dotIndex + 1);

      const sectionData = (updated as Record<string, Record<string, any>>)[
        section
      ];
      if (sectionData?.[kpiKey]) {
        if (sig.combined && sig.combined.length > 1) {
          sectionData[kpiKey].Signature = sig.combined;
        } else {
          sectionData[kpiKey].Signature = sig.jws;
        }
      }
    }

    if (datasetSignature) {
      updated.Signature = datasetSignature;
    } else if (envelopeSignature?.jws) {
      updated.Signature = envelopeSignature.jws;
    }

    return updated;
  }

  /**
   * Updates the existing KpiRecord in-place with signed data.
   */
  private async updateKpiRecordWithSignatures(
    kpiRecordId: string,
    signedKpiData: KpiData,
  ): Promise<void> {
    await prisma.kpiRecord.update({
      where: { id: kpiRecordId },
      data: {
        kpiData: toJsonValue(signedKpiData),
        checksum: computeChecksum(signedKpiData),
      },
    });
  }
}

// =============================================================================
// Default instance
// =============================================================================

let _instance: KpiSigningService | undefined;

export function getKpiSigningService(): KpiSigningService {
  if (!_instance) {
    _instance = new KpiSigningService();
  }
  return _instance;
}
