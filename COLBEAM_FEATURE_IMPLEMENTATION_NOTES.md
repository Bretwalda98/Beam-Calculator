# COLBEAM EC3 Audit Settings - Stage 1

Stage 1 adds COLBEAM-style calculation setup fields to the calculation request/state path only. It does not change formulas, solver behaviour, load-combination selection, code-check equations, or result values.

## Fields Added

Input-tab related fields:
- `loads.udls[].direction`: `Y` or `Z`, default `Z`.
- `loads.points[].direction`: `Y` or `Z`, default `Z`; used for point and moment load records.
- `axial.signConvention`: default `positive_compression`.
- `combination.customULSFactors`: `{ G, Q1, Q2 }`, default `{ 1.35, 1.5, 1.5 }`.
- `combination.customSLSFactors`: `{ G, Q1, Q2 }`, default `{ 1, 1, 0.7 }`.
- `combination.perCheckEnvelope`: default `false`.
- `combination.slsDeflectionBasis`: `total`, `imposed-only`, or `variable-only`; default `total`.
- `combination.slsIncludeSelfWeight`: default `true`.
- `model.colbeamSupportMappingLabel`: default `Current support mapping`.
- `model.supportEquivalenceNote`: default note that COLBEAM support equivalence is not independently verified.

Setup-tab related fields:
- `settings.colbeamAudit.materialVariantLabel`.
- `settings.colbeamAudit.nationalAnnexLabel`.
- `settings.colbeamAudit.coefficientSource`.
- `settings.colbeamAudit.autoSectionClassificationStatus`.
- `settings.colbeamAudit.class4EffectivePropertiesMode`.
- `settings.colbeamAudit.shearFactorEta`.
- `settings.colbeamAudit.class12ElasticDesign`.
- `settings.colbeamAudit.conservativeNMyMz`.
- `settings.colbeamAudit.flangeBucklingIgnored`.
- `settings.colbeamAudit.webBucklingIgnored`.
- `settings.colbeamAudit.ltbC3`.
- `settings.colbeamAudit.ltbKw`.
- `settings.colbeamAudit.ltbLoadHeight`.
- `settings.colbeamAudit.ltbShearCentreConvention`.
- `settings.colbeamAudit.ltbRestraintModel`.
- `settings.colbeamAudit.ltbMomentGradientMethod`.
- `settings.colbeamAudit.lambdaLT0`.
- `settings.colbeamAudit.beta`.
- `settings.colbeamAudit.memberBucklingInteractionMethod`.
- `settings.colbeamAudit.colbeamInteractionMethodLabel`.
- `settings.colbeamAudit.supportBearingModel`.
- `settings.colbeamAudit.webBearingModel`.
- `settings.colbeamAudit.stiffenerModel`.
- `settings.colbeamAudit.modalAnalysisStatus`.

The backend also accepts `settings.audit` as a compatibility alias and normalises it to the same calculation package shape.

## Fields Reused Because Already Existing

- `settings.gammaM0`.
- `settings.gammaM1`.
- `settings.sectionClass`.
- `model.includeSelfWeight`.
- `combination.combination`.
- `combination.psiQ1`.
- `combination.psiQ2`.
- `settings.deflectionLimit`.
- `settings.enableLTB`.
- `settings.ltbK`.
- `settings.ltbC1`.
- `settings.ltbC2`.
- `settings.ltbModel`.
- `settings.ltbLoadLevel`.
- `settings.bucklingKy`.
- `settings.bucklingKz`.
- `settings.bucklingCurveY`.
- `settings.bucklingCurveZ`.
- `model.springLeftPct`.
- `model.springRightPct`.
- `settings.endPostType`.
- `settings.webStiffener`.
- `settings.stiffenerA`.

## Metadata-Only Fields

All newly added COLBEAM audit fields are metadata-only in Stage 1. They are normalised, validated, echoed in `inputEcho.colbeamAudit`, preserved in `calculationPackage.colbeamAudit`, and warning-listed in `calculationPackage.warnings`.

The following are specifically not engine-wired yet:
- Per-check EN 1990 6.10a/6.10b envelope.
- Custom ULS/SLS factors.
- SLS deflection basis and SLS self-weight switch.
- Load direction Y/Z.
- LTB `C3`, `kw`, load height, shear-centre convention, restraint model, moment-gradient method, `lambdaLT0`, and `beta`.
- Auto section classification status.
- Class 4 effective-property mode.
- Class 1-2 elastic design toggle.
- Conservative `N + My + Mz` toggle.
- Flange/web buckling ignored toggles.
- Member-buckling interaction method and COLBEAM interaction label.
- Support bearing, web bearing, and stiffener models.
- Modal analysis status.

