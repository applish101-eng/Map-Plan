# Data sources

Every dataset this project ingests, with publisher, licence, retrieval date and
checksum. Spec 9.1 requires this file to be updated **before** ingestion, so that
a licence problem is found during review rather than after data is loaded.

Nothing in this file has been downloaded into the repository. Raw downloads go to
`data/raw/` (git-ignored) and processed output to `data/processed/`
(git-ignored). Only the demo seed under `data/demo/` is committed.

---

## Status summary

| Layer | Level | Source | Licence | Usable for production |
|---|---|---|---|---|
| Provinces | 1 | `cod-ab-npl` (OCHA FIS) | CC BY-IGO | Yes |
| Districts | 2 | `cod-ab-npl` (OCHA FIS) | CC BY-IGO | Yes |
| Municipalities | 3 | `cod-ab-npl` (OCHA FIS) | CC BY-IGO | Yes |
| Municipalities (geometry) | 3 | LocalBoundaries (Open Knowledge Nepal) | CC BY 4.0 | Yes |
| **Wards** | 4 | — | **none found** | **No** |

**Ward level is not available under an acceptable licence.** See
[Ward level: not feasible](#ward-level-not-feasible) below. This is risk R1 from
spec 20, and it is unresolved.

---

## Administrative boundaries

### Primary: OCHA COD-AB (`cod-ab-npl`) — levels 1 to 3

| Field | Value |
|---|---|
| Publisher | OCHA Field Information Services Section (FISS) |
| Dataset | Nepal - Subnational Administrative Boundaries, `cod-ab-npl`, version v02 |
| HDX page | <https://data.humdata.org/dataset/07db728a-4f0f-4e98-8eb0-8fa9df61f01c> |
| Shapefile | `…/resource/b6ab1a5a-8b6e-41fb-a61f-8202ce98d16c/download/npl_admin_boundaries.shp.zip` (53.7 MB) |
| GeoJSON | `…/resource/dea34e50-37d5-4e36-98ae-2b7b1b4c43de/download/npl_admin_boundaries.geojson.zip` (60.4 MB) |
| FileGDB | `…/resource/37775d96-2b6a-47b4-8465-2b3238368567/download/npl_admin_boundaries.gdb.zip` (26.3 MB) |
| Licence | **CC BY-IGO** |
| Attribution | "OCHA Field Information Services (FIS) / HDX — Nepal Subnational Administrative Boundaries (cod-ab-npl), v02, © OCHA, CC BY-IGO" |
| CRS | EPSG:4326 (geographic, WGS 84), UTF-8 |
| Levels | admin0 country, admin1 7 provinces, admin2 77 districts, admin3 775 units |
| Vintage | `valid_on = 2024-03-14`; reviewed for accuracy 30 October 2025 |
| Retrieved | 7 October 2026 |
| Verified | HTTP 200; shapefile header, DBF schema and all four layers parsed |

**Use this for codes and hierarchy.** It carries OCHA P-codes
(`NP` → `NP03` → `NP0320` → `NP0320301`), which are the correct join key for a
humanitarian GIS and the only stable identifier available at local-unit level.

**Caveats:**

- **775 admin3 units, not 753.** 22 are protected or special areas. Filter to the
  local-unit types (`Gaunpalika`, `Nagarpalika`, `Upamahanagarpalika`,
  `Mahanagarpalika`) before using the count for anything user-facing.
- **English names only.** The `*_name1/2/3` language fields are empty, so
  `name_ne` is **not** available from this source. Nepali place names must come
  from elsewhere — see [Devanagari names](#devanagari-names) below. This matters
  because search (spec 13.4) must handle Nepali names and the UI displays them.
- HDX's `license_url` for CC BY-IGO points at
  `http://creativecommons.org/licenses/by/3.0/igo/legalcode`, which **returns
  HTTP 404**. The attribution obligation still binds. Do not link that URL —
  attribute textually, as shown above.

#### Fetch

```bash
mkdir -p data/raw/codab && cd data/raw/codab

curl -L -o npl_admin_boundaries.shp.zip \
  "https://data.humdata.org/dataset/07db728a-4f0f-4e98-8eb0-8fa9df61f01c/resource/b6ab1a5a-8b6e-41fb-a61f-8202ce98d16c/download/npl_admin_boundaries.shp.zip"

# Record the checksum in this file before ingesting.
sha256sum npl_admin_boundaries.shp.zip

unzip -q npl_admin_boundaries.shp.zip

# Normalise each level to GeoPackage, forcing EPSG:4326 (AD-9).
for L in 1 2 3; do
  ogr2ogr -f GPKG codab.gpkg "npl_admin${L}.shp" \
    -nln adm${L} -t_srs EPSG:4326 -lco SPATIAL_INDEX=YES
done
```

### Secondary: LocalBoundaries (Open Knowledge Nepal) — level 3 geometry

| Field | Value |
|---|---|
| Publisher | Open Knowledge Nepal (OKN) |
| Catalogue | <https://localboundries.oknp.org/download/> |
| Local levels, national | <https://localboundries.oknp.org/data/local-level/nepal.geojson> (6.7 MB) / `.gpkg` |
| Local levels, Bagmati | <https://localboundries.oknp.org/data/local-level/bagmati.gpkg> (608 KB, 124 units) |
| Districts, national | <https://localboundries.oknp.org/data/district/nepal.geojson> (2.2 MB) |
| Provinces | <https://localboundries.oknp.org/data/province/nepal.geojson> (5.9 MB) |
| Repository | <https://github.com/openknowledgenp/localboundaries> |
| Licence | **CC BY 4.0** (data), MIT (repo code) |
| CRS | EPSG:4326 |
| Vintage | Grounded in the 2015 Constitution; republished 18 July 2025, repo updated 18 September 2026 |
| Retrieved / verified | 7 October 2026, HTTP 200 |

**Use this for cleaner local-unit geometry, joined to COD-AB for codes.**

**Caveats:**

- **No stable identifier.** Fields are `STATE_CODE` (ordinal 1–7), `DISTRICT`
  (uppercase *name*), `GaPa_NaPa` (*name*), `Type_GN`, `Province`. Join to
  `cod-ab-npl` on name, or spatially.
- **777 units, not 753** (753 local units + 24 protected areas). One name is
  misspelled "Wieldlife Reserve".
- Districts here are **dissolved from local-level boundaries** — the publisher
  states no separately attributed district source exists. Expect sliver
  artefacts. Prefer COD-AB `npl_admin2` for districts.
- Geometry is `Polygon`, not `MultiPolygon`, verified by inspection. Any genuinely
  multipart unit has been flattened upstream.
- Naming and casing differ from COD-AB, so a naive name join will miss rows.
  Do the crosswalk in PostGIS with upper-casing on both sides:

```sql
SELECT o.geom, c.adm3_pcode, c.adm2_pcode, c.adm1_pcode,
       c.adm3_name, c.adm2_name, c.adm1_name
FROM okn_locallevel o
LEFT JOIN codab_adm3 c
  ON upper(o."DISTRICT")   = upper(c.adm2_name)
 AND upper(o."GaPa_NaPa") = upper(c.adm3_name)
 AND o."STATE_CODE"::int   = substring(c.adm1_pcode from 4 for 2)::int;
-- Expect ~753 matches of 777. The 24 unmatched should be protected areas with
-- no COD-AB counterpart - verify that, do not assume it.
```

### Cartographic companion: COD-EM (`cod-em-npl`)

| Field | Value |
|---|---|
| HDX page | <https://data.humdata.org/dataset/f6c51ec8-3774-4d9e-b7a8-f492ced245d5> |
| Shapefile | `…/resource/583cd020-3746-4ec7-842c-38850a9d8a04/download/npl_adm_nd_20240314_em_shp.zip` (26.2 MB) |
| Licence | CC BY-IGO |

Edge-matched (topology-clean) boundaries sharing the same P-codes. HDX notes COD-EM
"may be preferred for cartographic purposes" and does not replace COD-AB. Use it
for rendering so district outlines share edges with no double-stroking, and COD-AB
for attributes.

### Devanagari names

Not resolved. Neither COD-AB nor LocalBoundaries ships Nepali names
(`name_ne` is required by the schema, spec 8.3, and by search, spec 13.4).

Candidate sources, none yet assessed: the Survey Department's own gazetteer,
Census 2021 ward-level tables, or manual capture for the corridor districts only.
Until resolved, `admin_areas.name_ne` stays null and the UI falls back to
`name_en`. Recorded as an open decision, not a solved problem.

---

## Ward level: not feasible

**Risk R1 from spec 20 is confirmed. Ward-level polygons cannot be obtained under
a licence that permits deploying them, so Phase 1 proceeds at municipality level
and ward features are marked unavailable rather than fabricated (spec 19.3).**

What was checked, and what each yielded:

| Candidate | Coverage | Licence | Verdict |
|---|---|---|---|
| OCHA `cod-ab-npl` | levels 1–3 | CC BY-IGO | No ward level. OCHA publishes ADM4 for the Philippines and Uganda but not Nepal — a signal about source availability, not an oversight. |
| geoBoundaries NPL ADM4 | — | — | **HTTP 404.** No ward level exists in geoBoundaries for Nepal. ADM2 is additionally unusable: `boundaryYearRepresented: "2006"`, 75 units, sourced from Wikimedia Commons. |
| Survey Department, National Geoportal | province → district → Gaun/Nagar Palika | **All rights reserved** | The authoritative publisher states verbatim "© 2026 Survey Department. All rights reserved." It does not publish ward polygons, and its pages are JavaScript-rendered so direct download endpoints may exist unverified. |
| OSM `admin_level=9` + `ward=*` | ~6,743 wards (Bagmati ~1,121) | **ODbL 1.0** | Licence-clean but crowdsourced. Coverage could not be verified from this network (Overpass returned HTTP 406). Nepal has **no published official ward code**, so a custom identifier would have to be invented. |
| `SaugatPdl/nepal-administrative-boundary-shapefiles` | 6,803 wards, all 7 provinces | **None — no licence file, no grant** | **Unusable.** See below. |
| HRRP "Administrative Boundaries of Nepal" (HDX) | wards, 31 of 77 districts | claimed CC0, publisher inactive | 2018 vintage, 31/77 districts ≈ 40% coverage, RAR format, internals unverified (no extractor available). Not a sole source. |
| MoFALD / ICIMOD | VDC level (pre-2017) | various | Wrong structural vintage. |
| `nepalboundariespy` (PyPI) | claims wards | MIT | **The ward data does not exist.** The wheel ships country/province/district/municipality only; `scripts/data_preparation_python.py` contains placeholder paths. `get_ward()` will fail. |

**HDX has no national ward-level product for Nepal.** Of 83 Nepal datasets with
shapefile resources, `package_search?q=nepal+ward` returns 8, and only one
contains actual ward polygons — the 31-district 2018 HRRP file.

### Why the largest ward file cannot be used

`SaugatPdl/nepal-administrative-boundary-shapefiles` looks like the obvious answer:
6,803 wards, all seven provinces, a CBS-style `DDGNWW` key. It is unusable for
three independent reasons, any one of which would be disqualifying:

1. **No licence.** No `LICENSE` file, no SPDX identifier, no copyright holder, no
   grant of any kind. GitHub's Terms of Service grant viewing and forking within
   GitHub, not redistribution. Under default copyright, all rights are reserved.
   The only relevant text is a disclaimer — "Provided for educational, research,
   and general mapping purposes… Not intended for legal or official boundary
   verification" — which is a restriction-flavored statement with no grant.
2. **Mislabelled CRS, a silent geometry-corruption trap.** The README claims
   "WGS 84 / EPSG 4326". The actual `.prj` declares
   `PROJCS["Nepal_MUTM_Central_84_Everest_1830"]` — a metre-based transverse
   Mercator on the **Everest 1830** datum, with no EPSG code and no transformation
   parameters published. Reprojecting naively yields 50–200 m of error. Nothing in
   the metadata would warn a user of this.
3. **Quality defects.** 23 duplicate `DDGNWW` keys; `DAN` empty in effectively
   every row; roughly 700 wards missing against a constitutional expectation of
   ~7,500. Geometry validity untested.

Note also that the same repository's municipality layer carries the Survey
Department schema and CRS, while its ward layer carries a different Everest-based
one. The two were not built by the same pipeline, despite being presented as one
product.

### The licence trap, stated precisely

Three claims get conflated when reasoning about derived boundary data:

**"It is derived from government open data."** For Nepal this premise is false.
The Survey Department publishes no open licence for its geospatial products and
states all rights reserved. Two things are commonly mistaken for permission: the
CBS/DoS district-code maps are freely *readable*, which is not the same as
redistributable; and the CC BY-SA 4.0 licence on Open Data Nepal was asserted by
OKN, not granted by the Survey Department, and nothing in the public record
establishes an unbroken permission chain.

**"The community asserts an open licence."** An assertion in a README is a
statement of belief, not a grant. And a community member cannot re-license
upstream rights: if the source were CC BY-SA, asserting MIT would breach §3(a) of
the upstream licence; if the source is all-rights-reserved, asserting MIT is
simply false because the uploader had nothing to grant.

**Derivative status.** Boundary *facts* are not copyrightable, but a specific
digital rendering of a boundary is. A community digitisation is therefore doubly
encumbered: the digitiser may own the tracing while remaining bound by upstream
terms for the source data. Exposure is the intersection, and it is narrower than
the tracing alone but wider than nothing.

**What would make ward data safe to deploy**, all four required:

1. An explicit licence — a `LICENSE` file with a named licence, ideally with SPDX.
   Avoid CC BY-SA and ODbL if the app bundles this data with other licensed
   content, since ShareAlike can reach a whole derived database. Avoid NC and ND.
2. A documented, unbroken provenance chain naming the actual upstream publisher.
3. That upstream being permissively licensed by the copyright holder. For Nepal
   this currently resolves to no.
4. Written confirmation from the publisher — `info@oknp.org` or the Survey
   Department — converting an ambiguous claim into a documented one.

### Recommended path

**Phase 1: province (7) → district (77) → municipality (753).** COD-AB for keys
and hierarchy, LocalBoundaries for cleaner local-unit geometry, COD-EM for
rendering. Ward features marked unavailable in the UI, never fabricated.

**Ward level as a conditional later phase**, requiring either:

- Written confirmation from OKN of the Survey Department redistribution chain for
  ward data, or an equivalent statement from the Survey Department; **plus**
- a properly licensed ward product, or
- explicit acceptance that OSM `admin_level=9` is crowdsourced-but-ODbL, scoped to
  **Bagmati only** (~1,121 wards, 13 districts), with a documented custom ward
  identifier.

Note the instability in the denominator itself: official local-unit counts are 753,
OCHA publishes 775, LocalBoundaries publishes 777, and ward totals range from
6,743 to 6,803 against a constitutional expectation of ~7,500. A ward-level
feature set could not be complete by construction.

---

## Other layers — not yet ingested

| Layer | Intended source | Status |
|---|---|---|
| Roads, tracks, bridges | OSM extract via Geofabrik Nepal | Not assessed. Attribution required: © OpenStreetMap contributors. |
| Rivers, waterways | OSM; HDX hydrography | Not assessed |
| Health facilities, schools | OSM; government listings | Not assessed |
| Flood hazard / hazard extent | Government, ICIMOD, satellite-derived | Not assessed. Store as `ops.hazard_areas`, situational and time-stamped (spec 9.2) |

---

## Extents

Read from the COD-AB shapefile headers (bytes 36–68 of each layer header) on
7 October 2026. Bagmati was cross-checked by unioning the bounding boxes of all
124 `adm1_pcode = 'NP03'` admin-3 polygons; the two agree to ~300 m.

| Extent | W | S | E | N |
|---|---|---|---|---|
| Nepal | 80.058467 | 26.347762 | 88.201550 | 30.447198 |
| Bagmati Province | 83.918656 | 26.919068 | 86.572645 | 28.386209 |

Do **not** derive extents from HDX preview tiles. Their northern bound is
30.167, about 0.3° short of the authoritative value, because the preview geometry
is simplified and clips the high Himalaya.

`packages/schemas/src/entities.ts` declares `nepalBbox` with a slightly wider
envelope (80.05, 26.35, 88.2, 30.45) on purpose: it is a sanity check to reject
impossible coordinates at import time (spec 14.3), not a boundary test. A point
inside the box but in the wrong district is caught later as a WARNING.

---

## Checksums

Record here on download, before ingestion.

| File | SHA-256 | Retrieved |
|---|---|---|
| `npl_admin_boundaries.shp.zip` | _not yet downloaded_ | — |
| `cod-em-npl` edge-matched shapefile | _not yet downloaded_ | — |
| LocalBoundaries local-level GeoPackage | _not yet downloaded_ | — |