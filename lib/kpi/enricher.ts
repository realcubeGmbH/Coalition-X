import type { C1Input, C1ValueType, C1EnergyDataItemType } from "./c1-input";
import { SCHEMA_KEY_MAP } from "./registry";
import type {
  KPIValueElement,
  KPIValueList,
  KPIEnergyDataBySourceAndUseCollection,
  KPIEnergyDataBySourceAndUseItem,
  KpiData,
  KpiSectionName,
} from "./schema";

export interface EnrichmentContext {
  userId: string;
  submittedAt?: string;
  /**
   * Provenance written to each element's `Source` — who supplied the value.
   * "Erfassungs App" for a person using the app, the partner organisation's name
   * for a machine-to-machine submission. Defaults to the old literal "input" so
   * a caller that does not set it keeps the previous behaviour.
   *
   * KPI 7-2 is exempt: its Source is a ZIA enum describing *how the class was
   * determined* (Energieausweis / FraunhoferMethode / BVI / GModG / andere), not
   * which system sent it, so a system name there would fail validation.
   */
  source?: string;
}

export function enrichKpiInput(
  input: C1Input,
  context: EnrichmentContext,
): KpiData {
  const submittedAt = context.submittedAt ?? new Date().toISOString();
  const source = context.source ?? "input";
  const result: KpiData = {};

  if (input.asset_id) {
    result.AssetID = input.asset_id;
  }

  for (const [sectionName, kpis] of Object.entries(input.kpis)) {
    if (!kpis) continue;

    const section: Record<
      string,
      KPIValueElement | KPIValueList | KPIEnergyDataBySourceAndUseCollection
    > = {};

    for (const [kpiKey, rawValue] of Object.entries(kpis)) {
      const def = SCHEMA_KEY_MAP.get(kpiKey);
      if (!def) continue;

      if (def.elementType === "KPIEnergyDataBySourceAndUseCollection") {
        section[kpiKey] = enrichAsEnergyTable(
          rawValue,
          context.userId,
          submittedAt,
          source,
        );
      } else if (def.elementType === "KPIValueList") {
        section[kpiKey] = enrichAsValueList(
          rawValue,
          context.userId,
          submittedAt,
          source,
        );
      } else if (kpiKey === "KPI_7_2_Energy_Class") {
        section[kpiKey] = enrichAsEnergyClass(
          rawValue,
          context.userId,
          submittedAt,
        );
      } else {
        section[kpiKey] = enrichAsValueElement(
          rawValue,
          context.userId,
          submittedAt,
          source,
        );
      }
    }

    if (Object.keys(section).length > 0) {
      (result as Record<string, unknown>)[sectionName as KpiSectionName] =
        section;
    }
  }

  return result;
}

function enrichAsValueElement(
  raw: C1ValueType,
  userId: string,
  submittedAt: string,
  source: string,
): KPIValueElement {
  let value: string | number | boolean;
  let additionalInfo: string | undefined;
  let reasonForChange: string | undefined;

  if (typeof raw === "object" && raw !== null && "value" in raw) {
    value = (raw as { value: string }).value;
  } else if (typeof raw === "object" && raw !== null && "values" in raw) {
    const arr = raw as { values: (string | number | boolean)[] };
    value = arr.values[0] ?? "";
  } else {
    value = raw as string | number | boolean;
  }

  if (typeof raw === "object" && raw !== null) {
    if ("additional_information" in raw) {
      additionalInfo = (raw as { additional_information?: string })
        .additional_information;
    }
    if ("reason_for_change" in raw) {
      reasonForChange = (raw as { reason_for_change?: string })
        .reason_for_change;
    }
  }

  const element: KPIValueElement = {
    Value: value,
    SubmittedBy: userId,
    SubmittedAt: submittedAt,
    Source: source,
    History: [],
  };

  if (additionalInfo !== undefined) {
    element.AdditionalInformation = additionalInfo;
  }
  if (reasonForChange !== undefined) {
    element.ReasonForChangeOrUpdate = reasonForChange;
  }

  return element;
}

