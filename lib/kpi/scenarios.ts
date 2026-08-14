/**
 * Building Scenario Derivation & Mandatory KPI Enforcement
 *
 * Mirrors the erfassungs-app logic:
 * - Neubau/Bestand determined by the building-permit application date (KPI 1-1):
 *   strictly after 31.12.2020 = Neubau, everything else = Bestand
 * - KPI 1-1 itself only applies from completion year (KPI 1-2) 2021 onwards
 * - Wohnen/Nichtwohnen determined by primary building use (KPI 3-1)
 * - Mandatory KPI matrix enforced on initial submission; the same rules decide
 *   whether a record is complete enough to sign (see evaluateCompleteness)
 */

import { BuildingUseEnum, KPI_SECTIONS } from "./schema";
import type { KpiData, KPIValueElement, KPIValueList } from "./schema";

// =============================================================================
// Types
// =============================================================================

export type BuildingScenario =
  | "neubauWohnen"
  | "neubauNichtwohnen"
  | "bestandWohnen"
  | "bestandNichtwohnen";

export interface InitialSubmissionResult {
  valid: boolean;
  scenario: BuildingScenario;
  missingKpis: MissingKpi[];
}

export interface MissingKpi {
  kpiNumber: string;
  schemaKey: string;
  section: string;
  label: string;
}

// =============================================================================
// Neubau / Bestand Cutoff
// =============================================================================

/**
 * Neubau / Bestand is decided by the building-permit application date (KPI 1-1)
 * against a fixed cutoff — **not** by the building's age:
 *
 *   Neubau  — 1-1 is strictly after 31.12.2020
 *   Bestand — everything else
 *
 * "Everything else" is deliberate and covers three cases with one rule: a
 * completion year (KPI 1-2) of 2020 or earlier (where 1-1 is not collected at
 * all), an application date on or before the cutoff, and a missing 1-1 on
 * machine submissions that bypass the form.
 *
 * Replaces a rolling "under 10 years old" window, which classified by age and
 * ignored 1-1 entirely.
 */
const NEUBAU_CUTOFF_MS = Date.UTC(2020, 11, 31); // 31.12.2020

/** 1-1 is only collected from completion year 2021 onwards. */
export const BUILDING_APPLICATION_DATE_FROM_YEAR = 2021;

const WOHNEN_VALUES = new Set([
  "Wohnen",
  "RESIDENTIAL",
  "residential",
]);

// =============================================================================
// Scenario Derivation
// =============================================================================

/**
 * Neubau iff the building-permit application date (KPI 1-1) is strictly after
 * 31.12.2020. Missing or unparseable date → false (Bestand), which is the
 * intended default rather than a fallback.
 */
export function computeIsNeubau(
  buildingApplicationDate: string | null | undefined,
): boolean {
  if (!buildingApplicationDate) return false;
  const ms = Date.parse(String(buildingApplicationDate));
  if (Number.isNaN(ms)) return false;
  return ms > NEUBAU_CUTOFF_MS;
}

/**
 * Whether KPI 1-1 applies at all for a completion year: it is collected (and
 * required) from 2021 onwards, and not shown below that.
 */
export function requiresBuildingApplicationDate(
  completionYear: string | number | null | undefined,
): boolean {
  if (completionYear == null) return false;
  const year =
    typeof completionYear === "number"
      ? completionYear
      : parseInt(String(completionYear).trim(), 10);
  if (!Number.isInteger(year)) return false;
  return year >= BUILDING_APPLICATION_DATE_FROM_YEAR;
}

export function computeIsWohnen(primaryUse: string): boolean {
  return WOHNEN_VALUES.has(primaryUse);
}

/**
 * Whether KPI 3-1 carries a use this engine actually recognises.
 *
 * `computeIsWohnen` is a set-membership test, so an *unrecognised* value (a
 * numeric ZIA code, a typo) is indistinguishable from a legitimate
 * non-residential use like "Büro": it silently derives …Nichtwohnen, and the
 * mandatory-KPI check then reports whichever KPIs that scenario wants —
 * masking the real problem. Validate before deriving a scenario.
 */
