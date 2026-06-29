# Calculation Engine Audit - Colbeam EC3 Parity

Audit date: 2026-06-29

## Summary

This audit reviews the backend-first calculation engine against the intended Colbeam EC3 style of behaviour. No calculation formulas were changed as part of this audit. The implementation work in this pass adds regression fixtures that capture current equation-selection behaviour, then documents the highest-risk differences that must be resolved before claiming Colbeam parity.

Current calculation authority is concentrated in `backend/services/calculation-service.js`. The frontend should remain a renderer only.

Colbeam public output examples were not found in the repository, uploaded attachments, or public web searches. Public references that can still guide parity are:

- COLBEAM lateral torsional buckling implementation discussion: https://publications.lib.chalmers.se/records/fulltext/182546/182546.pdf
- COLBEAM parameter / section-capacity reference: https://publications.lib.chalmers.se/records/fulltext/200918/200918.pdf
- Steel for Life Blue Book bending notes: https://www.steelforlifebluebook.co.uk/explanatory-notes/ec3-ukna/bending-tables/
- Steel for Life axial force and bending notes: https://www.steelforlifebluebook.co.uk/explanatory-notes/ec3-ukna/axial-force-bending-tables/
- SCI Blue Book overview: https://www.steelconstruction.info/index.php?title=The_Blue_Book
- NCCI elastic critical moment reference: https://www.steelconstruction.info/images/0/0f/SN003b.pdf

Because Colbeam reference outputs are unavailable, the new fixtures are labelled as current-engine baselines, not proof of EC3 correctness.

## Added Regression Coverage

The audit fixture suite is stored in `backend/tests/fixtures/calculation-engine-audit-cases.json` and executed by `backend/tests/calculation-audit-fixtures.js`.

Covered branches:

| Fixture | Behaviour covered | Current result |
|---|---|---|
| `hea200a_class2_plastic_ltb_udl` | Class 1-2 plastic resistance, shear, LTB, deflection | Fails on SLS deflection |
| `hea200a_class3_elastic_bending` | Class 3 elastic modulus selection | Uses `Wel,y` |
| `hea200a_class4_missing_effective_properties` | Class 4 without effective properties | Falls back to `Wel,y` |
| `hea200a_axial_compression_member_buckling` | Axial compression, N+M, member buckling | Fails combined/member buckling |
| `hea200a_high_shear_mvy_reduction` | `VEd > 0.5 VRd` and `Mv,y,Rd` branch | Fails shear/moment/support |
| `hea200a_en1990_610ab_moment_selects_610b` | EN 1990 6.10a/b alternative selection | Selects 6.10b by peak moment |
| `pfc150_channel_ltb_unavailable` | Mono-symmetric channel LTB unavailable branch | LTB disabled with note |
| `rhs100_closed_section_ltb_current_branch` | Closed hollow section current LTB branch | LTB reported available |

These tests are now run by `npm run smoke`.

## Equation-Selection Audit

### 1. Load Combinations

Expected behaviour:
- EN 1990 Eq 6.10 should use `1.35G + 1.5Q1 + 1.5 psi0 Q2`.
- EN 1990 Eq 6.10a/b should consider both alternatives.
- The governing alternative may differ for moment, shear, reaction, support check, axial action and deflection.

Current behaviour:
- `getLC()` defines the combination coefficients.
- For `en1990_610ab`, the backend evaluates both ULS alternatives but selects a single ULS result based only on peak moment.
- SLS uses one combination path for deflection.

Risk:
- High. Colbeam-style output may choose/check the governing action effect per check, not reuse the moment-governing ULS result for every resistance check.

Required fix:
- Add per-response combination envelopes: moment envelope, shear envelope, reaction envelope, support check envelope and axial ULS envelope.
- Report which EN 1990 alternative governs each check.

### 2. Section Classification

Expected behaviour:
- EN 1993-1-1 clause 5.5 and Table 5.2 classify compression parts according to section geometry, stress distribution and loading case.
- Class 1-2 may use plastic resistance.
- Class 3 uses elastic resistance.
- Class 4 requires effective properties.

