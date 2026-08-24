/**
 * KPI Registry
 *
 * Central registry for all ZIA KPIs with mapping between:
 * - KPI numbers (e.g., "1-1", "7-3")
 * - API input format (e.g., "kpi_1-1")
 * - Internal field names (e.g., "Building_Permit_Date_Of_Building_Permit_Application")
 *
 * Based on:
 * - Connector 1 AC3: Input format {"kpi_1-1": "2025-10-15"}
 * - CoalitionX_BasicListOfKPIs_Flat.JSON schema
 * - CoalitionX_Vollständigkeit_KPIListe document (Extended KPIs)
 */

import {
  getMandatorySchemaKeys,
  type BuildingScenario,
} from "./scenarios";

// =============================================================================
// Types
// =============================================================================

export type KpiType = "BASIC" | "EXTENDED";

export type KpiDomain =
  | "PROPERTY"
  | "RENOVATION"
  | "ENERGY_PERFORMANCE"
  | "ENERGY_CONSUMPTION"
  | "GREENHOUSE_GASES";

export type KpiDataType =
  | "string"
  | "number"
  | "date"
  | "boolean"
  | "enum"
  | "file"
  | "percentage";

export interface KpiRelevance {
  newBuildings: boolean;
  existingBuildings: boolean;
  renovation: boolean;
  demolition: boolean;
  residential: boolean;
  nonResidential: boolean;
}

export type KpiElementType =
  | "KPIValueElement"
  | "KPIValueList"
  | "KPIEnergyDataBySourceAndUseCollection";

export type KpiSection =
  | "Property_Related_Data"
  | "Energy_Performance"
  | "Energy_Consumption"
  | "Greenhouse_Gases";

export interface KpiDefinition {
  /** KPI number (e.g., "1-1") */
  number: string;

  /** API input key (e.g., "kpi_1-1") */
  apiKey: string;

  /** Internal field name */
  fieldName: string;

  /** KPI type: BASIC or EXTENDED */
  type: KpiType;

  /** Domain category */
  domain: KpiDomain;

  /** Data type for validation */
  dataType: KpiDataType;

  /** Unit of measurement */
  unit: string;

  /** English name */
  nameEN: string;

  /** German name */
  nameDE: string;

  /** English data point description */
  dataPointEN: string;

  /** German data point description */
  dataPointDE: string;

  /** Condition that makes this field optional */
  optionalCondition?: string;

  /** Context-based relevance */
  relevance: KpiRelevance;

  /** Allowed values for enum types */
  enumValues?: string[];

  /** Regulatory references */
  regulations?: {
    taxonomy?: string;
    sfdr?: string;
    csrd?: string;
    banking?: string;
    din?: string;
  };

  /** Element type: scalar or array */
  elementType: KpiElementType;

  /** Schema key name (e.g., "KPI_1_1_Date_Of_Building_Permit") */
  schemaKey: string;

  /** Schema section (e.g., "Property_Related_Data") */
  schemaSection: KpiSection;
}

// =============================================================================
// KPI Registry Data
// =============================================================================

