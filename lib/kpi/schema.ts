import { z } from "zod";

// =============================================================================
// Signature Schema (per V0.9.2 — JWS detached payload, RFC 7515 Appendix F)
// =============================================================================

const JwsCompactDetached = z.string().regex(/^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+$/);

const JwsJsonSignatureItem = z.object({
  protected: z.string(),
  header: z.record(z.string(), z.unknown()).optional(),
  signature: z.string(),
});

export const SignatureSchema = z.union([
  JwsCompactDetached,
  z.array(JwsCompactDetached).min(1),
  z.object({
    signatures: z.array(JwsJsonSignatureItem).min(1),
  }).strict(),
]);

export type Signature = z.infer<typeof SignatureSchema>;

// =============================================================================
// Source (per V0.9.2 — free string for generic elements, enum for EnergyClass)
// =============================================================================

export const EnergyClassSourceSchema = z.enum([
  "Energieausweis",
  "FraunhoferMethode",
  "BVI",
  "GModG",
  "andere",
]);
export type EnergyClassSource = z.infer<typeof EnergyClassSourceSchema>;

// =============================================================================
// Value Enums
// =============================================================================

export const BuildingUseEnum = z.enum([
  "Wohnen",
  "Handel",
  "Büro",
  "Hotel",
  "Beherbergung und Gastronomie",
  "Gesundheit und Soziales",
  "Industrie und Logistik",
  "Infrastruktur (Energie/Wasser, Kommunikation, Verkehr)",
  "Freizeit",
  "Kultur und Bildung",
  "Mixed-Use",
  "Andere",
]);

export const EnergyClassEnum = z.enum([
  "A+",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "Unbekannt",
]);

// =============================================================================
// KPIValueElement — scalar KPIs (per V0.9.2 schema)
// =============================================================================

export type KPIValueElement = {
  Value: string | number | boolean;
  SubmittedBy: string;
  SubmittedAt: string;
  AdditionalInformation?: string;
  Source?: string;
  ReasonForChangeOrUpdate?: string;
  Signature?: Signature;
  History?: KPIValueElement[];
};

export const KPIValueElementSchema: z.ZodType<KPIValueElement> = z.lazy(() =>
  z.object({
    Value: z.union([z.string(), z.number(), z.boolean()]),
    SubmittedBy: z.string(),
    SubmittedAt: z.string().datetime(),
    AdditionalInformation: z.string().optional(),
    Source: z.string().optional(),
    ReasonForChangeOrUpdate: z.string().optional(),
    Signature: SignatureSchema.optional(),
    History: z.array(KPIValueElementSchema).optional(),
  }),
);

// =============================================================================
// Completion year Value — KPI 1-2 (Fertigstellungsjahr)
// =============================================================================

/**
 * The Fertigstellungsjahr (KPI 1-2) is a year, not a date. Accept a 4-digit
 * year as a number (2016) or a plain numeric string ("2016"); reject dates
 * ("2016-01-01"), non-integers, and years outside a sane range.
 */
export function isValidCompletionYear(value: unknown): boolean {
  let year: number;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return false;
    year = value;
  } else if (typeof value === "string") {
    if (!/^\d{4}$/.test(value.trim())) return false;
    year = parseInt(value.trim(), 10);
  } else {
    return false;
  }
  const currentYear = new Date().getFullYear();
  return year >= 1800 && year <= currentYear;
}

/** KPIValueElement whose Value must be a valid completion year (KPI 1-2). */
export const KPIValueElementYearSchema: z.ZodType<KPIValueElement> = z.lazy(() =>
  z.object({
    Value: z
      .union([z.string(), z.number(), z.boolean()])
      .refine(isValidCompletionYear, {
        message:
          "Fertigstellungsjahr (KPI 1-2) must be a 4-digit year (e.g. 2016), not a date",
      }),
    SubmittedBy: z.string(),
    SubmittedAt: z.string().datetime(),
    AdditionalInformation: z.string().optional(),
    Source: z.string().optional(),
    ReasonForChangeOrUpdate: z.string().optional(),
    Signature: SignatureSchema.optional(),
    History: z.array(KPIValueElementYearSchema).optional(),
  }),
);

// =============================================================================
// KPIValueList — array KPIs (per V0.9.2 schema)
// =============================================================================

export type KPIValueList = {
  Values: Array<string | number | boolean>;
  SubmittedBy: string;
  SubmittedAt: string;
  AdditionalInformation?: string;
  Source?: string;
  ReasonForChangeOrUpdate?: string;
  Signature?: Signature;
  History?: KPIValueList[];
};

