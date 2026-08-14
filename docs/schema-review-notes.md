# Schema Review Notes

Observations and open questions about the database schema. Each item needs a decision: **keep**, **change**, or **remove**.

---

## Open Items

### 1. `userRole` on `accredited_partners` is a free-form string

- **Table:** `accredited_partners`
- **Field:** `userRole` (type: `String`)
- **Issue:** This field stores whatever POM+ sends in the `user_role` payload field. It's not validated against any enum and has inconsistent values in DEV: `ORG_REPRESENTATIVE`, `admin`, `string`. It is never used in any business logic -- the actual role assigned to the created user is always hardcoded to `PARTNER_ADMIN`.
- **Options:**
  - [ ] Add an enum and validate on ingest (reject or normalize bad values)
  - [ ] Make the field optional since it's purely informational
  - [ ] Remove it entirely -- it serves no functional purpose
  - [ ] Keep as-is (audit/provenance only)

---

*Add new items below as they come up.*
