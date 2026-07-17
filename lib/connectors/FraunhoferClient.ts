/**
 * Fraunhofer Connector (C2) — energy-class calculation wrapper.
 *
 * The exchange layer is the ONLY caller of the Fraunhofer API; apps never talk
 * to it directly. Mirrors the TrustLayerClient connector pattern.
 *
 * The Fraunhofer API (ibpcoalitionx) is a synchronous, unauthenticated
 * calculation service. We POST a minimal CoalitionXSetOfKPIs (primary energy +
 * reference max) and read back the computed energy class.
 *
 * Endpoint: POST {FRAUNHOFER_API_URL}/CalculateEnergyClassFraunhoferMethod
 */

import { Logger } from "../core/Logger";
import { EnergyClassEnum } from "../kpi/schema";

// The API returns "APlus" for the top class; our schema (EnergyClassEnum) uses "A+".
function normalizeClass(raw: string): string {
  return raw === "APlus" ? "A+" : raw;
}

export type PrimaryEnergyMode = "calculated" | "metered";

export interface FraunhoferCalcInput {
  assetId: string;
  /** "calculated" = Bedarf (KPI 7-4); "metered" = Verbrauch (KPI 7-3). */
  mode: PrimaryEnergyMode;
  /** Primary energy of the object (kWh/m²a). */
  primaryEnergy: number;
  /** Reference / max allowed primary energy demand (kWh/m²a). */
  maximumPrimaryEnergyDemand: number;
  submittedBy: string;
  submittedAt: string; // ISO 8601
}

export interface FraunhoferCalcResult {
  /** Energy class mapped to our EnergyClassEnum (A+ … G, Unbekannt). */
  energyClass: string;
  /** Raw value as returned by Fraunhofer (e.g. "APlus"). */
  rawValue: string;
  requestPayload: unknown;
  responsePayload: unknown;
  statusCode: number;
}

export class FraunhoferError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "FraunhoferError";
    this.statusCode = statusCode;
  }
}

export class FraunhoferClient {
  private readonly baseUrl: string;
  private readonly logger = new Logger({ connector: "FraunhoferClient" });

  constructor(baseUrl = process.env.FRAUNHOFER_API_URL) {
    if (!baseUrl) {
      throw new FraunhoferError("FRAUNHOFER_API_URL is not configured", 0);
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async calculateEnergyClass(
    input: FraunhoferCalcInput,
  ): Promise<FraunhoferCalcResult> {
    const energyKey =
      input.mode === "calculated"
        ? "KPI_7_4_Primary_Energy_Calculated"
        : "KPI_7_3_Primary_Energy_Metered";
    const maxKey =
      input.mode === "calculated"
        ? "MaximumPrimaryEnergyDemand_Calculated"
        : "MaximumPrimaryEnergyDemand_Metered";

    const requestPayload = {
      AssetID: input.assetId,
      Energy_Performance: {
        [energyKey]: {
          SubmittedBy: input.submittedBy,
          SubmittedAt: input.submittedAt,
          Value: String(input.primaryEnergy),
        },
      },
      Extended_Data: {
        [maxKey]: String(input.maximumPrimaryEnergyDemand),
      },
    };

    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/CalculateEnergyClassFraunhoferMethod`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        },
      );
    } catch (err) {
      throw new FraunhoferError(
        `Fraunhofer request failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    }

    const raw = await response.text().catch(() => "");
    let body: {
      Energy_Performance?: { KPI_7_2_Energy_Class?: { Value?: string } };
    } = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = {};
      }
    }

    if (!response.ok) {
      throw new FraunhoferError(
        `Fraunhofer returned ${response.status}`,
        response.status,
      );
    }

    const rawValue = body.Energy_Performance?.KPI_7_2_Energy_Class?.Value;
    if (!rawValue) {
      throw new FraunhoferError(
        "Fraunhofer response did not contain an energy class",
        response.status,
      );
    }

    const energyClass = normalizeClass(rawValue);
    if (!EnergyClassEnum.options.includes(energyClass as never)) {
      // Fraunhofer returned a value we don't model — surface it rather than store junk.
      throw new FraunhoferError(
        `Fraunhofer returned an unrecognized energy class: "${rawValue}"`,
        response.status,
      );
    }

    this.logger.info("Energy class calculated", {
      data: { assetId: input.assetId, mode: input.mode, energyClass },
    });

    return {
      energyClass,
      rawValue,
      requestPayload,
      responsePayload: body,
      statusCode: response.status,
    };
  }
}
