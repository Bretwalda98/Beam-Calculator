# Advanced EC3 Audit Feature Implementation Notes

This file records the staged Advanced EC3 audit work. The feature supports reference comparison without claiming full parity with any external program.

## Stage 1 - Request/State Fields

Added calculation input fields for audit comparison, including custom ULS/SLS factors, load directions, SLS deflection basis, support mapping notes, material variant, national annex, coefficient source, section-classification status, Class 4 effective-property status, shear factor eta, forced elastic Class 1-2 resistance, conservative `N + My + Mz`, LTB metadata fields, interaction metadata and support/bearing metadata.

Existing fields reused where already present include `gammaM0`, `gammaM1`, section class, self-weight, normal load combination selection, `psiQ1`, `psiQ2`, deflection limit, LTB enable/k/C1/C2/model/load level, Ky/Kz, buckling curves, springs, end support and stiffener flags.

## Stage 2 - Visible Controls

Added visible controls in the existing Input and Setup panels only. These are calculation setup assumptions, not global app preferences.

Metadata-only controls are marked as recorded for reference comparison and not yet engine-wired.

## Stage 3 - Advanced EC3 Audit Output

Added the Advanced EC3 Audit Output panel with JSON copy/download. The panel displays active input/setup values, metadata-only warnings, load directions, actions, combinations, deflection settings, EC3 factors, LTB/buckling settings, interaction settings, resistances and check data.

## Stage 4 - Custom Combinations And SLS Basis

Wired custom ULS/SLS factors in the custom Advanced EC3 mode. Also wired safe SLS deflection basis and SLS self-weight inclusion behaviour where the current engine can separate the effects safely. Per-check 6.10a/b envelope remains metadata-only.

## Stage 5 - Y/Z Load Direction Mapping

Wired safe Y/Z load-direction mapping. Y-direction loads use the major-axis path. Z-direction loads use the minor-axis path where the section data supports it. Missing axis properties produce warnings rather than fake values.

## Stage 6 - Safe Section-Control Settings

Wired:

- Shear factor eta where the relevant shear area exists.
- Forced elastic resistance for Class 1-2 sections using Wel instead of Wpl.
- Additional conservative `N / NRd + MyEd / MyRd + MzEd / MzRd` check.

Kept as metadata-only:

- Flange buckling ignored toggle.
- Web buckling ignored toggle.
- Higher-risk LTB method fields.
- EC3 Method 1 / Method 2 member-buckling interaction.
- Class 4 effective-property generation.
- Support stiffness, support bearing and stiffener formula parity.

## Current Notes

- Complete section-property artifacts include 368 rows and no missing required canonical fields.
- Public UI wording uses neutral Advanced EC3/reference-comparison terminology.
- Backend compatibility keys may retain their historical internal names to avoid breaking saved projects and API payloads.
- The feature does not claim external reference-software parity.
