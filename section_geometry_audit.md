# Section Geometry Source Audit

Audit date: 2026-06-27

## Summary

- Database rows reviewed: 368
- Rows carrying required geometry after import: 368
- Rows missing required geometry after import: 0
- Rows changed by latest import: 0
- Individual geometry/provenance field changes: 0
- Import source table: `scripts/section-geometry-source-data.json`

The importer updates geometry only. It does not change engineering formulas, design checks, section moduli, areas, LTB values or material properties.

## Family Results

| Family | Rows | Missing required geometry | Geometry source(s) |
|---|---:|---:|---|
| IPE | 72 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme |
| HEM | 24 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme |
| HEB | 24 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme |
| HEA | 24 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme |
| HEAA | 24 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme |
| UPE | 14 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme |
| UPN | 18 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme |
| RHS | 2 | 0 | Steel for Life Blue Book |
| UB | 72 | 0 | British Steel Universal Beams datasheet<br>Steel for Life Blue Book |
| UC | 31 | 0 | British Steel Universal Columns datasheet |
| UBP | 17 | 0 | British Steel Universal Bearing Piles datasheet |
| J | 13 | 0 | ArcelorMittal Sections and Merchant Bars Sales Programme<br>ArcelorMittal Sections and Merchant Bars catalogue |
| PFC | 16 | 0 | British Steel Parallel Flange Channels datasheet<br>Steel for Life Blue Book |
| CH | 17 | 0 | ArcelorMittal Sections and Merchant Bars legacy catalogue |

## Published / Normalised Sources

| Source | Edition | Reference |
|---|---|---|
| ArcelorMittal Sections and Merchant Bars Sales Programme | V2026-1 | https://sections.arcelormittal.com/repo/Sections/Sections%20and%20Merchant%20Bars-ArcelorMittal_V2026-1.xlsx |
| ArcelorMittal Sections and Merchant Bars Sales Programme | V2024-2 PDF fallback | https://sections.arcelormittal.com/repo/Sections/Sections_MB_ArcelorMittal_FR_EN_DE_V2024-2.pdf |
| ArcelorMittal Sections and Merchant Bars legacy catalogue | 2018-05-18 PDF | https://sections.arcelormittal.com/repository2/Sections/5_1_5_ArcelorMittal_FR_EN_RU_web.pdf |
| Existing verified bundled geometry | As recorded in section row metadata | public/sections_database.js and backend/data/sections-database.js |

## Required Geometry Rules

- Open rolled and channel sections require `h_mm`, `b_mm`, `tw_mm`, `tf_mm` and `r_mm`.
- Hollow sections require `h_mm`, `b_mm`, `t_mm` and `r_mm`.
- `r2_mm` is stored where the published channel source provides a toe radius.
- Rows with missing future geometry must remain visible as warnings in the UI/report renderer; the importer currently leaves zero missing rows.