export const KPI_REGISTRY: Record<string, KpiDefinition> = {
  // =========================================================================
  // KPI 1: Building Permit
  // =========================================================================
  "1-1": {
    number: "1-1",
    apiKey: "kpi_1-1",
    fieldName: "Building_Permit_Date_Of_Building_Permit_Application",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "date",
    unit: "date",
    nameEN: "Building permit",
    nameDE: "Baugenehmigung",
    dataPointEN: "Date of building permit application",
    dataPointDE: "Datum der vollständigen Einreichung des Bauantrags",
    optionalCondition: "Data point obsolete if KPI 6-1 is met",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      taxonomy: "CM 7.1 SC / CM 7.7 DNSH / CM 7.7 SC",
      sfdr: "PAI 18",
      din: "SD.ODA.004",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_1_1_Date_Of_Building_Permit",
    schemaSection: "Property_Related_Data",
  },

  "1-2": {
    number: "1-2",
    apiKey: "kpi_1-2",
    fieldName: "Building_Permit_Year_Of_Construction",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "number",
    unit: "year",
    nameEN: "Building permit",
    nameDE: "Baugenehmigung",
    dataPointEN: "Year of construction",
    dataPointDE: "Fertigstellungsjahr",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      din: "SD.ODA.003",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_1_2_Building_Completion_Year",
    schemaSection: "Property_Related_Data",
  },

  // =========================================================================
  // KPI 2: Renovation (Extended KPIs)
  // =========================================================================
  "2-1": {
    number: "2-1",
    apiKey: "kpi_2-1",
    fieldName: "Renovation_Year_Of_Last_Energy_Renovation",
    type: "EXTENDED",
    domain: "RENOVATION",
    dataType: "number",
    unit: "year",
    nameEN: "Renovation",
    nameDE: "Renovierung",
    dataPointEN: "Year of last energy renovation",
    dataPointDE: "Jahr der zuletzt durchgeführten energetischen Sanierung",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_2_1_YearOfLastRetrofit",
    schemaSection: "Property_Related_Data",
  },

  "2-2": {
    number: "2-2",
    apiKey: "kpi_2-2",
    fieldName: "Renovation_Type_Of_Last_Energy_Renovation",
    type: "EXTENDED",
    domain: "RENOVATION",
    dataType: "string",
    unit: "text",
    nameEN: "Renovation",
    nameDE: "Renovierung",
    dataPointEN: "Type of last energy renovation",
    dataPointDE: "Art der zuletzt durchgeführten energetischen Sanierung",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_2_2_TypeOfLastRetrofit",
    schemaSection: "Property_Related_Data",
  },

  // =========================================================================
  // KPI 3: Building Use Type
  // =========================================================================
  "3-1": {
    number: "3-1",
    apiKey: "kpi_3-1",
    fieldName: "Building_Use_Type_Primary_Use_Of_Building",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "enum",
    unit: "category",
    nameEN: "Building use type",
    nameDE: "Gebäudenutzungsart",
    dataPointEN: "Primary use of building",
    dataPointDE: "Hauptnutzung des Gebäudes",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    enumValues: [
      "RESIDENTIAL",
      "RETAIL",
      "OFFICE",
      "HOTEL_ACCOMMODATION_GASTRONOMY",
      "HEALTHCARE_SOCIAL",
      "INDUSTRIAL_LOGISTICS",
      "INFRASTRUCTURE",
      "RECREATION_CULTURE_EDUCATION",
      "MIXED_USE",
      "OTHER",
    ],
    regulations: {
      taxonomy:
        "CA 7.7 DNSH / CM 7.1 DNSH / CM 7.1 SC / CM 7.2 DNSH / CM 7.7 SC",
      banking: "Basel, EBA",
      din: "SD.GEN.001",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_3_1_Main_Use_Of_Building",
    schemaSection: "Property_Related_Data",
  },

  // =========================================================================
  // KPI 4: Fossil Fuels
  // =========================================================================
  "4-1": {
    number: "4-1",
    apiKey: "kpi_4-1",
    fieldName:
      "Use_For_Fossil_Fuels_Usage_For_Extraction_Storage_Transport_Or_Manufacture_Of_Fossil_Fuels",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "percentage",
    unit: "% of net target rent",
    nameEN: "Use for fossil fuels",
    nameDE: "Verwendung für fossile Brennstoffe",
    dataPointEN:
      "Usage for extraction, storage, transport or manufacture of fossil fuels",
    dataPointDE:
      "Nutzung für Gewinnung, Lagerung, Beförderung oder Herstellung fossiler Brennstoffe",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: false,
      nonResidential: true,
    },
    regulations: {
      taxonomy: "CA 7.1-7.7 DNSH",
      sfdr: "PAI 17",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_4_1_Usage_Of_Fossil_Fuels",
    schemaSection: "Property_Related_Data",
  },

  // =========================================================================
  // KPI 5: Surface Measures
  // =========================================================================
  "5-1": {
    number: "5-1",
    apiKey: "kpi_5-1",
    fieldName: "Surface_Measure_Usable_Area_heated_Or_Cooled",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "number",
    unit: "m²",
    nameEN: "Surface measure",
    nameDE: "Flächenmaß",
    dataPointEN: "Usable area (heated or cooled)",
    dataPointDE: "Nutzungsfläche (NF) (beheizt oder gekühlt)",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: false,
    },
    regulations: {
      taxonomy:
        "CA 7.1 DNSH / CA 7.7 DNSH / CE 3.1 SC / CE 3.2 SC / CM 7.1 SC / CM 7.2 SC",
      sfdr: "PAI 18+19",
      banking: "CRR",
      din: "SD.FLA.003",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_5_1_Usage_Area_ThermalyConditioned_Residential",
    schemaSection: "Property_Related_Data",
  },

  "5-2": {
    number: "5-2",
    apiKey: "kpi_5-2",
    fieldName: "Surface_Measure_Useful_Internal_Floor_Area_heated_Or_Cooled",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "number",
    unit: "m²",
    nameEN: "Surface measure",
    nameDE: "Flächenmaß",
    dataPointEN: "Useful internal floor area (heated or cooled)",
    dataPointDE: "Nettogrundfläche (NGF) (beheizt oder gekühlt)",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: false,
      nonResidential: true,
    },
    regulations: {
      taxonomy:
        "CA 7.1 DNSH / CA 7.7 DNSH / CE 3.1 SC / CE 3.2 SC / CM 7.1 SC / CM 7.2 SC",
      sfdr: "PAI 18+19",
      banking: "CRR",
      din: "SD.FLA.002",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_5_2_NetFloorArea_ThermalyConditioned_NonResidential",
    schemaSection: "Property_Related_Data",
  },

  "5-3": {
    number: "5-3",
    apiKey: "kpi_5-3",
    fieldName: "Surface_Measure_Gross_External_Area_IPMS_1",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "number",
    unit: "m²",
    nameEN: "Surface measure",
    nameDE: "Flächenmaß",
    dataPointEN: "Gross external area (IPMS 1)",
    dataPointDE: "Bruttogrundfläche (BGF)",
    optionalCondition: "If available",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      taxonomy: "CM 7.1 SC / CE 3.2 SC",
      din: "SD.FLA.001",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_5_3_GrossExternalArea",
    schemaSection: "Property_Related_Data",
  },

  "5-4": {
    number: "5-4",
    apiKey: "kpi_5-4",
    fieldName: "Surface_Measure_Total_Gross_Internal_Area_IPMS_2",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "number",
    unit: "m²",
    nameEN: "Surface measure",
    nameDE: "Flächenmaß",
    dataPointEN: "Total gross internal area (IPMS 2)",
    dataPointDE: "Bruttoinnenfläche (IPMS 2)",
    optionalCondition: "If available",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      din: "SD.FLA.011",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_5_4_GrossInternalArea",
    schemaSection: "Property_Related_Data",
  },

  "5-5": {
    number: "5-5",
    apiKey: "kpi_5-5",
    fieldName: "Surface_Measure_Rental_Area",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "number",
    unit: "m²",
    nameEN: "Surface measure",
    nameDE: "Flächenmaß",
    dataPointEN: "Rental area",
    dataPointDE: "Mietfläche",
    optionalCondition: "If available",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      din: "SD.FLA.007",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_5_5_Rental_Area",
    schemaSection: "Property_Related_Data",
  },

  // =========================================================================
  // KPI 6: Taxonomy Alignment
  // =========================================================================
  "6-1": {
    number: "6-1",
    apiKey: "kpi_6-1",
    fieldName: "Taxonomy_Alignment_Object_Activity_Is_Taxonomy_Aligned",
    type: "BASIC",
    domain: "PROPERTY",
    dataType: "enum",
    unit: "category",
    nameEN: "Taxonomy-alignment",
    nameDE: "Taxonomie-Konformität",
    dataPointEN: "Object/activity is taxonomy-aligned",
    dataPointDE: "Objekt/Aktivität ist taxonomiekonform",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: true,
      residential: true,
      nonResidential: true,
    },
    // NOT_ASSESSED = the taxonomy check was never carried out, which is a
    // different answer from NO (checked, not aligned).
    enumValues: ["YES_CA", "YES_CE", "YES_CM", "NO", "NOT_ASSESSED"],
    elementType: "KPIValueElement",
    schemaKey: "KPI_6_1_Object_Is_Taxonomy_Aligned",
    schemaSection: "Property_Related_Data",
  },

  // =========================================================================
  // KPI 7: Energy Performance Certificate (EPC)
  // =========================================================================
  "7-1": {
    number: "7-1",
    apiKey: "kpi_7-1",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "file",
    unit: "file",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN: "Energy Performance Certificate (EPC)",
    dataPointDE: "Energieausweis",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      taxonomy: "CA 7.7 DNSH / CM 7.7 SC",
      sfdr: "PAI 18",
      csrd: "ESRS E1-9",
      banking: "CRR, EBA, ECB",
      din: "SD.ENP.007",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_1_Energy_Performance_Certificate",
    schemaSection: "Energy_Performance",
  },

  "7-2": {
    number: "7-2",
    apiKey: "kpi_7-2",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC_Class",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "string",
    unit: "alphanumerical",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN: "Energy Performance Certificate (EPC) class",
    dataPointDE: "Energieausweis: Energieeffizienzklasse",
    optionalCondition:
      "Only to be indicated if no digitally readable EPC is available",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    enumValues: ["A+", "A", "B", "C", "D", "E", "F", "G", "H"],
    regulations: {
      taxonomy: "CA 7.7 DNSH / CM 7.7 SC",
      sfdr: "PAI 18",
      csrd: "ESRS E1-9",
      banking: "CRR, EBA, ECB",
      din: "SD.ENP.007",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_2_Energy_Class",
    schemaSection: "Energy_Performance",
  },

  "7-3": {
    number: "7-3",
    apiKey: "kpi_7-3",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC_Primary_Energy_Consumption",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "number",
    unit: "kWh/m²a",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN:
      "Energy Performance Certificate (EPC) primary energy consumption",
    dataPointDE: "Energie(verbrauchs)ausweis: Primärenergieverbrauch",
    optionalCondition: "Only for consumption-based EPC without digital file",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      din: "SD.ENP.004",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_3_Primary_Energy_Metered",
    schemaSection: "Energy_Performance",
  },

  "7-4": {
    number: "7-4",
    apiKey: "kpi_7-4",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC_Primary_Energy_Demand",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "number",
    unit: "kWh/m²a",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN: "Energy Performance Certificate (EPC) primary energy demand",
    dataPointDE: "Energie(bedarfs)ausweis: Primärenergiebedarf",
    optionalCondition: "Only for demand-based EPC without digital file",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      taxonomy: "CA 7.1 SC / CM 7.1 SC",
      din: "SD.ENP.005",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_4_Primary_Energy_Calculated",
    schemaSection: "Energy_Performance",
  },

  "7-5": {
    number: "7-5",
    apiKey: "kpi_7-5",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC_End_Energy_Consumption",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "number",
    unit: "kWh/m²a",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN: "Energy Performance Certificate (EPC) end energy consumption",
    dataPointDE: "Energie(verbrauchs)ausweis: Endenergieverbrauch",
    optionalCondition: "Only for consumption-based EPC without digital file",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      din: "SD.ENP.004",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_5_Delivered_Energy_Metered",
    schemaSection: "Energy_Performance",
  },

  "7-6": {
    number: "7-6",
    apiKey: "kpi_7-6",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC_End_Energy_Demand",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "number",
    unit: "kWh/m²a",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN: "Energy Performance Certificate (EPC) end energy demand",
    dataPointDE: "Energie(bedarfs)ausweis: Endenergiebedarf",
    optionalCondition: "Only for demand-based EPC without digital file",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      taxonomy: "CA 7.1 SC / CM 7.1 SC",
      din: "SD.ENP.005",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_6_Delivered_Energy_Calculated",
    schemaSection: "Energy_Performance",
  },

  "7-7": {
    number: "7-7",
    apiKey: "kpi_7-7",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC_Expiry_Date",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "date",
    unit: "date",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN: "Energy Performance Certificate (EPC) expiry date",
    dataPointDE: "Energieausweis: Gültigkeitsdatum",
    optionalCondition:
      "Only to be indicated if no digitally readable EPC is available",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      din: "SD.ENP.002",
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_7_EPC_Expiry_Date",
    schemaSection: "Energy_Performance",
  },

  "7-8": {
    number: "7-8",
    apiKey: "kpi_7-8",
    fieldName:
      "Energy_Performance_Certificate_EPC_Energy_Performance_Certificate_EPC_Type",
    type: "BASIC",
    domain: "ENERGY_PERFORMANCE",
    dataType: "enum",
    unit: "category",
    nameEN: "Energy Performance Certificate (EPC)",
    nameDE: "Energieausweis",
    dataPointEN: "Energy Performance Certificate (EPC) type",
    dataPointDE: "Energieausweis: Art",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    enumValues: [
      "CONSUMPTION_BASED",
      "DEMAND_BASED",
      "NO_OBLIGATION",
      "NON_EXISTENT",
    ],
    elementType: "KPIValueElement",
    schemaKey: "KPI_7_8_EPC_Type",
    schemaSection: "Energy_Performance",
  },

  // =========================================================================
  // KPI 8: Energy Consumption
  // =========================================================================
  "8-1": {
    number: "8-1",
    apiKey: "kpi_8-1",
    fieldName: "Energy_Consumption_Heating_Medium",
    type: "BASIC",
    domain: "ENERGY_CONSUMPTION",
    dataType: "enum",
    unit: "category",
    nameEN: "Energy consumption",
    nameDE: "Energieverbrauch",
    dataPointEN: "Heating medium",
    dataPointDE: "Heizmedium",
    relevance: {
      newBuildings: true,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    enumValues: [
      "DISTRICT_HEATING",
      "GAS",
      "OIL",
      "ELECTRICITY",
      "HEAT_PUMP",
      "HYBRID",
    ],
    regulations: {
      din: "BD.WAE.004/005",
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_8_1_EnergyCarriersForHeating",
    schemaSection: "Energy_Consumption",
  },

  "8-2": {
    number: "8-2",
    apiKey: "kpi_8-2",
    fieldName: "Energy_Consumption_End_Energy_Consumption_Actual",
    type: "EXTENDED",
    domain: "ENERGY_CONSUMPTION",
    dataType: "number",
    unit: "kWh/m²a",
    nameEN: "Energy consumption",
    nameDE: "Energieverbrauch",
    dataPointEN: "End energy consumption (actual value)",
    dataPointDE: "Endenergieverbrauch (Ist-Wert)",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_8_2_MeteredEnergyConsumption",
    schemaSection: "Energy_Consumption",
  },

  "8-3": {
    number: "8-3",
    apiKey: "kpi_8-3",
    fieldName: "Energy_Consumption_End_Energy_Consumption_Table",
    type: "EXTENDED",
    domain: "ENERGY_CONSUMPTION",
    dataType: "string",
    unit: "table",
    nameEN: "Energy consumption",
    nameDE: "Energieverbrauch",
    dataPointEN: "End energy consumption table (actual values)",
    dataPointDE: "Endenergieverbrauchstabelle (Ist-Werte)",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: true,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    elementType: "KPIEnergyDataBySourceAndUseCollection",
    schemaKey: "KPI_8_3_MeteredEnergyConsumptionAsTable",
    schemaSection: "Energy_Consumption",
  },

  // =========================================================================
  // KPI 9: GHG Emissions
  // =========================================================================
  "9-1": {
    number: "9-1",
    apiKey: "kpi_9-1",
    fieldName:
      "GHG_Emissions_Direct_GHG_Emissions_Generated_In_On_Real_Estate_Asset",
    type: "BASIC",
    domain: "GREENHOUSE_GASES",
    dataType: "number",
    unit: "t CO2e p.a.",
    nameEN: "GHG emissions",
    nameDE: "Treibhausgasemissionen",
    dataPointEN: "Direct GHG emissions generated in/on real estate asset",
    dataPointDE: "Direkte Treibhausgasemissionen am/im Gebäude/Liegenschaft",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      sfdr: "PAI 18",
      csrd: "ESRS E1-6",
      din: "BD.THG.006",
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_9_1_DirectEmissions",
    schemaSection: "Greenhouse_Gases",
  },

  "9-2": {
    number: "9-2",
    apiKey: "kpi_9-2",
    fieldName:
      "GHG_Emissions_Indirect_GHG_Emissions_Generated_From_Energy_Usage_In_On_Real_Estate_Asset",
    type: "BASIC",
    domain: "GREENHOUSE_GASES",
    dataType: "number",
    unit: "t CO2e p.a.",
    nameEN: "GHG emissions",
    nameDE: "Treibhausgasemissionen",
    dataPointEN:
      "Indirect GHG emissions generated from energy usage in/on real estate asset",
    dataPointDE:
      "Indirekte Treibhausgasemissionen aus Energienutzung am/im Gebäude/Liegenschaft",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    regulations: {
      sfdr: "PAI 18",
      csrd: "ESRS E1-6",
      din: "BD.THG.007",
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_9_2_IndirectEmissions",
    schemaSection: "Greenhouse_Gases",
  },

  "9-3": {
    number: "9-3",
    apiKey: "kpi_9-3",
    fieldName: "GHG_Emissions_Other_Indirect_GHG_Emissions",
    type: "EXTENDED",
    domain: "GREENHOUSE_GASES",
    dataType: "number",
    unit: "t CO2e p.a.",
    nameEN: "GHG emissions",
    nameDE: "Treibhausgasemissionen",
    dataPointEN: "Other indirect GHG emissions",
    dataPointDE: "Weitere indirekte Treibhausgasemissionen",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_9_3_OtherIndirectEmissions",
    schemaSection: "Greenhouse_Gases",
  },

  "9-4": {
    number: "9-4",
    apiKey: "kpi_9-4",
    fieldName: "GHG_Emissions_Estimated_Emissions_Percentage",
    type: "EXTENDED",
    domain: "GREENHOUSE_GASES",
    dataType: "percentage",
    unit: "%",
    nameEN: "GHG emissions",
    nameDE: "Treibhausgasemissionen",
    dataPointEN: "Percentage of estimated GHG emissions",
    dataPointDE: "Anteil geschätzter Treibhausgasemissionen",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    elementType: "KPIValueElement",
    schemaKey: "KPI_9_4_ShareOfEstimatedEmissions",
    schemaSection: "Greenhouse_Gases",
  },

  "9-5": {
    number: "9-5",
    apiKey: "kpi_9-5",
    fieldName: "GHG_Emissions_Market_Or_Location_Based",
    type: "EXTENDED",
    domain: "GREENHOUSE_GASES",
    dataType: "enum",
    unit: "category",
    nameEN: "GHG emissions",
    nameDE: "Treibhausgasemissionen",
    dataPointEN: "Indirect GHG emissions market or location based",
    dataPointDE: "Indirekte Treibhausgasemissionen markt- oder standortbasiert",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    enumValues: ["MARKET_BASED", "LOCATION_BASED"],
    elementType: "KPIValueElement",
    schemaKey: "KPI_9_5_AreIndirectEmissionsBasedOnMarketOrOnLocation",
    schemaSection: "Greenhouse_Gases",
  },

  "9-6": {
    number: "9-6",
    apiKey: "kpi_9-6",
    fieldName: "GHG_Emissions_Provider_Specific_Emission_Factor",
    type: "EXTENDED",
    domain: "GREENHOUSE_GASES",
    dataType: "number",
    unit: "kg CO2e/kWh",
    nameEN: "GHG emissions",
    nameDE: "Treibhausgasemissionen",
    dataPointEN: "Provider-specific emission factor",
    dataPointDE: "Anbieterspezifischer Emissionsfaktor",
    optionalCondition: "Required if KPI 9-1 to 9-3 not submitted",
    relevance: {
      newBuildings: false,
      existingBuildings: true,
      renovation: false,
      demolition: false,
      residential: true,
      nonResidential: true,
    },
    elementType: "KPIValueList",
    schemaKey: "KPI_9_6_CO2EmissionsFactorPerCarrier",
    schemaSection: "Greenhouse_Gases",
  },
};

// =============================================================================
// Lookup Maps (built at module load)
// =============================================================================

/** Map from API key (kpi_1-1) to KPI definition */
export const API_KEY_MAP: Map<string, KpiDefinition> = new Map();

/** Map from internal field name to KPI definition */
export const FIELD_NAME_MAP: Map<string, KpiDefinition> = new Map();

/** Map from KPI number to KPI definition */
export const NUMBER_MAP: Map<string, KpiDefinition> = new Map();

/** Map from schema key (KPI_1_1_Date_Of_Building_Permit) to KPI definition */
export const SCHEMA_KEY_MAP: Map<string, KpiDefinition> = new Map();

/** Map from schema section to KPI definitions in that section */
export const SECTION_KPIS: Map<KpiSection, KpiDefinition[]> = new Map();

// Build lookup maps
for (const [number, def] of Object.entries(KPI_REGISTRY)) {
  API_KEY_MAP.set(def.apiKey, def);
  API_KEY_MAP.set(def.apiKey.replace("kpi_", ""), def);
  FIELD_NAME_MAP.set(def.fieldName, def);
  NUMBER_MAP.set(number, def);
  SCHEMA_KEY_MAP.set(def.schemaKey, def);
  const sectionList = SECTION_KPIS.get(def.schemaSection) ?? [];
  sectionList.push(def);
  SECTION_KPIS.set(def.schemaSection, sectionList);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get all KPI definitions
 */
export function getAllKpis(): KpiDefinition[] {
  return Object.values(KPI_REGISTRY);
}

/**
 * Get KPI definition by number (e.g., "1-1")
 */
export function getKpiByNumber(number: string): KpiDefinition | undefined {
  return KPI_REGISTRY[number];
}

/**
 * Get KPI definition by API key (e.g., "kpi_1-1")
 */
export function getKpiByApiKey(apiKey: string): KpiDefinition | undefined {
  return API_KEY_MAP.get(apiKey);
}

/**
 * Get KPI definition by internal field name
 */
export function getKpiByFieldName(
  fieldName: string,
): KpiDefinition | undefined {
  return FIELD_NAME_MAP.get(fieldName);
}

/**
 * Get all Basic KPIs
 */
export function getBasicKpis(): KpiDefinition[] {
  return Object.values(KPI_REGISTRY).filter((kpi) => kpi.type === "BASIC");
}

/**
 * Get all Extended KPIs
 */
export function getExtendedKpis(): KpiDefinition[] {
  return Object.values(KPI_REGISTRY).filter((kpi) => kpi.type === "EXTENDED");
}

/**
 * Get KPIs by domain
 */
export function getKpisByDomain(domain: KpiDomain): KpiDefinition[] {
  return Object.values(KPI_REGISTRY).filter((kpi) => kpi.domain === domain);
}

/**
 * Get required KPIs for a building context.
 *
 * Delegates to the scenario-based mandatory matrix in scenarios.ts for
 * enforcement. This function maps the API-style context to a BuildingScenario
 * and returns matching KpiDefinitions from the registry.
 *
 * @deprecated Prefer getMandatoryKpis() from scenarios.ts for enforcement.
 *   This wrapper is kept for backward compatibility.
 */
export function getRequiredKpis(context: {
  buildingState: "NEW" | "EXISTING" | "RENOVATION" | "DEMOLITION";
  buildingCategory: "RESIDENTIAL" | "NON_RESIDENTIAL";
}): KpiDefinition[] {
  const isNeubau =
    context.buildingState === "NEW" ||
    context.buildingState === "RENOVATION";
  const isWohnen = context.buildingCategory === "RESIDENTIAL";

  let scenario: BuildingScenario;
  if (isNeubau && isWohnen) scenario = "neubauWohnen";
  else if (isNeubau && !isWohnen) scenario = "neubauNichtwohnen";
  else if (!isNeubau && isWohnen) scenario = "bestandWohnen";
  else scenario = "bestandNichtwohnen";

  const mandatoryKeys = getMandatorySchemaKeys(scenario);
  const mandatorySet = new Set(mandatoryKeys);

  return Object.values(KPI_REGISTRY).filter((kpi) =>
    mandatorySet.has(kpi.schemaKey),
  );
}

/**
 * Get KPI numbers as array (for validation messages)
 */
export function getAllKpiNumbers(): string[] {
  return Object.keys(KPI_REGISTRY);
}

/**
 * Format KPI number for display (e.g., "KPI 1-1")
 */
export function formatKpiNumber(number: string): string {
  return `KPI ${number}`;
}

/**
 * Parse KPI identifier from various formats
 * Accepts: "1-1", "kpi_1-1", "KPI 1-1", "kpi1-1"
 */
export function parseKpiIdentifier(input: string): string | null {
  // Normalize input
  const normalized = input.toLowerCase().trim();

  // Try direct number match (e.g., "1-1")
  if (KPI_REGISTRY[normalized]) {
    return normalized;
  }

  // Try with kpi_ prefix removed (e.g., "kpi_1-1" -> "1-1")
  const withoutPrefix = normalized.replace(/^kpi[_\s-]?/, "");
  if (KPI_REGISTRY[withoutPrefix]) {
    return withoutPrefix;
  }

  return null;
}