## Files Changed

- `backend/services/colbeam-audit-settings.js`: shared defaults and normalisation.
- `backend/services/validation-service.js`: validates new ranges/enums and keeps old requests compatible.
- `backend/services/calculation-service.js`: preserves new fields in load normalisation, `inputEcho`, `loads`, and `calculationPackage`.
- `public/secure-app.js`: adds hidden request-state defaults with no UI redesign.
- `public/app.js`: aligns the legacy/simple frontend request path with the same Stage 1 defaults.
- `backend/tests/colbeam-audit-settings.js`: verifies old requests, new requests, preservation, warnings, and invalid direction rejection.
- `package.json`: includes the new test in `npm run smoke`.

## Compatibility Handling

Old saved projects and old API requests still work because every new field has a safe backend default. Missing nested objects are normalised on the backend before calculation packaging.

Both frontend request builders now emit Stage 1 defaults for newly saved/recalculated projects, but existing projects do not need migration to calculate.

`server.js` and `src/worker.mjs` continue to pass through the same validated request path. No endpoint-specific formula or state logic was added there; the shared validator and calculation service handle the new fields for both Node and Cloudflare Worker deployments.

## Tests Added/Updated

- Added `backend/tests/colbeam-audit-settings.js`.
- Updated `npm run smoke` to run the new test before existing audit fixtures.
- Existing calculation audit fixtures remain unchanged because Stage 1 must not alter numerical output.

## Important Limitation

Stage 1 does not claim COLBEAM EC3 parity. It only prepares the request/state/output structure for later engine work.

# COLBEAM EC3 Visible Controls - Stage 2

Stage 2 adds visible controls for the Stage 1 fields inside the existing calculation workflow. No formulas, solver behaviour, result values, or backend design checks were changed.

## Input Tab Controls Added

- Load-card direction selector for UDL, point, moment and trapezoidal loads: `Y / Z`.
- Axial sign convention selector: `positive_compression` or `positive_tension`.
- Custom ULS factors: `G`, `Q1`, `Q2`.
- Custom SLS factors: `G`, `Q1`, `Q2`.
- Per-check EN 1990 6.10a/6.10b envelope toggle.
- Active custom combination formula display.
- COLBEAM support mapping label.
- Support equivalence note.
- Spring restraint equivalence note.
- SLS deflection basis: `total`, `imposed-only`, `variable-only`.
- SLS self-weight included/excluded toggle.

## Setup Tab / Setup Area Controls Added

The current UI uses setup accordions rather than a separate tab. Controls were placed in the existing setup areas:

- Section selection:
  - Material variant label: `N/NL`, `M/ML`, `H`, other/unknown.
  - National Annex label.
  - Coefficient source.
  - Automatic section classification status.
  - Class 4 effective-property mode/status.
  - Shear factor eta.
  - Class 1-2 elastic design toggle.
  - Conservative `N + My + Mz` toggle.
  - Flange buckling not taken into account toggle.
  - Web buckling not taken into account toggle.
- Stability / LTB:
  - LTB `C1` and `C2` exposed where previously only defaulted through state.
  - LTB `C3`.
  - LTB `kw`.
  - COLBEAM load height.
  - LTB shear-centre/eccentricity convention.
  - LTB restraint model.
  - LTB moment-gradient method.
  - `lambdaLT,0`.
  - `beta`.
- Loads / member buckling block:
  - Member buckling interaction method.
  - COLBEAM interaction method label.
- Supports / stiffeners:
  - Support bearing model.
  - Web bearing model.
  - Stiffener model.
  - Modal analysis status.

## Existing Controls Reused

- `gammaM0`.
- `gammaM1`.
- Section class.
- Self-weight checkbox.
- Normal load-combination selector.
- `psiQ1` / `psiQ2`.
- Deflection limit.
- LTB on/off.
- LTB `k`.
- Lateral restraint points.
- LTB model/load level.
- `Ky` / `Kz`.
- Buckling curves `Y` / `Z`.
- Spring left/right percentage controls.
- End post, web stiffener and stiffener spacing inputs.

## Metadata-Only Controls