export const KPIValueListSchema: z.ZodType<KPIValueList> = z.lazy(() =>
  z.object({
    Values: z.array(z.union([z.string(), z.number(), z.boolean()])),
    SubmittedBy: z.string(),
    SubmittedAt: z.string().datetime(),
    AdditionalInformation: z.string().optional(),
    Source: z.string().optional(),
    ReasonForChangeOrUpdate: z.string().optional(),
    Signature: SignatureSchema.optional(),
    History: z.array(KPIValueListSchema).optional(),
  }),
);

// =============================================================================
// KPIValueElementUseofBuilding — KPI 3-1 (enum-restricted Value, optional)
// =============================================================================

export type KPIValueElementUseofBuilding = {
  Value?: z.infer<typeof BuildingUseEnum>;
  SubmittedBy: string;
  SubmittedAt: string;
  AdditionalInformation?: string;
  Source?: string;
  ReasonForChangeOrUpdate?: string;
  Signature?: Signature;
  History?: KPIValueElementUseofBuilding[];
};

export const KPIValueElementUseofBuildingSchema: z.ZodType<KPIValueElementUseofBuilding> =
  z.lazy(() =>
    z.object({
      Value: BuildingUseEnum.optional(),
      SubmittedBy: z.string(),
      SubmittedAt: z.string().datetime(),
      AdditionalInformation: z.string().optional(),
      Source: z.string().optional(),
      ReasonForChangeOrUpdate: z.string().optional(),
      Signature: SignatureSchema.optional(),
      History: z.array(KPIValueElementUseofBuildingSchema).optional(),
    }),
  );

// =============================================================================
// KPIValueElementEnergyClass — KPI 7-2 (enum Value + enum Source, both optional)
// =============================================================================

export type KPIValueElementEnergyClass = {
  Value?: z.infer<typeof EnergyClassEnum>;
  SubmittedBy: string;
  SubmittedAt: string;
  AdditionalInformation?: string;
  Source?: EnergyClassSource;
  ReasonForChangeOrUpdate?: string;
  Signature?: Signature;
  History?: KPIValueElementEnergyClass[];
};

export const KPIValueElementEnergyClassSchema: z.ZodType<KPIValueElementEnergyClass> =
  z.lazy(() =>
    z.object({
      Value: EnergyClassEnum.optional(),
      SubmittedBy: z.string(),
      SubmittedAt: z.string().datetime(),
      AdditionalInformation: z.string().optional(),
      Source: EnergyClassSourceSchema.optional(),
      ReasonForChangeOrUpdate: z.string().optional(),
      Signature: SignatureSchema.optional(),
      History: z.array(KPIValueElementEnergyClassSchema).optional(),
    }),
  );

// =============================================================================
// KPIEnergyDataBySourceAndUse — KPI 8-3 structured table (V0.9.2)
// =============================================================================

export const KPIEnergyDataBySourceAndUseItemSchema = z.object({
  "Energy carrier": z.string().optional(),
  TotalValue: z.number().optional(),
  Heating: z.number().optional(),
  DomesticHotWater: z.number().optional(),
  Cooling: z.number().optional(),
  Lighting: z.number().optional(),
  Ventilation: z.number().optional(),
  AdditionalElectricityDemand: z.number().optional(),
  StartDateForConsumption: z.string().datetime().optional(),
  EndDateForConsumption: z.string().datetime().optional(),
  ConversionFactorPrimaryEnergy: z.number().optional(),
  ValuesAreBasedOnInferiorHeatingValue: z.boolean().optional(),
}).strict();

export type KPIEnergyDataBySourceAndUseItem = z.infer<typeof KPIEnergyDataBySourceAndUseItemSchema>;

export type KPIEnergyDataBySourceAndUseCollection = {
  Values: KPIEnergyDataBySourceAndUseItem[];
  SubmittedBy: string;
  SubmittedAt: string;
  AdditionalInformation?: string;
  Source?: string;
  ReasonForChangeOrUpdate?: string;
  Signature?: Signature;
  History?: KPIEnergyDataBySourceAndUseCollection[];
};

export const KPIEnergyDataBySourceAndUseCollectionSchema: z.ZodType<KPIEnergyDataBySourceAndUseCollection> =
  z.lazy(() =>
    z.object({
      Values: z.array(KPIEnergyDataBySourceAndUseItemSchema),
      SubmittedBy: z.string(),
      SubmittedAt: z.string().datetime(),
      AdditionalInformation: z.string().optional(),
      Source: z.string().optional(),
      ReasonForChangeOrUpdate: z.string().optional(),
      Signature: SignatureSchema.optional(),
      History: z.array(KPIEnergyDataBySourceAndUseCollectionSchema).optional(),
    }),
  );

// =============================================================================
// Section Schemas (all fields optional — partial submissions)
// =============================================================================