export function isRecognisedBuildingUse(primaryUse: unknown): boolean {
  return (
    typeof primaryUse === "string" &&
    (WOHNEN_VALUES.has(primaryUse) ||
      BuildingUseEnum.safeParse(primaryUse).success)
  );
}

/** The values KPI 3-1 accepts — used to make the rejection message actionable. */
export const RECOGNISED_BUILDING_USES: readonly string[] =
  BuildingUseEnum.options;

export function deriveScenario(
  completionYear: string | number,
  primaryUse: string,
  buildingApplicationDate?: string | null,
): BuildingScenario {
  // Completion year 2020 or earlier is Bestand outright — 1-1 is not collected
  // there, so any value that reached us for it cannot promote the building.
  const isNeubau =
    requiresBuildingApplicationDate(completionYear) &&
    computeIsNeubau(buildingApplicationDate);
  const isWohnen = computeIsWohnen(primaryUse);

  if (isNeubau && isWohnen) return "neubauWohnen";
  if (isNeubau && !isWohnen) return "neubauNichtwohnen";
  if (!isNeubau && isWohnen) return "bestandWohnen";
  return "bestandNichtwohnen";
}

// =============================================================================
// Mandatory KPI Matrix
// =============================================================================

interface MandatoryKpiDef {
  kpiNumber: string;
  schemaKey: string;
  section: string;
  label: string;
  neubauWohnen: boolean;
  bestandWohnen: boolean;
  neubauNichtwohnen: boolean;
  bestandNichtwohnen: boolean;
}

const MANDATORY_KPIS: MandatoryKpiDef[] = [
  {
    kpiNumber: "1-2",
    schemaKey: "KPI_1_2_Building_Completion_Year",
    section: "Property_Related_Data",
    label: "Year of construction",
    neubauWohnen: true,
    bestandWohnen: true,
    neubauNichtwohnen: true,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "3-1",
    schemaKey: "KPI_3_1_Main_Use_Of_Building",
    section: "Property_Related_Data",
    label: "Primary use of building",
    neubauWohnen: true,
    bestandWohnen: true,
    neubauNichtwohnen: true,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "4-1",
    schemaKey: "KPI_4_1_Usage_Of_Fossil_Fuels",
    section: "Property_Related_Data",
    label: "Usage for fossil fuels",
    neubauWohnen: false,
    bestandWohnen: false,
    neubauNichtwohnen: true,
    bestandNichtwohnen: false,
  },
  {
    kpiNumber: "5-1",
    schemaKey: "KPI_5_1_Usage_Area_ThermalyConditioned_Residential",
    section: "Property_Related_Data",
    label: "Usable area (heated/cooled) — residential",
    neubauWohnen: true,
    bestandWohnen: true,
    neubauNichtwohnen: false,
    bestandNichtwohnen: false,
  },
  {
    kpiNumber: "5-2",
    schemaKey: "KPI_5_2_NetFloorArea_ThermalyConditioned_NonResidential",
    section: "Property_Related_Data",
    label: "Net floor area (heated/cooled) — non-residential",
    neubauWohnen: false,
    bestandWohnen: false,
    neubauNichtwohnen: true,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "6-1",
    schemaKey: "KPI_6_1_Object_Is_Taxonomy_Aligned",
    section: "Property_Related_Data",
    label: "Taxonomy alignment",
    neubauWohnen: true,
    bestandWohnen: true,
    neubauNichtwohnen: true,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "7-7",
    schemaKey: "KPI_7_7_EPC_Expiry_Date",
    section: "Energy_Performance",
    label: "EPC expiry date",
    neubauWohnen: true,
    bestandWohnen: true,
    neubauNichtwohnen: true,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "7-8",
    schemaKey: "KPI_7_8_EPC_Type",
    section: "Energy_Performance",
    label: "EPC type",
    neubauWohnen: true,
    bestandWohnen: true,
    neubauNichtwohnen: true,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "8-1",
    schemaKey: "KPI_8_1_EnergyCarriersForHeating",
    section: "Energy_Consumption",
    label: "Heating medium",
    neubauWohnen: true,
    bestandWohnen: true,
    neubauNichtwohnen: true,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "9-1",
    schemaKey: "KPI_9_1_DirectEmissions",
    section: "Greenhouse_Gases",
    label: "Direct GHG emissions",
    neubauWohnen: false,
    bestandWohnen: true,
    neubauNichtwohnen: false,
    bestandNichtwohnen: true,
  },
  {
    kpiNumber: "9-2",
    schemaKey: "KPI_9_2_IndirectEmissions",
    section: "Greenhouse_Gases",
    label: "Indirect GHG emissions",
    neubauWohnen: false,
    bestandWohnen: true,
    neubauNichtwohnen: false,
    bestandNichtwohnen: true,
  },
];