All newly visible COLBEAM controls remain metadata-only in Stage 2, except the existing reused controls that were already engine-wired before this work. The UI labels these controls with visible metadata-only warnings.

## Engine-Wired Controls

The following reused controls remain engine-wired:

- `gammaM0`, `gammaM1`.
- Section class.
- Deflection limit.
- Self-weight.
- Load combination and psi factors.
- LTB enable, `k`, `C1`, `C2`, model/load level.
- `Ky`, `Kz`, buckling curves.
- Spring support percentages.
- Existing end support/stiffener flags.

## Stage 2 Files Changed

- `index.html`: visible controls and metadata-only notes.
- `public/secure-app.js`: request wiring, saved-project loading and custom formula preview.
- `backend/tests/colbeam-ui-controls.js`: static UI/request wiring coverage.
- `package.json`: includes the UI test in check/smoke.
- `COLBEAM_FEATURE_IMPLEMENTATION_NOTES.md`: Stage 2 documentation.

## Stage 2 Tests Added/Updated

- Added `backend/tests/colbeam-ui-controls.js`.
- Updated `npm run check` to syntax-check the UI test.
- Updated `npm run smoke` to verify visible controls remain present and wired.

## Stage 2 Limitation

The new controls intentionally do not change calculations yet. They prepare the UI and request payload for later COLBEAM parity work.

# COLBEAM Audit Output Panel - Stage 3

Stage 3 adds a visible `COLBEAM Audit Output` panel near the existing locked code-check output. It is a display/export layer only and does not change formulas, solver behaviour, load combinations, or numerical results.

## Panel Added

- Location: locked code-checks dock beneath the existing `Code checks` output.
- Panel title: `COLBEAM Audit Output`.
- Export actions:
  - `Copy audit JSON`.
  - `Download audit JSON`.

## Values Displayed

- General audit info:
  - Engine/profile.
  - COLBEAM comparison reference.
  - National Annex label.
  - Coefficient source.
  - Engine version.
  - Metadata-only/backend warnings.
- Section/material:
  - Section family and designation.
  - Steel grade and material variant.
  - Section class.
  - Auto-classification status.
  - Class 4 effective-property mode/status.
- Geometry/support:
  - Span.
  - Support type.
  - COLBEAM support mapping and equivalence notes.
  - Spring left/right percentages.
  - End support assumptions.
  - Support bearing, web bearing and stiffener models.
- Loads/actions:
  - UDL, point, moment and trapezoidal load records with Y/Z direction.
  - Axial load and sign convention.
  - Self-weight on/off.
  - Available design actions.
- Load combinations:
  - Combination type / EN 1990 mode.
  - Custom ULS/SLS factors.
  - psi factors.
  - Per-check envelope flag.
  - Active ULS/SLS formula strings returned by the backend.
- Deflection:
  - Deflection enabled status.
  - Limit and current calculated deflection.
  - SLS deflection basis and self-weight flag.
- EC3 factors:
  - gammaM0 and gammaM1 as engine-wired.
  - shear factor eta as metadata-only.
- Buckling/LTB:
  - Ky/Kz and buckling curves.
  - LTB enabled/k/C1/C2 plus Stage 2 metadata fields C3, kw, load height, eccentricity convention, restraint model, moment-gradient method, lambdaLT,0 and beta.
  - Available backend LTB check values.
- Interaction/section control:
  - Member interaction method and COLBEAM label.
  - Class 1-2 elastic design toggle.
  - Conservative N + My + Mz toggle.
  - Flange/web buckling ignored toggles.
  - Modal analysis status.
- Resistances/checks:
  - Available NRd/MyRd/VzRd and unavailable axis values.
  - Buckling/LTB resistance strings where returned by calculation package.
  - Utilisation ratios.
  - Formula/check objects exported in JSON.

## Values Unavailable

The current backend does not provide `MzEd`, `VyEd`, `MzRd` or `VyRd`. These are shown as `Not available` and are not inferred in the frontend.

## Metadata-Only Warnings Shown

The panel displays backend `calculationPackage.warnings`, including Stage 1/2 metadata-only warnings such as:

- COLBEAM audit fields are recorded only.
- Per-check envelope/custom factors/SLS basis are not engine-wired yet.
- LTB C3/kw/load-height/restraint-model settings are not engine-wired yet.
- Member interaction, auto classification, support/web/stiffener models and modal analysis are not engine-wired yet.

## Stage 3 Files Changed

