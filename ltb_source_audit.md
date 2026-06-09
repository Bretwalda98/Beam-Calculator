# LTB Published-Source Data Audit

Audit date: 2026-06-07

## Summary

- Database rows reviewed: 368
- Rows assigned published-source LTB metadata: 368
- Rows with at least one numerical `Iz_mm4`, `It_mm4`, or `Iw_mm6` change: 330
- Individual field changes: `Iz_mm4` 292, `It_mm4` 319, `Iw_mm6` 263
- Unresolved rows: 0
- Existing non-LTB section properties were retained.

All updated rows now have `ltb_data_verified: true`, a published-data status, source name, edition, reference URL, source units, conversion note, and quality note.

## Source Map

| Family | Primary published source used | Edition | Rows |
|---|---|---|---:|
| IPE | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 68 |
| IPE | ArcelorMittal Sections and Merchant Bars Sales Programme | V2024-2 PDF fallback | 4 |
| HEM | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 24 |
| HEB | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 24 |
| HEA | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 24 |
| HEAA | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 24 |
| UPE | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 14 |
| UPN | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 18 |
| RHS | Steel for Life Blue Book, hot-finished SHS table | EC3 UK NA data v18 | 2 |
| UB | British Steel Universal Beams datasheet | CUBD:ENG:072024 | 70 |
| UB | Steel for Life Blue Book fallback | EC3 UK NA data v18 | 2 |
| UC | British Steel Universal Columns datasheet | CUCD:ENG:072023 | 31 |
| UBP | British Steel Universal Bearing Piles datasheet | CUBPD:ENG:012023 | 17 |
| J | ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 workbook | 10 |
| J | ArcelorMittal legacy catalogue | 2018-05-18 PDF | 3 |
| PFC | British Steel Parallel Flange Channels datasheet | CPFCD:ENG:012023 | 12 |
| PFC | Steel for Life Blue Book fallback | EC3 UK NA data v18 | 4 |
| CH | ArcelorMittal legacy catalogue | 2018-05-18 PDF | 17 |

## Family Results

| Family | Rows updated | Numerical rows changed | `Iz` changed | `It` changed | `Iw` changed |
|---|---:|---:|---:|---:|---:|
| IPE | 72 | 72 | 72 | 72 | 71 |
| HEM | 24 | 24 | 22 | 24 | 23 |
| HEB | 24 | 24 | 24 | 24 | 24 |
| HEA | 24 | 24 | 24 | 24 | 24 |
| HEAA | 24 | 24 | 24 | 24 | 24 |
| UPE | 14 | 14 | 14 | 14 | 14 |
| UPN | 18 | 18 | 18 | 18 | 18 |
| RHS | 2 | 2 | 1 | 2 | 0 |
| UB | 72 | 43 | 28 | 38 | 8 |
| UC | 31 | 28 | 26 | 28 | 5 |
| UBP | 17 | 17 | 14 | 17 | 17 |
| J | 13 | 13 | 4 | 13 | 12 |
| PFC | 16 | 10 | 8 | 4 | 6 |
| CH | 17 | 17 | 13 | 17 | 17 |

## Unit Normalisation

- ArcelorMittal `Iz` and `It`: source `cm^4`; multiplied by `10^4` to store `mm^4`.
- ArcelorMittal `Iw`: source `10^3 cm^6`; multiplied by `10^9` to store `mm^6`.
- British Steel and Blue Book `Iz` and `It`: source `cm^4`; multiplied by `10^4` to store `mm^4`.
- British Steel and Blue Book `Iw`: source `dm^6`; multiplied by `10^12` to store `mm^6`.
- The app consumes `Iz_mm4`, `It_mm4`, and `Iw_mm6` directly in the elastic critical moment expression, so no calculation-side unit scaling is applied.

## Published-Source Fallbacks

The following designations were not present in the preferred current family table and use another official published edition:

- `IPE AA 360`, `IPE AA 400`, `IPE AA 450`, `IPE AA 500`: ArcelorMittal V2024-2 PDF. These rows are omitted from the V2026-1 workbook.
- `J 254x203x82`, `J 254x114x37`, `J 203x152x52`: ArcelorMittal 2018 catalogue. The other ten J rows use V2026-1.
- All 17 CH rows: ArcelorMittal 2018 catalogue, because CH is not included in the V2026-1 workbook.
- `UB 356x127x39`, `UB 356x127x33`: Steel for Life Blue Book v18. These rows are not listed in British Steel's current UB datasheet.
- `PFC 430x100x64`, `PFC 380x100x54`, `PFC 125x65x15`, `PFC 100x50x10`: Steel for Life Blue Book v18. The current British Steel PFC datasheet lists the other 12 database rows.

## RHS Treatment

The two database rows named as RHS are square hollow sections, so they were matched to the Blue Book hot-finished SHS table:

- `RHS 100x100x5`
- `RHS 140x140x10`

`Iz` and `It` are direct published table values. The source does not tabulate an open-section warping constant for these closed sections. `Iw_mm6` is therefore explicitly stored as `0`, documented as closed-section warping treatment rather than a published table value or an estimated geometry value.

`index.html` was minimally adjusted so a stored, verified `Iw = 0` is accepted as valid data and displayed as zero instead of being treated as missing.

## Source Conflicts and Decisions

- Previous rows marked `estimated`, `formula_from_section_geometry`, `RoyMech`, or geometry-formula based were not retained as final authority.
- Where current ArcelorMittal, British Steel, and Blue Book values overlap, the family-specific hierarchy in the task was applied.
- British Steel values were used for current UB, UC, UBP, and PFC designations. Blue Book was used only for UK designations absent from the current British Steel family datasheet and for RHS.
- Published values replace formula results even when the difference is small.
- No unresolved values remain and no new LTB value was invented.

## Published References

- ArcelorMittal V2026-1 workbook: https://sections.arcelormittal.com/repo/Sections/Sections%20and%20Merchant%20Bars-ArcelorMittal_V2026-1.xlsx
- ArcelorMittal V2024-2 PDF: https://sections.arcelormittal.com/repo/Sections/Sections_MB_ArcelorMittal_FR_EN_DE_V2024-2.pdf
- ArcelorMittal 2018 legacy catalogue: https://sections.arcelormittal.com/repository2/Sections/5_1_5_ArcelorMittal_FR_EN_RU_web.pdf
- British Steel UB: https://www.britishsteel.co.uk/wp-content/uploads/2026/02/british-steel-universal-beams-datasheet-190724.pdf
- British Steel UC: https://www.britishsteel.co.uk/wp-content/uploads/2026/02/british-steel-universal-columns-datasheet-100723.pdf
- British Steel UBP: https://www.britishsteel.co.uk/wp-content/uploads/2026/02/british-steel-universal-bearing-piles-datasheet.pdf
- British Steel PFC: https://www.britishsteel.co.uk/wp-content/uploads/2026/02/british-steel-parallel-flange-channels-datasheet.pdf
- Blue Book UB: https://www.steelforlifebluebook.co.uk/ub/ec3-ukna/section-properties-dimensions-properties/
- Blue Book PFC: https://www.steelforlifebluebook.co.uk/pfc/ec3-ukna/section-properties-dimensions-properties/
- Blue Book hot-finished SHS: https://www.steelforlifebluebook.co.uk/hfshs/ec3-ukna/section-properties-dimensions-properties/
