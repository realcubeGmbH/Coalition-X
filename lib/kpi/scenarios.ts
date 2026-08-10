/**
 * Building Scenario Derivation & Mandatory KPI Enforcement
 *
 * Mirrors the erfassungs-app logic:
 * - Neubau/Bestand determined by building age: under 10 years old = Neubau,
 *   10 years or older = Bestand (rolling window against the current year)
 * - Wohnen/Nichtwohnen determined by primary building use (KPI 3-1)
 * - Mandatory KPI matrix enforced on initial submission only
 */

import { BuildingUseEnum } from "./schema";
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
 * A building counts as Neubau (new) while it is under 10 years old; once its
 * age reaches 10 years it is Bestand (existing). Age is a whole-year diff
 * against the current year — e.g. in 2026 a completion year of 2016 gives
 * 2026 - 2016 = 10 → Bestand.
 */
const NEUBAU_MAX_AGE_YEARS = 10;

const WOHNEN_VALUES = new Set([
  "Wohnen",
  "RESIDENTIAL",
  "residential",
]);

// =============================================================================
// Scenario Derivation
// =============================================================================

export function computeIsNeubau(constructionYear: string | number): boolean {
  const year =
    typeof constructionYear === "number"
      ? constructionYear
      : parseInt(String(constructionYear).trim(), 10);
  if (!Number.isInteger(year)) return false;

  const currentYear = new Date().getFullYear();
  return currentYear - year < NEUBAU_MAX_AGE_YEARS;
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
  constructionYear: string | number,
  primaryUse: string,
): BuildingScenario {
  const isNeubau = computeIsNeubau(constructionYear);
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
  constructionYear: string | number,
  primaryUse: string,
): InitialSubmissionResult {
  const scenario = deriveScenario(constructionYear, primaryUse);
  const required = getMandatoryKpis(scenario);

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
export function extractScenarioInputs(
  data: KpiData,
): { constructionYear: string | number; primaryUse: string } | null {
  const prop = data.Property_Related_Data;
  if (!prop) return null;

  const yearElement = prop.KPI_1_2_Building_Completion_Year;
  const useElement = prop.KPI_3_1_Main_Use_Of_Building;

  const constructionYear = unwrapValue(yearElement as KpiElement | undefined);
  const primaryUse = unwrapValue(useElement as KpiElement | undefined);

  if (constructionYear === undefined || primaryUse === undefined) return null;

  return {
    constructionYear: constructionYear as string | number,
    primaryUse: primaryUse as string,
  };
}