- `index.html`: audit output panel and export buttons.
- `public/secure-app.js`: audit payload builder, renderer and JSON export.
- `backend/tests/colbeam-ui-controls.js`: static coverage for panel and export hooks.
- `COLBEAM_FEATURE_IMPLEMENTATION_NOTES.md`: Stage 3 documentation.

## Stage 3 Tests Added/Updated

- Existing UI control test now verifies the audit panel exists and the frontend includes `buildColbeamAuditPayload`, `renderColbeamAudit`, and JSON download wiring.

## Stage 3 Limitation

The audit output is intentionally verbose and diagnostic. It uses returned backend values and request payload values only; it does not calculate missing engineering values in the frontend.

# COLBEAM Custom Combination Wiring - Stage 4

Stage 4 wires only the safest engine-affecting COLBEAM audit settings. It does not change LTB formulas, member buckling interaction formulas, Y/Z load-direction behaviour, section classification, Class 4 effective properties, support stiffness behaviour, or COLBEAM Method 1/2 logic.

## Engine-Wired In Stage 4

- `combination.combination = custom_colbeam` now activates the custom/COLBEAM audit combination mode.
- In `custom_colbeam` mode, these factors affect ULS analysis and design actions:
  - `combination.customULSFactors.G`
  - `combination.customULSFactors.Q1`
  - `combination.customULSFactors.Q2`
- In `custom_colbeam` mode, these factors affect SLS analysis and deflection:
  - `combination.customSLSFactors.G`
  - `combination.customSLSFactors.Q1`
  - `combination.customSLSFactors.Q2`
- `combination.slsDeflectionBasis` now affects the SLS deflection analysis:
  - `total`: uses the active SLS combination.
  - `imposed-only`: uses Q1 only and excludes permanent/self-weight contribution.
  - `variable-only`: uses Q1 plus Q2 and excludes permanent/self-weight contribution.
- `combination.slsIncludeSelfWeight` now affects total-basis SLS deflection by excluding generated section self-weight when set to `false`.

## Preserved Behaviour

- Existing EN 1990 modes (`basic`, `en1990_610`, `en1990_610a`, `en1990_610b`, `en1990_610ab`) ignore custom ULS/SLS factors, so default and existing saved-project results remain unchanged unless the user explicitly selects `Custom / COLBEAM audit factors`.
- The existing EN 1990 6.10a/6.10b ULS envelope behaviour remains unchanged. It still selects one governing ULS response by peak moment.
- Existing audit fixtures still pass unchanged.

## Still Metadata-Only

- Per-check/per-effect EN 1990 6.10a/6.10b envelope selection remains metadata-only. The backend now reports `perCheckEnvelopeEngineWired: false` and warns that this is not yet engine-wired.
- Y/Z load direction is still recorded only.
- LTB `C3`, `kw`, load height, shear-centre/eccentricity convention, restraint model, moment-gradient method, `lambdaLT,0`, and `beta` remain metadata-only.
- Member-buckling interaction method and COLBEAM interaction method label remain metadata-only.
- Auto section classification status and Class 4 effective-property mode remain metadata-only.
- Support bearing, web bearing, stiffener model, and modal analysis status remain metadata-only.

## Audit Output Changes

The COLBEAM Audit Output now shows:

- Custom ULS/SLS factors configured by the user.
- ULS/SLS factors actually used by the backend.
- Active ULS formula.
- Active SLS formula.
- Governing combination/effect text where available.
- SLS deflection basis used.
- Whether self-weight was included in the SLS deflection analysis.
- Explicit `perCheckEnvelopeEngineWired` status.

## Stage 4 Files Changed

- `backend/services/calculation-service.js`: custom combination mode, SLS deflection basis handling, SLS self-weight exclusion, calculation-package notes, and backend echo of used factors.
- `backend/services/colbeam-audit-settings.js`: warning text updated to reflect Stage 4 wiring.
- `public/secure-app.js`: custom combination preview and audit-output rows for configured versus used factors.
- `index.html`: `Custom / COLBEAM audit factors` option in the existing load-combination selector.
- `backend/tests/colbeam-stage4-engine.js`: engine behaviour tests for custom factors, SLS basis, self-weight exclusion, and metadata-only per-check envelope.
- `backend/tests/colbeam-audit-settings.js`: warning expectations updated for Stage 4.
- `package.json`: Stage 4 test included in `check` and `smoke`.
- `COLBEAM_FEATURE_IMPLEMENTATION_NOTES.md`: Stage 4 documentation.

