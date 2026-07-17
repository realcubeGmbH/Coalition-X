/**
 * Fraunhofer Service (C2 orchestration).
 *
 * Runs inside the submission pipeline BETWEEN merge and signing (C2 before C3),
 * so the Fraunhofer-computed energy class (KPI 7-2) becomes part of the data the
 * Trust Layer signs and the verification portal (C4) attests to.
 *
 * Reads the primary-energy value from the record and the reference value
 * (MaximumPrimaryEnergyDemand) from the raw submission input, calls the
 * Fraunhofer connector, writes KPI 7-2 into the record, and records the attempt
 * on the existing FraunhoferRequest model.
 */

import prisma from "../prisma";
import { Logger } from "../core/Logger";
import { toJsonValue } from "../utils/json";
import {
  FraunhoferClient,
  FraunhoferError,
  type PrimaryEnergyMode,
} from "./FraunhoferClient";
import type { KpiData } from "../kpi/schema";

// Reference-value keys the client (erfassungs-app) sends in the raw `kpis` payload.
// Not ZIA KPIs — auxiliary inputs for the class calculation → stored in Extended_Data.
export const REF_KEY_CALCULATED = "extended_max_primary_energy_calculated";
export const REF_KEY_METERED = "extended_max_primary_energy_metered";

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n =
    typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface FraunhoferApplyResult {
  applied: boolean;
  energyClass?: string;
  skippedReason?: string;
  error?: string;
}

export class FraunhoferService {
  private logger = new Logger({ connector: "FraunhoferService" });

  /**
   * Compute the energy class via Fraunhofer and write KPI 7-2 into `kpiData`
   * (mutated in place, so the caller stores + signs the enriched record).
   */
  async calculateAndApply(params: {
    kpiData: KpiData;
    rawKpis: Record<string, unknown>;
    assetId: string;
    submissionId: string;
    userId: string;
  }): Promise<FraunhoferApplyResult> {
    const { kpiData, rawKpis, assetId, submissionId, userId } = params;

    if (!process.env.FRAUNHOFER_API_URL) {
      return { applied: false, skippedReason: "FRAUNHOFER_API_URL not configured" };
    }

    const energyPerf = kpiData.Energy_Performance as
      | Record<string, { Value?: unknown } | undefined>
      | undefined;
    const calcPrimary = toNum(energyPerf?.KPI_7_4_Primary_Energy_Calculated?.Value);
    const meteredPrimary = toNum(energyPerf?.KPI_7_3_Primary_Energy_Metered?.Value);
    const refCalc = toNum(rawKpis[REF_KEY_CALCULATED]);
    const refMetered = toNum(rawKpis[REF_KEY_METERED]);

    // Prefer the calculated (Bedarf) pair; fall back to metered (Verbrauch).
    let mode: PrimaryEnergyMode | null = null;
    let primaryEnergy = 0;
    let reference = 0;
    if (calcPrimary != null && refCalc != null) {
      mode = "calculated";
      primaryEnergy = calcPrimary;
      reference = refCalc;
    } else if (meteredPrimary != null && refMetered != null) {
      mode = "metered";
      primaryEnergy = meteredPrimary;
      reference = refMetered;
    }

    if (!mode) {
      return {
        applied: false,
        skippedReason: "missing primary energy or reference value",
      };
    }

    const now = new Date().toISOString();
    const request = await prisma.fraunhoferRequest.create({
      data: {
        submissionId,
        status: "PENDING",
        endpoint: "/CalculateEnergyClassFraunhoferMethod",
        attemptCount: 1,
        lastAttemptAt: new Date(),
      },
    });

    try {
      const result = await new FraunhoferClient().calculateEnergyClass({
        assetId,
        mode,
        primaryEnergy,
        maximumPrimaryEnergyDemand: reference,
        submittedBy: userId,
        submittedAt: now,
      });

      // Write KPI 7-2 into the record so it is stored + signed.
      const section = (kpiData.Energy_Performance ?? {}) as Record<string, unknown>;
      section.KPI_7_2_Energy_Class = {
        Value: result.energyClass,
        Source: "FraunhoferMethode",
        SubmittedBy: userId,
        SubmittedAt: now,
      };
      (kpiData as Record<string, unknown>).Energy_Performance = section;

      // Persist the reference input into Extended_Data.
      const ext = ((kpiData as Record<string, unknown>).Extended_Data ??
        {}) as Record<string, unknown>;
      if (mode === "calculated") {
        ext.MaximumPrimaryEnergyDemand_Calculated = reference;
      } else {
        ext.MaximumPrimaryEnergyDemand_Metered = reference;
      }
      (kpiData as Record<string, unknown>).Extended_Data = ext;

      await prisma.fraunhoferRequest.update({
        where: { id: request.id },
        data: {
          status: "COMPLETED",
          statusCode: result.statusCode,
          requestPayload: toJsonValue(result.requestPayload),
          responsePayload: toJsonValue(result.responsePayload),
          computedAt: new Date(),
        },
      });

      this.logger.info("C2 energy class applied", {
        data: { assetId, mode, energyClass: result.energyClass },
      });
      return { applied: true, energyClass: result.energyClass };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.fraunhoferRequest.update({
        where: { id: request.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          statusCode: err instanceof FraunhoferError ? err.statusCode : undefined,
        },
      });
      this.logger.warn("C2 energy class failed", {
        data: { assetId, error: message },
      });
      return { applied: false, error: message };
    }
  }
}

let _service: FraunhoferService | undefined;
export function getFraunhoferService(): FraunhoferService {
  return (_service ??= new FraunhoferService());
}