Current behaviour:
- Section class is a user setting.
- Class 1-2 uses `Wpl,y`.
- Class 3 uses `Wel,y`.
- Class 4 uses `Weff,y` if available, otherwise falls back to `Wel,y`.

Risk:
- High for Class 4 and for cases where Colbeam auto-classifies the section. The current fallback is useful for continuity but is not a true effective-section check.

Required fix:
- Add automatic section classification or expose a clearly documented Colbeam-compatible class input mode.
- For Class 4, require published/effective properties or mark the check unavailable instead of silently using `Wel,y`.

### 3. Bending Resistance

Expected behaviour:
- EN 1993-1-1 clause 6.2.5 selects `Wpl,y fy / gammaM0` for Class 1-2, `Wel,y fy / gammaM0` for Class 3, and `Weff,y fy / gammaM0` for Class 4.

Current behaviour:
- Matches the broad Class 1-3 modulus selection.
- Class 4 fallback is the main issue.

Risk:
- Medium for Class 1-3; high for Class 4.

Required fix:
- Keep current Class 1-3 branch.
- Block or explicitly qualify Class 4 results when effective properties are missing.

### 4. Shear Resistance

Expected behaviour:
- EN 1993-1-1 clause 6.2.6 uses shear area and `fy / sqrt(3) / gammaM0`.
- Web shear buckling and transverse force checks may require additional EC3 / EN 1993-1-5 logic depending on geometry and loading.

Current behaviour:
- `Vz,Rd` is calculated from `Avz`.
- Support/end-post check is a simplified factor applied to `Vz,Rd`.

Risk:
- Medium for basic shear resistance.
- High for support/web bearing or web buckling comparison with Colbeam.

Required fix:
- Separate pure shear resistance from transverse force/end support checks.
- Replace simplified support factors with documented EC3/EN 1993-1-5 style checks if Colbeam includes them.

### 5. High-Shear Moment Reduction

Expected behaviour:
- EN 1993-1-1 clause 6.2.8 reduces bending resistance where shear exceeds 50 percent of shear resistance, using the correct section-specific reduced plastic resistance.

Current behaviour:
- The trigger is `VEd / VzRd > 0.5`.
- Reduction is implemented for I / UB / UC / UBP / J style families.
- Class 3/4 sections bypass the plastic high-shear branch.
- Missing detailed geometry can retain `My,Rd` to match legacy behaviour.

Risk:
- High where high shear governs, because exact reduced resistance and geometry assumptions are sensitive.

Required fix:
- Verify the web plastic modulus reduction against EC3 and Colbeam.
- Fail the detailed high-shear reduction gracefully when required geometry is missing; do not retain unreduced resistance unless that is explicitly the intended Colbeam behaviour.

### 6. Axial Resistance and Section Interaction

Expected behaviour:
- EN 1993-1-1 clauses 6.2.3, 6.2.4 and 6.2.9 distinguish tension, compression and combined axial force plus bending.
- The interaction method depends on class, axial level and whether section resistance reduction terms apply.

Current behaviour:
- Compression uses `Nc,Rd`; tension uses `Nt,Rd`.
- The combined check is simplified as `NEd/NRd + My,Ed/My,Rd`.
- The same combined expression is used as a governing check when axial force is present.

Risk:
- High. Colbeam may suppress or alter N+M interaction below certain axial thresholds and may use different equations for plastic/elastic/effective sections.

Required fix:
- Implement a Colbeam-compatible section interaction decision table before changing formulas.
- Add fixtures for low compression, high compression and tension with bending.

### 7. Lateral Torsional Buckling

Expected behaviour:
- Colbeam references describe use of elastic critical moment with `C1`, `C2`, `C3`, effective length factors, load level and restraint conditions.
- EC3 LTB reduction then uses the relevant buckling curve and imperfection factors.

Current behaviour:
- LTB is active when enabled and section properties `It`, `Iz`, `Iw` are present.
- `C1`, `C2`, `k`, load level and restraints are user inputs.
- `C3`, shear-centre offsets and mono-symmetric terms are not implemented.
- Channels, tees and angles are marked unavailable.
- Closed RHS currently pass through the LTB branch with `Iw = 0`.