## Stage 4 Tests Added/Updated

- Old EN 1990 requests with custom factors still return unchanged ULS moments and SLS deflections.
- `custom_colbeam` ULS factors change design actions.
- `custom_colbeam` SLS factors change service deflection.
- SLS self-weight inclusion/exclusion changes deflection when self-weight is the active SLS load.
- `total`, `variable-only`, and `imposed-only` deflection bases produce distinct expected deflection levels.
- Per-check envelope remains metadata-only and reports `perCheckEnvelopeEngineWired: false`.

## Example Stage 4 Smoke Values

- Default EN 1990 baseline max moment: `53.8209`.
- Custom ULS factor max moment: `84.73467`.
- Total SLS deflection: `17.88004`.
- Variable-only SLS deflection: `12.62382`.
- Imposed-only SLS deflection: `6.52956`.

# COLBEAM Y/Z Load Direction Wiring - Stage 5

Stage 5 wires only safe Y/Z action mapping. It does not change LTB formulas, member buckling Method 1/2, Class 4 effective properties, support stiffness behaviour, or per-check EN 1990 6.10a/6.10b envelope selection.

## Engine-Wired In Stage 5

- Missing/legacy load direction defaults to `Y` to preserve existing calculations and old saved projects.
- Explicit `Y` loads are analysed through the existing major-axis beam engine.
- Explicit `Z` loads are separated into a minor-axis beam analysis when `Iz` is available.
- Mixed `Y` and `Z` loads keep separate action outputs:
  - `MyEd`
  - `MzEd`
  - `VyEd`
  - `VzEd`
- The backend reports separate axis resistances and utilisation values in `actions.axis`.
- Minor-axis bending check is available only when the section row has usable z-axis modulus data.

## Section Properties Used

Major-axis:
- `Iy_mm4`
- `Wel_y_mm3`
- `Wpl_y_mm3`
- `Weff_y_mm3` for Class 4 if available
- Current published `Avz_mm2` is retained as the legacy major-axis shear resistance input.

Minor-axis:
- `Iz_mm4`
- `Wel_z_mm3`
- `Wpl_z_mm3`
- `Weff_z_mm3` for Class 4 if available
- `Avy_mm2` / equivalent aliases for minor-axis shear if ever present.

## Unsupported Cases

- Minor-axis shear resistance is not inferred from `Avz_mm2`. If `Avy` is missing, `VzRd` is reported as unavailable with a warning.
- Sections without `Wel_z/Wpl_z/Weff_z` do not get fake minor-axis bending resistance. The API reports the missing property and leaves `MzRd` unavailable.
- Existing code-check controls remain focused on the legacy major-axis control text. Minor-axis values are exposed in the COLBEAM Audit Output and JSON response for comparison.

## Audit Output Changes

The COLBEAM Audit Output now reads backend `actions.axis` and shows:

- Raw load direction records.
- `MyEd`, `MzEd`, `VyEd`, `VzEd`.
- `MyRd`, `MzRd`, `VyRd`, `VzRd`.
- Governing axis.
- Unsupported axis warnings.

## Stage 5 Files Changed

- `backend/services/calculation-service.js`: axis-aware section property lookup, direction-filtered load analysis, minor-axis bending check, axis action summary and warnings.
- `backend/services/colbeam-audit-settings.js`: warning text updated because Y/Z action tracking is now partly engine-wired.
- `public/secure-app.js`: load-direction default changed to `Y`; audit output now displays backend axis results.
- `public/app.js`: simplified frontend request path now defaults loads to `Y`.
- `backend/tests/colbeam-stage5-load-directions.js`: tests Y, Z, mixed directions, missing z-modulus behaviour and Stage 4 custom factors with directions.
- `package.json`: Stage 5 test included in `check` and `smoke`.
- `COLBEAM_FEATURE_IMPLEMENTATION_NOTES.md`: Stage 5 documentation.

## Stage 5 Tests Added

- Y-direction UDL produces major-axis `MyEd`/`VyEd`.
- Missing old direction defaults to Y and preserves old major-axis output.
- Z-direction UDL produces minor-axis `MzEd` and `MzRd` where `Iz/Wz` exist.
- Mixed Y/Z loads produce separate `MyEd/MzEd` and separate utilisation ratios.
- Missing minor-axis modulus reports a warning and does not fake `MzRd`.
- Stage 4 custom ULS factors still affect both Y and Z direction analyses in custom mode.
