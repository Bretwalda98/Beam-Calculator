# Calculation Engine Audit - Advanced EC3 Reference Comparison

This audit tracks known differences between the backend-first calculation engine and external EC3 reference workflows. It is intended to guide future verification, not to claim full parity with any reference package.

## Current Position

- The backend remains the source of truth for analysis, resistance checks, load combinations, reports, and audit output.
- The complete section-property dataset now contains 368 sections with no missing required canonical fields.
- Advanced EC3 audit controls expose comparison settings and assumptions without moving protected calculation logic into the browser.
- Some settings are engine-wired; higher-risk EC3 behaviours remain metadata-only until verified against reference cases.

## Engine-Wired Areas

- Custom ULS/SLS factors in the Advanced EC3 custom combination mode.
- SLS deflection basis and SLS self-weight inclusion where the current load model can separate the effects safely.
- Y/Z load-direction mapping where section properties support the axis.
- Shear factor eta where the required shear area exists.
- Forced elastic resistance for Class 1-2 sections where Wel is available.
- Additional conservative `N + My + Mz` interaction check when enabled and all required values exist.

## Remaining High-Risk Gaps

- Automatic section classification and Class 4 effective-property generation.
- Per-check EN 1990 6.10a/6.10b envelope selection.
- Detailed LTB selection, including `C3`, `kw`, load height, restraint spacing, and mono-symmetric terms.
- EC3 Method 1 / Method 2 member-buckling interaction.
- Support bearing, web bearing, stiffener and web-buckling checks.
- Support stiffness and spring equivalence behaviour.

## Reference Case Requirements

Future formula work should be driven by controlled reference-comparison cases. Each case should record:

- Section, material, span and support setup.
- Load direction and load case inputs.
- LTB, buckling, support, stiffener and interaction settings.
- Exact bottom Results-box text from the reference workflow.
- Full-screen and cropped results screenshots.
- Which app feature or formula gap is being validated.

## Acceptance Criteria For Future Parity Work

- Supplied reference-comparison cases select the same governing check.
- PASS/FAIL status matches the reference case.
- Utilisation ratios match within an agreed tolerance.
- The Advanced EC3 Audit Output clearly states every assumption, active setting, metadata-only setting and unavailable property.
