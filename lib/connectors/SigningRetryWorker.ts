import prisma from "../prisma";
import { Logger } from "../core/Logger";
import { toJsonValue } from "../utils/json";
import { computeChecksum } from "../utils/checksum";
import { TrustLayerClient } from "./TrustLayerClient";
import type { SigningRequest, SigningResponse, KpiSignatureDetail, EnvelopeSignatureDetail } from "./TrustLayerClient";
import type { KpiData } from "../kpi/schema";
import { getKpiSigningService } from "./KpiSigningService";

const RETRY_INTERVAL_MS = parseInt(process.env.SIGNING_RETRY_INTERVAL_MS ?? "60000", 10);

const logger = new Logger({ connector: "SigningRetryWorker" });

export class SigningRetryWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    logger.info("Signing retry worker started", { data: { intervalMs: RETRY_INTERVAL_MS } });
    this.timer = setInterval(() => this.processRetries(), RETRY_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("Signing retry worker stopped");
    }
  }

  async processRetries(): Promise<number> {
    const failedRequests = await prisma.signingRequest.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "asc" },
      take: 10,
    });

    if (failedRequests.length === 0) return 0;

    let retried = 0;
    let client: TrustLayerClient;
    try {
      client = new TrustLayerClient();
    } catch {
      logger.warn("Cannot create TrustLayerClient — TRUST_LAYER_URL missing");
      return 0;
    }

    for (const req of failedRequests) {
      const backoffMs = Math.pow(2, req.attemptCount) * 1000;
      const lastAttempt = req.lastAttemptAt ?? req.createdAt;
      const nextAllowed = new Date(lastAttempt.getTime() + backoffMs);

      if (new Date() < nextAllowed) continue;

      if (!req.requestPayload) {
        logger.warn("SigningRequest has no requestPayload, skipping", {
          data: { signingRequestId: req.id },
        });
        continue;
      }

      try {
        const response = await client.signAndEncrypt(
          req.requestPayload as unknown as SigningRequest,
        );

        // The record this request actually signed. Falling back to the asset's
        // latest record (as this did before SigningRequest.kpiRecordId existed)
        // could write one version's signatures onto another version's data.
        const kpiRecord = req.kpiRecordId
          ? await prisma.kpiRecord.findUnique({ where: { id: req.kpiRecordId } })
          : null;

        if (!kpiRecord) {
          logger.warn("Retry signed but no linked KPI record to update", {
            data: { signingRequestId: req.id, kpiRecordId: req.kpiRecordId },
          });
        }

        if (kpiRecord) {
          const updatedKpiData = getKpiSigningService().applySignaturesToKpiData(
            kpiRecord.kpiData as KpiData,
            response.kpi_signatures,
            response.envelope_signature,
            response.dataset_signature,
          );

          await prisma.kpiRecord.update({
            where: { id: kpiRecord.id },
            data: {
              kpiData: toJsonValue(updatedKpiData),
              checksum: computeChecksum(updatedKpiData),
            },
          });
        }

        await prisma.signingRequest.update({
          where: { id: req.id },
          data: {
            status: "SIGNED",
            trustLayerRequestId: response.transaction_id,
            verifierDetails: toJsonValue(response),
            lastAttemptAt: new Date(),
          },
        });

        retried++;
      } catch (err) {
        await prisma.signingRequest.update({
          where: { id: req.id },
          data: {
            status: "FAILED",
            lastAttemptAt: new Date(),
            lastError: err instanceof Error ? err.message : String(err),
          },
        });

        logger.warn("Signing retry attempt failed", {
          data: {
            signingRequestId: req.id,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }

    if (retried > 0) {
      logger.info("Signing retry batch completed", { data: { retried } });
    }

    return retried;
  }
}

let _worker: SigningRetryWorker | undefined;

export function getSigningRetryWorker(): SigningRetryWorker {
  if (!_worker) {
    _worker = new SigningRetryWorker();
  }
  return _worker;
}