export const PropertyRelatedDataSchema = z.object({
  KPI_1_1_Date_Of_Building_Permit: KPIValueElementSchema.optional(),
  KPI_1_2_Building_Completion_Year: KPIValueElementYearSchema.optional(),
  KPI_2_1_YearOfLastRetrofit: KPIValueListSchema.optional(),
  KPI_2_2_TypeOfLastRetrofit: KPIValueListSchema.optional(),
  KPI_3_1_Main_Use_Of_Building:
    KPIValueElementUseofBuildingSchema.optional(),
  KPI_4_1_Usage_Of_Fossil_Fuels: KPIValueElementSchema.optional(),
  KPI_5_1_Usage_Area_ThermalyConditioned_Residential:
    KPIValueElementSchema.optional(),
  KPI_5_2_NetFloorArea_ThermalyConditioned_NonResidential:
    KPIValueElementSchema.optional(),
  KPI_5_3_GrossExternalArea: KPIValueElementSchema.optional(),
  KPI_5_4_GrossInternalArea: KPIValueElementSchema.optional(),
  KPI_5_5_Rental_Area: KPIValueElementSchema.optional(),
  KPI_6_1_Object_Is_Taxonomy_Aligned: KPIValueElementSchema.optional(),
}).strict();

export const EnergyPerformanceSchema = z.object({
  KPI_7_1_Energy_Performance_Certificate: KPIValueElementSchema.optional(),
  KPI_7_2_Energy_Class: KPIValueElementEnergyClassSchema.optional(),
  KPI_7_3_Primary_Energy_Metered: KPIValueElementSchema.optional(),
  KPI_7_4_Primary_Energy_Calculated: KPIValueElementSchema.optional(),
  KPI_7_5_Delivered_Energy_Metered: KPIValueElementSchema.optional(),
  KPI_7_6_Delivered_Energy_Calculated: KPIValueElementSchema.optional(),
  KPI_7_7_EPC_Expiry_Date: KPIValueElementSchema.optional(),
  KPI_7_8_EPC_Type: KPIValueElementSchema.optional(),
}).strict();

export const EnergyConsumptionSchema = z.object({
  KPI_8_1_EnergyCarriersForHeating: KPIValueListSchema.optional(),
  KPI_8_2_MeteredEnergyConsumption: KPIValueListSchema.optional(),
  KPI_8_3_MeteredEnergyConsumptionAsTable:
    KPIEnergyDataBySourceAndUseCollectionSchema.optional(),
}).strict();

export const GreenhouseGasesSchema = z.object({
  KPI_9_1_DirectEmissions: KPIValueListSchema.optional(),
  KPI_9_2_IndirectEmissions: KPIValueListSchema.optional(),
  KPI_9_3_OtherIndirectEmissions: KPIValueListSchema.optional(),
  KPI_9_4_ShareOfEstimatedEmissions: KPIValueElementSchema.optional(),
  KPI_9_5_AreIndirectEmissionsBasedOnMarketOrOnLocation:
    KPIValueElementSchema.optional(),
  KPI_9_6_CO2EmissionsFactorPerCarrier: KPIValueListSchema.optional(),
}).strict();

export const ExtendedDataSchema = z.object({
  MaximumPrimaryEnergyDemand_Metered: z.number().optional(),
  MaximumPrimaryEnergyDemand_Calculated: z.number().optional(),
}).strict();

export const MetaDataSchema = z.object({
  LocalAssetID: z.string().optional(),
  BuildingName: z.string().optional(),
  BuildingPart: z.string().optional(),
  BuildingStreet: z.string().optional(),
  BuildingNumber: z.string().optional(),
  BuildingPostcode: z.string().optional(),
  BuildingCity: z.string().optional(),
  BuildingState: z.string().optional(),
  BuildingCountry: z.string().optional(),
}).strict();

// =============================================================================
// Root Schema (V0.9.2 — all fields optional for partial submissions)
// =============================================================================

export const KpiDataSchema = z.object({
  AssetID: z.string().optional(),
  MetaData: MetaDataSchema.optional(),
  Property_Related_Data: PropertyRelatedDataSchema.optional(),
  Energy_Performance: EnergyPerformanceSchema.optional(),
  Energy_Consumption: EnergyConsumptionSchema.optional(),
  Greenhouse_Gases: GreenhouseGasesSchema.optional(),
  Extended_Data: ExtendedDataSchema.optional(),
  Signature: SignatureSchema.optional(),
}).strict();

export type KpiData = z.infer<typeof KpiDataSchema>;

// =============================================================================
// V0.9.2 Section names (for iteration)
// =============================================================================

export const KPI_SECTIONS = [
  "Property_Related_Data",
  "Energy_Performance",
  "Energy_Consumption",
  "Greenhouse_Gases",
] as const;

export type KpiSectionName = (typeof KPI_SECTIONS)[number];
