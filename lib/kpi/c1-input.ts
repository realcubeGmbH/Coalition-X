import { z } from "zod";
import { EnergyClassSourceSchema } from "./schema";
import { KPI_REGISTRY } from "./registry";

const C1ScalarValue = z.union([z.string(), z.number(), z.boolean()]);

const C1ArrayValue = z.object({
  values: z.array(z.union([z.string(), z.number(), z.boolean()])),
  additional_information: z.string().optional(),
  reason_for_change: z.string().optional(),
});

const C1EnergyClassValue = z.object({
  value: z.string(),
  source: EnergyClassSourceSchema,
  reason_for_change: z.string().optional(),
});

/**
 * One row of the KPI 8-3 table. The 12 ZIA V0.9.2 fields are typed; the columns
 * of the agreed table (Jahr, Nutzung, Klima-/Leerstandsbereinigung, bereinigter
 * Verbrauch, Scope, per-row 9-x values) are accepted as-is and stored verbatim.
 *
 * `.passthrough()` is required — Zod strips unknown keys by default, which would
 * silently drop every column outside the V0.9.2 twelve.
 */
const C1EnergyDataItem = z
  .object({
    energy_carrier: z.string().optional(),
    total_value: z.number().optional(),
    heating: z.number().optional(),
    domestic_hot_water: z.number().optional(),
    cooling: z.number().optional(),
    lighting: z.number().optional(),
    ventilation: z.number().optional(),
    additional_electricity_demand: z.number().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    conversion_factor_primary_energy: z.number().optional(),
    values_based_on_inferior_heating_value: z.boolean().optional(),
  })
  .passthrough();

const C1EnergyTableValue = z.object({
  values: z.array(C1EnergyDataItem),
  additional_information: z.string().optional(),
  reason_for_change: z.string().optional(),
});

const C1Value = z.union([
  C1ScalarValue,
  C1ArrayValue,
  C1EnergyClassValue,
  C1EnergyTableValue,
]);

/**
 * KPIs whose value is a table of per-energy-carrier rows (today: 8-3), taken
 * from the registry so a new table KPI is covered automatically.
 */
const TABLE_SCHEMA_KEYS = new Set(
  Object.values(KPI_REGISTRY)
    .filter((def) => def.unit === "table")
    .map((def) => def.schemaKey),
);

/**
 * `C1Value` is a union that accepts a scalar for *any* key, so a table KPI sent
 * as a bare number (`"KPI_8_3_…": 102`) used to parse here and then be dropped
 * by the enricher — stored, signed and reported as an empty table with no error
 * anywhere. Reject those shapes at the input boundary instead, so the caller
 * gets a 400 naming the field.
 */
function checkTableShapes(
  section: Record<string, unknown> | undefined,
  sectionName: string,
  ctx: z.RefinementCtx,
): void {
  if (!section) return;
  for (const [key, value] of Object.entries(section)) {
    if (!TABLE_SCHEMA_KEYS.has(key)) continue;

    const rows =
      typeof value === "object" && value !== null && "values" in value
        ? (value as { values: unknown }).values
        : undefined;

    if (!Array.isArray(rows)) {
      ctx.addIssue({
        code: "custom",
        path: ["kpis", sectionName, key],
        message: `${key} is a table KPI and must be sent as { "values": [ { … } ] }, not a single value`,
      });
      continue;
    }

    const badRow = rows.findIndex(
      (row) => typeof row !== "object" || row === null || Array.isArray(row),
    );
    if (badRow !== -1) {
      ctx.addIssue({
        code: "custom",
        path: ["kpis", sectionName, key, "values", badRow],
        message: `${key} rows must be objects describing one energy carrier each`,
      });
    }
  }
}

const C1SectionSchema = z.record(z.string(), C1Value);

export const C1InputSchema = z
  .object({
    asset_id: z.string().optional(),
    external_id: z.string().optional(),
    schema_version: z.literal("0.9.2"),
    kpis: z.object({
      Property_Related_Data: C1SectionSchema.optional(),
      Energy_Performance: C1SectionSchema.optional(),
      Energy_Consumption: C1SectionSchema.optional(),
      Greenhouse_Gases: C1SectionSchema.optional(),
    }),
  })
  .superRefine((input, ctx) => {
    for (const [sectionName, section] of Object.entries(input.kpis)) {
      checkTableShapes(section, sectionName, ctx);
    }
  });

export type C1Input = z.infer<typeof C1InputSchema>;
export type C1ValueType = z.infer<typeof C1Value>;
export type C1EnergyDataItemType = z.infer<typeof C1EnergyDataItem>;
