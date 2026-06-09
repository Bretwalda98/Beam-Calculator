# Beam Calculator Engineering Review

Review date: 2026-06-09

## Scope

This review covers:

- responsive desktop/mobile layout and dark-theme behavior;
- section-property database integrity;
- lateral torsional buckling (LTB) property use and calculation flow;
- Eurocode section-class selection;
- custom-section property generation;
- chart result presentation.

It is a software and calculation-method review, not independent certification of a project design.

## Section Database

- Rows checked: **368**
- Families checked: **14**
- Rows with non-negative numerical `Iz_mm4`, `It_mm4`, and `Iw_mm6`: **368**
- Rows carrying published-source verification metadata: **368**
- Rows missing a source name or source URL: **0**
- Database LTB values still marked unresolved: **0**

### Family Sources

| Families | Primary source |
|---|---|
| IPE, HEAA, HEA, HEB, HEM, UPE, UPN, J | ArcelorMittal Sections and Merchant Bars Sales Programme |
| UB, UC, UBP, PFC | British Steel published section datasheets |
| RHS and UK fallback designations | Steel for Life Blue Book |
| CH and legacy J fallback designations | ArcelorMittal published legacy catalogue |

The detailed designation-level source decisions and unit conversions remain recorded in `ltb_source_audit.md`.

### Unit Checks

- `Iz` and `It` are stored in `mm^4`.
- `Iw` is stored in `mm^6`.
- ArcelorMittal `cm^4` values use a `10^4` conversion.
- ArcelorMittal `10^3 cm^6` values use a `10^9` conversion.
- British Steel / Blue Book `dm^6` values use a `10^12` conversion.
- The calculation engine consumes the stored values directly without a second conversion.

Spot checks included IPE 200, HE 200 A, UB 406x178x60, PFC 200x75x23 and RHS 100x100x5. The stored values and metadata are consistent with the named published tables and documented conversions.

## LTB Review

### Corrections Implemented

- Removed the previous percentage-based load-height adjustment.
- Implemented the NCCI SN003 elastic critical moment form using `C1`, `C2`, `zg`, `Iz`, `It`, `Iw`, `k`, and `kw`.
- Stopped applying `kc` as an additional effective-length multiplier.
- Separated the EN 1993-1-1 clause 6.3.2.2 general reduction method from the clause 6.3.2.3 rolled/welded I-section modification.
- Added the appropriate `lambdaLT,0`, `beta`, imperfection curves, `f` modification, and reduction-factor limits for the rolled/welded method.
- Uses published NCCI `C1` and `C2` values for supported simply-supported and fixed-ended UDL/central-point-load cases.
- Uses conservative `C1 = 1`, `C2 = 0`, and `kc = 1` when the active support/load pattern is outside the tabulated cases.
- Warns when `k < 1.0`, because this requires restraint justification.
- Shows the LTB model, curve, segment length, effective length, `C1`, `C2`, `zg`, `Mcr`, slenderness and reduction factor in the results.

### Deliberate Limits

- Automatic LTB is disabled for UPE, UPN, PFC, CH, custom channels, tees and angles. These monosymmetric sections require `C3`, shear-centre and load-height data not stored in the current model. Returning “unavailable” is safer than producing a misleading result.
- Continuous-beam LTB currently divides the full beam into equal unrestrained segments from the entered restraint count. Actual restraint positions and each governing moment segment must be checked for final design.
- The app does not model restraint stiffness, fork conditions, destabilising load attachment details, or torsional restraint springs.
- Custom open-section warping constants remain geometry-derived estimates and are clearly marked as such.

## Section Class

The interface now explains EN 1993-1-1 clause 5.5 and Table 5.2:

- Classes 1–2 use plastic resistance where the plate-element limits are satisfied.
- Class 3 uses elastic resistance.
- Class 4 requires effective section properties.

The app does **not** automatically classify every flange/web plate element. The selected class must still be established for the governing stress distribution. Where `Weff` is unavailable, the app displays a fallback warning instead of silently treating elastic properties as verified effective properties.

## Custom Sections

- Added a live graphical cross-section preview.
- Retained the equal-thickness RHS/box template.
- Added a box template with independent top, bottom, left and right wall thicknesses.
- Asymmetric box centroid, `Iy`, `Iz`, elastic/plastic moduli and area are calculated from non-overlapping component rectangles.
- Closed-box `It` uses the Bredt–Batho thin-walled single-cell expression.
- Closed box and CHS custom templates store `Iw = 0` for the idealised closed section.
- Sharp corners are assumed; proprietary hollow-section properties should use manufacturer tables for final design.

## UI and Reporting

- Collapsing the left input panel now releases its full width to the workspace.
- The centre/results workspace stacks before charts become excessively narrow.
- Desktop, zoomed-window and mobile breakpoints are container-aware.
- Mobile tabs scroll horizontally and modals become full-screen sheets.
- Help, Report and LaTeX views now follow the active light/dark theme.
- Shear, moment and deflection charts now show the maximum absolute value and its `x` and `x/L` location.

## Remaining Recommended Work

1. Add automatic EN 1993-1-1 Table 5.2 plate-element classification.
2. Add published effective properties for Class 4 sections or a full effective-width calculation.
3. Add a segment-by-segment continuous-beam LTB restraint editor.
4. Add monosymmetric `C3`, shear-centre and load-height properties for channel-family LTB.
5. Replace the current support/web-stiffener screening check with a complete project-specific EN 1993-1-5 implementation where required.
6. Add benchmark regression cases against independent worked examples before using the calculator as a final design authority.

## References

- EN 1993-1-1, clauses 5.5, 6.2.5, 6.2.6, 6.3.2.2 and 6.3.2.3.
- NCCI SN003a-EN-EU, *Elastic critical moment for lateral torsional buckling*: https://eurocodes.jrc.ec.europa.eu/sites/default/files/2022-06/SN003a-EN-EU.pdf
- Steel for Life Blue Book explanatory notes: https://www.steelforlifebluebook.co.uk/
- ArcelorMittal Sections and Merchant Bars: https://sections.arcelormittal.com/
- British Steel sections datasheets: https://britishsteel.co.uk/what-we-do/construction-steel/sections/
