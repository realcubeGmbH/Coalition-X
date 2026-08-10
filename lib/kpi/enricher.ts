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
}

export function enrichKpiInput(
  input: C1Input,
  context: EnrichmentContext,
): KpiData {
  const submittedAt = context.submittedAt ?? new Date().toISOString();
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
        );
      } else if (def.elementType === "KPIValueList") {
        section[kpiKey] = enrichAsValueList(
          rawValue,
          context.userId,
          submittedAt,
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
    Source: "input",
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
    Source: "input",
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
    items = table.values.map((item) => ({
      "Energy carrier": item.energy_carrier,
      TotalValue: item.total_value,
      Heating: item.heating,
      DomesticHotWater: item.domestic_hot_water,
      Cooling: item.cooling,
      Lighting: item.lighting,
      Ventilation: item.ventilation,
      AdditionalElectricityDemand: item.additional_electricity_demand,
      StartDateForConsumption: item.start_date,
      EndDateForConsumption: item.end_date,
      ConversionFactorPrimaryEnergy: item.conversion_factor_primary_energy,
      ValuesAreBasedOnInferiorHeatingValue:
        item.values_based_on_inferior_heating_value,
    }));
  }

  const element: KPIEnergyDataBySourceAndUseCollection = {
    Values: items,
    SubmittedBy: userId,
    SubmittedAt: submittedAt,
    Source: "input",
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
