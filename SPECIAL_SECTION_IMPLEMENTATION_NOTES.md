# Special Section Implementation Notes

## Implemented boundary

The production catalogue remains unchanged at 368 records. Special sections use a versioned discriminated `sectionDefinition` and never add rows to `backend/data/sections-database.js`.

Supported definition sources:

- `catalogue`: existing family/name selection;
- `stiff_plate`: explicit plate geometry or a verified external component reference;
- `welded`: explicit plate geometry;
- `custom`: retained legacy UI path.

The externally researched data boundary is `backend/data/verified-special-sections.json`. It is intentionally empty. The adapter rejects unverified data, duplicate IDs, unsupported units, physically inconsistent mass/area values, missing source metadata and invalid geometry.

## Geometry-derived subtypes

The following subtypes use explicit non-overlapping rectangular plates:

- Plate + Flatbar;
- Plate + T-girder;
- Plate + L-welded;
- I - single symmetric;
- I - double symmetric;
- Box - non-symmetric flanges;
- Box - double symmetric;
- T section - axial loading only.

The composite-area engine calculates gross area, steel mass at 7850 kg/m3, exposed perimeter/surface, centroid, Iy, Iz, top/bottom/left/right elastic moduli, plastic neutral axes, Wpl,y, Wpl,z, bounds and component coordinates. Positive-area plate overlap is rejected. Shared edges are removed from exposed perimeter.

## Data-required subtypes

- Plate + Bulb Flat requires a verified `bulb_flat` record and a verified composite placement rule.
- Plate + rolled L requires a verified `rolled_angle` record and a verified composite placement rule.
- Both HSQ variants require their authoritative component layout and dimension mapping.

No substitute or nearest designation is selected.

## Intentionally incomplete engineering checks

The following are not estimated for geometry-derived special sections:

- Avy / Avz;
- It / Iw;
- shear centre;
- Class 4 effective properties;
- component-based EC3 classification and family-specific modulus selection;
- high-shear reduction applicability;
- LTB and member-buckling family mapping;
- flange-loading distribution, Class 3 web upgrade and box weld/buckling-curve rules.

The solver may use derived Iy/Iz for analysis diagrams, but dependent resistance checks are `NOT AVAILABLE` and the overall result is `INCOMPLETE`. Gross reference moduli are reported as geometry, not as verified design resistance.

The welded T subtype rejects self-weight, UDL, transverse point loads, moments and transverse member end actions. It does not silently discard them.

## Persistence and reports

Saved browser projects use schema version 5 and requests use version 3. Older files without `sectionDefinition` migrate to `catalogue`. Special projects preserve subtype, explicit dimensions, settings and external record IDs. If an external ID is unavailable later, the ID remains in state and the UI returns `DATA REQUIRED`.

HTML, LaTeX and compiled hand-calculation output include source status, subtype, external record ID, component coordinates, geometry-derived properties and all unavailable/incomplete reasons.