Risk:
- Very high. This is the most likely source of Colbeam check differences.

Required fix:
- Rebuild LTB selection around Colbeam-style parameters: C-factor selection, load-height level, k/kw handling, restraint spacing and mono-symmetric terms.
- Add explicit closed-section handling for RHS/SHS/CHS.
- Keep LTB unavailable for section families only when the required data is truly unavailable and document it in output.

### 8. Member Buckling and Beam-Column Interaction

Expected behaviour:
- EN 1993-1-1 clauses 6.3.1 and 6.3.3 require axis-specific buckling curves, effective lengths, reduction factors and interaction factors.
- Colbeam likely applies a defined interaction-factor method rather than fixed constants.

Current behaviour:
- Member buckling activates for axial compression only.
- Auto buckling curves are family-based.
- Interaction uses `kyy = 1.0` and `kzy = 0.6` defaults unless the UI sends alternatives.

Risk:
- High where axial compression is present.

Required fix:
- Add a Colbeam-compatible interaction-factor method and expose the selected equation in the calculation object.
- Add y-axis and z-axis buckling fixtures with known Colbeam outputs.

### 9. Deflection

Expected behaviour:
- Serviceability checks should use the selected SLS combination and the intended deflection definition: total, variable-only, imposed-only, or net final deflection.

Current behaviour:
- Deflection uses the SLS combination from `getLC()`.
- The check compares peak FE deflection to `L / deflectionLimit`.

Risk:
- Medium. Numeric differences can arise if Colbeam reports variable-action deflection or excludes self-weight from the serviceability comparison.

Required fix:
- Add a deflection mode setting or match Colbeam's default deflection basis.
- Report the SLS combination and deflection basis in the check output.

### 10. Analysis Solver

Expected behaviour:
- Internal forces and deflection should match closed-form beam theory or Colbeam's analysis model for equivalent support and load cases.

Current behaviour:
- Backend FE analysis generates ULS/SLS internal force curves and reactions.
- Point loads, UDLs and moment loads are supported.
- Trapezoidal loads are expected to be converted to equivalent UDL segments before calculation.

Risk:
- Medium. Support conditions, sign convention and segmented trapezoidal loads need independent reference checks.

Required fix:
- Add solver-only benchmark fixtures against closed-form results before changing EC3 resistance formulas.

## Priority Fix Plan

### Priority 1 - Trust and pass/fail correctness

1. Add user-supplied Colbeam reference outputs as fixtures.
2. Change 6.10a/b handling to envelope per governing response/check.
3. Correct Class 4 behaviour so missing effective properties do not silently pass as elastic checks.
4. Rework LTB selection to match Colbeam parameters and closed/mono-symmetric section behaviour.
5. Replace simplified axial+bending and member-buckling interaction with a documented Colbeam-compatible method.

### Priority 2 - Engineering completeness

1. Add automatic section classification or a documented "manual class" audit warning.
2. Add web/transverse support checks using documented EC3/EN 1993-1-5 rules.
3. Add deflection-basis selection and output labels.
4. Add closed-form solver benchmarks for standard beams.

### Priority 3 - Reporting and UI transparency

1. Show the selected equation, clause, combination alternative and governing location for every check.
2. Mark unavailable checks as unavailable, not as passing.
3. Add source notes where Colbeam parity is not yet proven.

## Acceptance Criteria for Colbeam Parity

- For every supplied Colbeam reference case, the backend selects the same governing check.
- Numerical action effects, resistances and utilisation ratios match within 1 percent unless a documented unit/display rounding difference explains the deviation.
- PASS/FAIL status matches Colbeam.
- Check output states the clause/equation used and why it was selected.
- Unsupported cases are explicitly marked unavailable with the missing data listed.

## Browser Verification Status

The in-app browser target was not available to Codex during this run (`agent.browsers.list()` returned an empty list). Backend/API and local engine verification can still be performed, but live browser UI verification should be repeated once the browser target is available.

