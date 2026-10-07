# ADR-0004: Phase 1 proceeds without ward polygons

**Status:** accepted, pending product-owner confirmation · **Date:** 7 October 2026
**Phase:** 0 · **Spec:** 9.1, 19.3 · **Closes:** risk R1

## Context

The product's natural unit is a ward or settlement. The Rasuwa–Nuwakot–Dhading–
Chitwan corridor is described in the spec as a set of districts, but the profile
in 13.2 opens with "Ward 04 · Gosaikunda RM · Rasuwa", and spec 17 Phase 1
requires wards to render at zoom ≥ 9.

Phase 0 was asked to determine whether an authoritative ward-level dataset with an
acceptable licence can be obtained before any ingestion work begins.

## Findings

Full evidence, with URLs and retrieval dates, is in
[`docs/DATA_SOURCES.md`](../DATA_SOURCES.md). In summary:

**No ward-level polygon dataset for Nepal exists under a licence that permits
deploying it in an application.**

- **OCHA `cod-ab-npl`** (CC BY-IGO, the authoritative humanitarian source) has
  levels 1–3 only. OCHA publishes ADM4 for the Philippines (11,920 wards) and
  Uganda (1,520) but not Nepal. That is a signal about source availability, not an
  oversight.
- **geoBoundaries** returns HTTP 404 for Nepal ADM4. Its ADM2 is separately
  unusable: `boundaryYearRepresented: "2006"`, 75 units, sourced from Wikimedia
  Commons.
- **The Survey Department**, the authoritative publisher, states "© 2026 Survey
  Department. All rights reserved" and publishes boundary layers only to
  Gaun/Nagar Palika. It publishes no open licence and no ward polygons.
- **The only national ward file** —
  `SaugatPdl/nepal-administrative-boundary-shapefiles`, 6,803 wards — has **no
  licence**: no `LICENSE`, no SPDX, no copyright holder, no grant. It also ships a
  mislabelled CRS (`Nepal_MUTM_Central_84_Everest_1830`, a metre-based transverse
  Mercator on Everest 1830, while the README claims EPSG:4326), which is a silent
  50–200 m corruption trap, and has 23 duplicate `DDGNWW` keys.
- **OSM `admin_level=9`** is licence-clean under ODbL 1.0, but crowdsourced, and
  Nepal has **no published official ward code**, so a custom identifier would have
  to be invented.
- **HDX has no national ward product.** Of 83 Nepal datasets with shapefiles,
  `q=nepal+ward` returns 8; only one contains ward polygons, covering 31 of 77
  districts, from 2018, published by an inactive organisation, in RAR.

The denominators disagree as well: 753 local units officially, 775 in COD-AB, 777
in LocalBoundaries; ward counts range 6,743–6,803 against a constitutional
expectation of ~7,500. A ward-level feature set could not be complete by
construction, whatever the licence.

## Decision

Proceed at **province (7) → district (77) → municipality (753)**.

- **COD-AB (`cod-ab-npl`)** for P-codes and hierarchy, filtered from its 775
  admin3 units to the 753 local units by matching the OKN `Type_GN` vocabulary.
- **LocalBoundaries (CC BY 4.0)** for cleaner WGS84 local-unit geometry, joined to
  COD-AB for codes.
- **COD-EM** for edge-matched rendering.
- **Ward-level features marked unavailable in the UI, never fabricated.**

## Rationale

Spec 19.3 is unambiguous: if an authoritative ward dataset cannot be retrieved
with an acceptable licence, stop and report rather than generate placeholder
polygons. That instruction exists because invented ward boundaries are
indistinguishable from real ones once rendered, and would put fabricated
administrative geometry into a humanitarian product.

Municipality level is a real reduction in scope, not a workaround. The corridor
districts each contain several municipalities, so a location profile in Phase 2
will open at municipality granularity rather than ward. That is honest and
usable. A ward choropleth over invented polygons would be neither.

## Alternatives rejected

**Use the unlicensed 6,803-ward file.** Rejected. Absent a licence there is no
grant to redistribute, and shipping it inside an application reproduces a
copyrighted work without permission. The CRS mislabelling would additionally
corrupt geometry silently — the worst combination of properties a dataset can
have. Convenience does not enter into it.

**Use OSM wards for the whole country.** Rejected for now. Licence-clean, but
crowdsourced, unverifiable from the build network (Overpass returned HTTP 406),
built on an invented identifier, and based on a ward count that differs from
official figures by roughly 10%. Accepting that requires a deliberate product
decision, not a default.

**Hand-digitise corridor wards.** Rejected outright. Fabricated geography
(spec 3 principle 7, spec 9.1).

## Consequences

- **Phase 1's acceptance criterion changes.** Spec 17 requires wards at zoom ≥ 9.
  That is unachievable and the revised criterion is recorded in
  [`docs/PLAN.md`](../PLAN.md): 7/77/753 load from COD-AB, local units render at
  zoom ≥ 9 from LocalBoundaries, the P-code join is audited rather than assumed,
  and the UI states ward features are unavailable.
- **The schema is unaffected.** `admin_areas` already models levels 0–4 with
  `ward_number`, and all four hierarchy columns exist on `ops.locations`. When a
  licensed ward dataset arrives it loads as level 4 with no migration. This is
  why `admin_areas` was built as one self-referencing table rather than four.
- **`name_ne` is unresolved.** Neither source ships Devanagari. Search falls back
  to `name_en` until a source is found. Recorded in DATA_SOURCES.md.
- **A decision is needed from the product owner** on three options: confirm
  municipality-level Phase 1; pursue written permission from OKN or the Survey
  Department; or accept Bagmati-scoped OSM wards (~1,121 wards, 13 districts) as
  crowdsourced-but-ODbL with a custom documented identifier.

Bagmati-only OSM wards would cover the entire corridor. An imperfect dataset
scoped honestly and labelled as crowdsourced is defensible; an unlicensable one
used silently is not.

## Revisit when

- OKN or the Survey Department confirms the redistribution chain in writing.
- A licensed ward product appears on HDX or a government portal.
- The product owner decides ward granularity is a hard requirement.