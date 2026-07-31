# Dev Server — Quick Flow Test

---

## 1. Get Access Token

```
curl -X POST https://dev.coalition-x-exchange.com/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET"
  }'
```

> Copy the `access_token` from the response. Use it in place of `YOUR_TOKEN` in all requests below.

---

## 2. Create a Building

```
curl -X POST https://dev.coalition-x-exchange.com/api/assets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Dev Test Building",
    "address": "Teststraße 7, 10115 Berlin",
    "externalId": "EXT-DEV-001"
  }'
```

> Copy the `id` from the response. Use it in place of `YOUR_ASSET_ID` in all requests below.

---

## 3. Submit KPIs — FAIL (missing required fields)

```
curl -X POST https://dev.coalition-x-exchange.com/api/assets/YOUR_ASSET_ID/kpis \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "schema_version": "0.9.2",
    "kpis": {
      "Property_Related_Data": {
        "KPI_1_2_Building_Completion_Year": 2021,
        "KPI_3_1_Main_Use_Of_Building": "Wohnen"
      }
    }
  }'
```

> Expect: **400** error with a list of missing mandatory KPIs.

---

## 4. Submit KPIs — SUCCESS (version 1)

```
curl -X POST https://dev.coalition-x-exchange.com/api/assets/YOUR_ASSET_ID/kpis \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "schema_version": "0.9.2",
    "idempotency_key": "dev-init-001",
    "kpis": {
      "Property_Related_Data": {
        "KPI_1_2_Building_Completion_Year": 2021,
        "KPI_3_1_Main_Use_Of_Building": "Wohnen",
        "KPI_5_1_Usage_Area_ThermalyConditioned_Residential": 3500,
        "KPI_6_1_Object_Is_Taxonomy_Aligned": "YES_CM"
      },
      "Energy_Performance": {
        "KPI_7_7_EPC_Expiry_Date": "2031-12-01",
        "KPI_7_8_EPC_Type": "Bedarfsausweis"
      },
      "Energy_Consumption": {
        "KPI_8_1_EnergyCarriersForHeating": "Wärmepumpe"
      }
    }
  }'
```

> Expect: **201** with `"dataVersion": 1`. This means all KPIs were accepted.

---

## 5. Submit KPIs — SUCCESS (version 2, tests versioning)

```
curl -X POST https://dev.coalition-x-exchange.com/api/assets/YOUR_ASSET_ID/kpis \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "schema_version": "0.9.2",
    "idempotency_key": "dev-patch-001-v2",
    "kpis": {
      "Property_Related_Data": {
        "KPI_5_1_Usage_Area_ThermalyConditioned_Residential": 3800,
        "KPI_1_1_Date_Of_Building_Permit": "2020-06-10"
      }
    }
  }'
```

> Expect: **200** with `"dataVersion": 2`. Area changed from 3500 → 3800, old value stored in history.

---

## 6. Verify Final State

```
curl https://dev.coalition-x-exchange.com/api/assets/YOUR_ASSET_ID/kpis \
  -H "Authorization: Bearer YOUR_TOKEN"
```

> Expect: `dataVersion` is `2`, area KPI shows `3800` with `3500` in its history, and all KPIs from step 4 are still present.

---

## Alternative: Submit by External ID

Instead of using the internal `YOUR_ASSET_ID`, you can submit KPIs using your own external identifier. If the asset doesn't exist yet, it will be created automatically.

```
curl -X POST https://dev.coalition-x-exchange.com/api/assets/kpis \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "external_id": "EXT-DEV-001",
    "asset_name": "Dev Test Building",
    "asset_address": "Teststraße 7, 10115 Berlin",
    "schema_version": "0.9.2",
    "idempotency_key": "dev-ext-001",
    "kpis": {
      "Property_Related_Data": {
        "KPI_1_2_Building_Completion_Year": 2021,
        "KPI_3_1_Main_Use_Of_Building": "Wohnen",
        "KPI_5_1_Usage_Area_ThermalyConditioned_Residential": 3500,
        "KPI_6_1_Object_Is_Taxonomy_Aligned": "YES_CM"
      },
      "Energy_Performance": {
        "KPI_7_7_EPC_Expiry_Date": "2031-12-01",
        "KPI_7_8_EPC_Type": "Bedarfsausweis"
      },
      "Energy_Consumption": {
        "KPI_8_1_EnergyCarriersForHeating": "Wärmepumpe"
      }
    }
  }'
```

> This combines building creation + KPI submission in one call. Use `external_id` to reference the same asset in future submissions without needing the internal ID.

---

## Alternative: Lookup Asset by External ID

```
curl https://dev.coalition-x-exchange.com/api/assets/external/EXT-DEV-001 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

> Returns the asset details and its latest KPI data using your external identifier.