// =============================================================================
// Query Functions
// =============================================================================

export function getMandatoryKpis(scenario: BuildingScenario): MandatoryKpiDef[] {
  return MANDATORY_KPIS.filter((kpi) => kpi[scenario]);
}

export function getMandatorySchemaKeys(scenario: BuildingScenario): string[] {
  return getMandatoryKpis(scenario).map((kpi) => kpi.schemaKey);
}

/**
 * KPI 1-1 is required from completion year 2021 onwards, and not collected below
 * that — so it is conditional on 1-2 rather than on the scenario, and cannot be
 * expressed as a column in the matrix above. It is also what decides
 * Neubau/Bestand, so a submission from 2021 on that omits it is not merely
 * incomplete: it silently classifies as Bestand.
 */
const BUILDING_APPLICATION_DATE_KPI: MandatoryKpiDef = {
  kpiNumber: "1-1",
  schemaKey: "KPI_1_1_Date_Of_Building_Permit",
  section: "Property_Related_Data",
  label: "Date of building permit application",
  neubauWohnen: true,
  bestandWohnen: true,
  neubauNichtwohnen: true,
  bestandNichtwohnen: true,
};

/**
 * Every KPI required for this scenario *and* this completion year — the matrix
 * plus the conditional 1-1. Use this for enforcement rather than
 * `getMandatoryKpis`.
 */
export function getRequiredKpisForSubmission(
  scenario: BuildingScenario,
  completionYear: string | number | null | undefined,
): MandatoryKpiDef[] {
  const required = getMandatoryKpis(scenario);
  if (!requiresBuildingApplicationDate(completionYear)) return required;
  if (required.some((k) => k.kpiNumber === "1-1")) return required;
  return [BUILDING_APPLICATION_DATE_KPI, ...required];
}

// =============================================================================
// Initial Submission Validation
// =============================================================================

type KpiElement = KPIValueElement | KPIValueList;
type SectionData = Record<string, KpiElement>;

/**
 * Validate that all mandatory KPIs for the derived scenario are present
 * in the enriched KPI data. Only called on initial submission (no existing
 * KpiRecord for the asset).
 *
 * Returns the scenario and list of missing KPIs. If missingKpis is empty,
 * the submission is valid.
 */
export function validateInitialSubmission(
  enrichedData: KpiData,
  completionYear: string | number,
  primaryUse: string,
  buildingApplicationDate?: string | null,
): InitialSubmissionResult {
  const scenario = deriveScenario(
    completionYear,
    primaryUse,
    buildingApplicationDate,
  );
  const required = getRequiredKpisForSubmission(scenario, completionYear);

  const missingKpis: MissingKpi[] = [];

  for (const kpi of required) {
    const sectionData = (
      enrichedData as Record<string, SectionData | undefined>
    )[kpi.section];

    if (!sectionData || !(kpi.schemaKey in sectionData)) {
      missingKpis.push({
        kpiNumber: kpi.kpiNumber,
        schemaKey: kpi.schemaKey,
        section: kpi.section,
        label: kpi.label,
      });
    }
  }

  return {
    valid: missingKpis.length === 0,
    scenario,
    missingKpis,
  };
}

export interface CompletenessResult {
  /** True once every KPI the derived scenario requires is present. */
  isComplete: boolean;
  /** Null when 1-2 / 3-1 are missing or unrecognised, so no scenario applies. */
  scenario: BuildingScenario | null;
  presentKpis: string[];
  missingKpis: MissingKpi[];
  /** Set when completeness could not be evaluated at all. */
  blockedReason?: string;
}

