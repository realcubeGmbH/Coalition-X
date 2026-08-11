import type {
  KPIValueElement,
  KPIValueList,
  KPIEnergyDataBySourceAndUseCollection,
  KpiData,
} from "./schema";
import { KPI_SECTIONS } from "./schema";
import { SCHEMA_KEY_MAP } from "./registry";

// =============================================================================
// Types
// =============================================================================

export interface MergeContext {
  submittedBy: string;
}

export interface MergeResult {
  merged: KpiData;
  changedKpis: string[];
  addedKpis: string[];
  unchangedKpis: string[];
  conflictedKpis: string[];
}

type KpiElement =
  | KPIValueElement
  | KPIValueList
  | KPIEnergyDataBySourceAndUseCollection;
type SectionData = Record<string, KpiElement>;

// =============================================================================
// Main Merge Function
// =============================================================================

export function mergeKpiData(
  existing: KpiData | null,
  incoming: KpiData,
  context: MergeContext,
): MergeResult {
  if (!existing) {
    const allKeys = getAllKpiKeys(incoming);
    return {
      merged: incoming,
      changedKpis: [],
      addedKpis: allKeys,
      unchangedKpis: [],
      conflictedKpis: [],
    };
  }

  const result = structuredClone(existing);
  const changed: string[] = [];
  const added: string[] = [];
  const conflicted: string[] = [];

  for (const section of KPI_SECTIONS) {
    const incomingSection = (
      incoming as Record<string, SectionData | undefined>
    )[section];
    if (!incomingSection) continue;

    const resultSection =
      ((result as Record<string, SectionData | undefined>)[section] as
        | SectionData
        | undefined) ?? {};
    (result as Record<string, SectionData>)[section] = resultSection;

    for (const [kpiKey, newElement] of Object.entries(incomingSection)) {
      const qualifiedKey = `${section}.${kpiKey}`;
      const existingElement = resultSection[kpiKey];

      if (existingElement) {
        if (isConflict(existingElement, newElement)) {
          conflicted.push(qualifiedKey);
        }

        const def = SCHEMA_KEY_MAP.get(kpiKey);
        if (def?.elementType === "KPIEnergyDataBySourceAndUseCollection") {
          mergeEnergyTable(
            existingElement as KPIEnergyDataBySourceAndUseCollection,
            newElement as KPIEnergyDataBySourceAndUseCollection,
          );
        } else if (def?.elementType === "KPIValueList") {
          mergeValueList(
            existingElement as KPIValueList,
            newElement as KPIValueList,
          );
        } else {
          mergeValueElement(
            existingElement as KPIValueElement,
            newElement as KPIValueElement,
          );
        }

        resultSection[kpiKey] = newElement;
        changed.push(qualifiedKey);
      } else {
        resultSection[kpiKey] = newElement;
        added.push(qualifiedKey);
      }
    }
  }

  const allExistingKeys = getAllKpiKeys(existing);
  const unchanged = allExistingKeys.filter(
    (k) => !changed.includes(k) && !added.includes(k),
  );

  return {
    merged: result,
    changedKpis: changed,
    addedKpis: added,
    unchangedKpis: unchanged,
    conflictedKpis: conflicted,
  };
}

// =============================================================================
// Element-level merge (push old to History)
// =============================================================================

function mergeValueElement(
  existing: KPIValueElement,
  incoming: KPIValueElement,
): void {
  const historicalEntry = stripHistoryElement(existing);
  if (incoming.ReasonForChangeOrUpdate) {
    historicalEntry.ReasonForChangeOrUpdate = incoming.ReasonForChangeOrUpdate;
  }
  incoming.History = [historicalEntry, ...(existing.History ?? [])];
}

function mergeValueList(existing: KPIValueList, incoming: KPIValueList): void {
  const historicalEntry = stripHistoryList(existing);
  if (incoming.ReasonForChangeOrUpdate) {
    historicalEntry.ReasonForChangeOrUpdate = incoming.ReasonForChangeOrUpdate;
  }
  incoming.History = [historicalEntry, ...(existing.History ?? [])];
}

function mergeEnergyTable(
  existing: KPIEnergyDataBySourceAndUseCollection,
  incoming: KPIEnergyDataBySourceAndUseCollection,
): void {
  const historicalEntry = stripHistoryEnergyTable(existing);
  if (incoming.ReasonForChangeOrUpdate) {
    historicalEntry.ReasonForChangeOrUpdate = incoming.ReasonForChangeOrUpdate;
  }
  incoming.History = [historicalEntry, ...(existing.History ?? [])];
}

// =============================================================================
// Strip History (prevent recursive nesting)
// =============================================================================

function stripHistoryElement(element: KPIValueElement): KPIValueElement {
  const { History: _, ...rest } = element;
  return { ...rest, History: [] };
}

function stripHistoryList(element: KPIValueList): KPIValueList {
  const { History: _, ...rest } = element;
  return { ...rest, History: [] };
}

function stripHistoryEnergyTable(
  element: KPIEnergyDataBySourceAndUseCollection,
): KPIEnergyDataBySourceAndUseCollection {
  const { History: _, ...rest } = element;
  return { ...rest, History: [] };
}

// =============================================================================
// Conflict Detection
// =============================================================================

function isConflict(existing: KpiElement, incoming: KpiElement): boolean {
  return (
    existing.SubmittedBy !== incoming.SubmittedBy &&
    existing.Source === "input" &&
    incoming.Source === "input"
  );
}

// =============================================================================
// Completeness Evaluation
// =============================================================================

// Completeness lives in ./scenarios now (`evaluateCompleteness`), judged against
// the mandatory-KPI matrix for the building's own scenario.
//
// The rule that used to be here — "all four V0.9.2 sections must be non-empty" —
// came from the ZIA schema's top-level `required`, and it contradicted that
// matrix: a Neubau-Nichtwohnen building needs no GHG KPIs, yet an empty
// Greenhouse_Gases section made the record incomplete, so signing was skipped
// forever. A dataset cannot be both "valid per the rules we enforce" and "too
// incomplete to sign".

// =============================================================================
// Helpers
// =============================================================================

/** "Section.KPI_x_y" for every KPI element present in the data. */
function getAllKpiKeys(data: KpiData): string[] {
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