function enrichAsValueList(
  raw: C1ValueType,
  userId: string,
  submittedAt: string,
  source: string,
): KPIValueList {
  let values: (string | number | boolean)[];
  let additionalInfo: string | undefined;
  let reasonForChange: string | undefined;

  if (typeof raw === "object" && raw !== null && "values" in raw) {
    const arr = raw as {
      values: (string | number | boolean)[];
      additional_information?: string;
      reason_for_change?: string;
    };
    values = arr.values;
    additionalInfo = arr.additional_information;
    reasonForChange = arr.reason_for_change;
  } else if (Array.isArray(raw)) {
    values = raw;
  } else {
    values = [raw as string | number | boolean];
  }

  const element: KPIValueList = {
    Values: values,
    SubmittedBy: userId,
    SubmittedAt: submittedAt,
    Source: source,
    History: [],
  };

  if (additionalInfo !== undefined) {
    element.AdditionalInformation = additionalInfo;
  }
  if (reasonForChange !== undefined) {
    element.ReasonForChangeOrUpdate = reasonForChange;
  }

  return element;
}

function enrichAsEnergyClass(
  raw: C1ValueType,
  userId: string,
  submittedAt: string,
): KPIValueElement {
  let value: string;
  let source: string;
  let reasonForChange: string | undefined;

  if (
    typeof raw === "object" &&
    raw !== null &&
    "value" in raw &&
    "source" in raw
  ) {
    const ec = raw as { value: string; source: string; reason_for_change?: string };
    value = ec.value;
    source = ec.source;
    reasonForChange = ec.reason_for_change;
  } else {
    value = String(raw);
    source = "andere";
  }

  const element: KPIValueElement = {
    Value: value,
    SubmittedBy: userId,
    SubmittedAt: submittedAt,
    Source: source,
    History: [],
  };

  if (reasonForChange !== undefined) {
    element.ReasonForChangeOrUpdate = reasonForChange;
  }

  return element;
}

function enrichAsEnergyTable(
  raw: C1ValueType,
  userId: string,
  submittedAt: string,
  source: string,
): KPIEnergyDataBySourceAndUseCollection {
  // Falling through with an empty `Values` here is how a scalar sent for KPI 8-3
  // used to be stored and signed as "no data", with no error anywhere.
  // C1InputSchema rejects that shape now, so this is an unreachable-by-API
  // guard: loud beats losing the value.
  if (typeof raw !== "object" || raw === null || !("values" in raw)) {
    throw new Error(
      `Table KPI value must be { values: [ … ] }, received ${typeof raw}`,
    );
  }

  let items: KPIEnergyDataBySourceAndUseItem[] = [];
  let additionalInfo: string | undefined;
  let reasonForChange: string | undefined;

  {
    const table = raw as {
      values: C1EnergyDataItemType[];
      additional_information?: string;
      reason_for_change?: string;
    };
    additionalInfo = table.additional_information;
    reasonForChange = table.reason_for_change;

    // Rows are stored exactly as submitted. The previous version rewrote the 12
    // V0.9.2 fields into PascalCase and dropped everything else, which would
    // silently discard the columns of the agreed table (Jahr, Nutzung, Scope,
    // Klima-/Leerstandsbereinigung, per-row 9-x). No value here is derived,
    // converted or renamed — the table is provenance-wrapped JSON.
    items = table.values.map(
      (item) => ({ ...item }) as unknown as KPIEnergyDataBySourceAndUseItem,
    );
  }

  const element: KPIEnergyDataBySourceAndUseCollection = {
    Values: items,
    SubmittedBy: userId,
    SubmittedAt: submittedAt,
    Source: source,
    History: [],
  };

  if (additionalInfo !== undefined) {
    element.AdditionalInformation = additionalInfo;
  }
  if (reasonForChange !== undefined) {
    element.ReasonForChangeOrUpdate = reasonForChange;
  }

  return element;
}