/**
 * Is this dataset complete enough to sign?
 *
 * Judged against the mandatory-KPI matrix for the building's own scenario — the
 * same rules the submitter is held to. It deliberately does **not** require every
 * V0.9.2 section to be populated: the ZIA schema marks all four sections
 * `required`, but the scenario matrix says e.g. a Neubau-Nichtwohnen building
 * needs no GHG KPIs, and a dataset cannot be both "valid per the rules we
 * enforce" and "too incomplete to sign". The scenario matrix wins.
 *
 * Replaces the old section-emptiness heuristic, which left submissions that
 * satisfied every mandatory rule permanently unsigned.
 */
export function evaluateCompleteness(data: KpiData): CompletenessResult {
  const presentKpis = getPresentKpiKeys(data);
  const inputs = extractScenarioInputs(data);

  if (!inputs) {
    return {
      isComplete: false,
      scenario: null,
      presentKpis,
      missingKpis: [],
      blockedReason:
        "KPI 1-2 (Year of construction) and KPI 3-1 (Primary use of building) are required to determine the building scenario",
    };
  }

  if (!isRecognisedBuildingUse(inputs.primaryUse)) {
    return {
      isComplete: false,
      scenario: null,
      presentKpis,
      missingKpis: [],
      blockedReason: `KPI 3-1 (Primary use of building) value "${String(inputs.primaryUse)}" is not a recognised use, so no scenario applies`,
    };
  }

  const { scenario, missingKpis } = validateInitialSubmission(
    data,
    inputs.constructionYear,
    inputs.primaryUse,
    inputs.buildingApplicationDate,
  );

  return {
    isComplete: missingKpis.length === 0,
    scenario,
    presentKpis,
    missingKpis,
  };
}

/** "Section.KPI_x_y" for every KPI element present in the data. */
function getPresentKpiKeys(data: KpiData): string[] {
  const keys: string[] = [];
  for (const section of KPI_SECTIONS) {
    const sectionData = (data as Record<string, SectionData | undefined>)[
      section
    ];
    if (!sectionData) continue;
    for (const kpiKey of Object.keys(sectionData)) {
      keys.push(`${section}.${kpiKey}`);
    }
  }
  return keys;
}

/**
 * Extract the raw Value from a KPI element (handles both KPIValueElement
 * and KPIValueList).
 */
function unwrapValue(element: KpiElement | undefined): unknown {
  if (!element) return undefined;
  if ("Value" in element) return element.Value;
  if ("Values" in element) return element.Values;
  return undefined;
}

/**
 * Extract KPI 1-2 (year of construction) and KPI 3-1 (primary use) from
 * enriched KPI data. These two are always mandatory and are needed to
 * derive the scenario.
 */
export function extractScenarioInputs(data: KpiData): {
  constructionYear: string | number;
  primaryUse: string;
  /** KPI 1-1 — null when absent, which classifies the building as Bestand. */
  buildingApplicationDate: string | null;
} | null {
  const prop = data.Property_Related_Data;
  if (!prop) return null;

  const yearElement = prop.KPI_1_2_Building_Completion_Year;
  const useElement = prop.KPI_3_1_Main_Use_Of_Building;
  const applicationElement = prop.KPI_1_1_Date_Of_Building_Permit;

  const constructionYear = unwrapValue(yearElement as KpiElement | undefined);
  const primaryUse = unwrapValue(useElement as KpiElement | undefined);
  const applicationDate = unwrapValue(
    applicationElement as KpiElement | undefined,
  );

  // 1-2 and 3-1 are what select the scenario, so without them there is nothing
  // to derive. 1-1 is optional here: absent means Bestand, not "undeterminable".
  if (constructionYear === undefined || primaryUse === undefined) return null;

  return {
    constructionYear: constructionYear as string | number,
    primaryUse: primaryUse as string,
    buildingApplicationDate:
      applicationDate === undefined ? null : String(applicationDate),
  };
}
