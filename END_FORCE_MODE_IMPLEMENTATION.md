# Member End-Force Mode

## Scope

Member end-force mode accepts final single-member design actions. It bypasses the applied-load solver and all G/Q load-combination factors. End 1 is the left end at `x = 0`; End 2 is the right end at `x = L`. Signed End 2 values are not reversed.

Internal units are kN, kN m, m and mm. Display-unit conversion is performed at the UI and report boundaries.

## Action profiles

For `t = x / L`:

- `N(x) = N`
- `My(x) = My1 + (My2 - My1)t`
- `Mz(x) = Mz1 + (Mz2 - Mz1)t`
- `Vz(x) = Vz1 + (Vz2 - Vz1)t`
- `Vy(x) = Vy1 + (Vy2 - Vy1)t`

Resistance checks use the maximum absolute demand and retain the signed action and governing end/location for reporting.

## Reused verified resistance methods

The mode reuses the existing backend methods and source comments for:

- Axial tension/compression resistance: EN 1993-1-1 6.2.3/6.2.4.
- Major- and minor-axis bending resistance: EN 1993-1-1 6.2.5 with class-dependent `Wpl`, `Wel` or `Weff`.
- Major-axis high-shear reduction where the existing I-section geometry implementation is verified: EN 1993-1-1 6.2.8.
- Shear resistance about local z and y: EN 1993-1-1 6.2.6 using stored `Avz`/`Avy` and the configured eta.
- Existing conservative cross-section interaction: `|NEd|/NRd + |My,Ed|/My,Rd + |Mz,Ed|/Mz,Rd` in the EN 1993-1-1 6.2.9 design context.
- Existing major-axis LTB term only: EN 1993-1-1 6.3.2.

No new member-buckling interaction coefficients are inferred. Compression with active `Mz` is marked `INCOMPLETE` until a documented and tested biaxial member-buckling method is implemented.

Deflection and calculated support reactions are not produced in this mode. Entered end shears are never labelled as reactions.

## Section-property provenance

The complete 368-row section-property artifact records field-level status, source field and derivation. All current families have non-zero `Wel,z`, `Wpl,z`, `Weff,z` and `Avy` values. Derived values remain explicitly marked `derived_from_same_source_geometry` and are not described as published table values.

Families currently covered: IPE, HEA, HEB, HEM, HEAA, UB, UC, UBP, J, PFC, CH, UPE, UPN and RHS.

For IPE/HE/UPE/UPN rows, some z-axis moduli are geometry-derived. For UB/UC/UBP/J/PFC/CH and RHS rows, z-axis moduli are predominantly existing table values. `Avy` is geometry-derived for all current rows. If a required property or provenance record is unavailable in a future dataset, the active check must be `NOT AVAILABLE` and the overall result `INCOMPLETE`.
