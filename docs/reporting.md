# Reporting Architecture

The professional report system is generated on the server. The browser sends calculation input and renders returned summaries, but it does not own engineering formulas, section databases, or report business logic.

## Renderers

- `backend/services/calculation-service.js` builds `calculationPackage` objects alongside the existing result summary.
- `backend/services/report-service.js` converts the result into a shared report model.
- `POST /api/report/html` returns the full print package as HTML with vector SVG figures.
- `POST /api/report/latex` returns generated LaTeX source from the same calculation objects.
- `POST /api/pdf` returns a lightweight server PDF fallback. Production should add a hardened server-side HTML-to-PDF or LaTeX-to-PDF renderer for the final binary PDF.

## Calculation Object Schema

Each engineering check records:

```json
{
  "id": "bending-resistance",
  "title": "Major-axis bending resistance",
  "codeReference": "EN 1993-1-1 Clause 6.2.5",
  "equation": "M_y,Rd = W_y f_y / gamma_M0",
  "variables": [{ "symbol": "W_y", "value": "..." }],
  "substitution": "...",
  "unitConversion": "...",
  "result": "...",
  "resistance": "...",
  "utilisation": "IR = ...",
  "status": "PASS",
  "warnings": []
}
```

These objects are used by both HTML and LaTeX renderers so the report text stays aligned across output formats.

## Included Report Sections

- Engineering title page with company/client/project metadata.
- Executive summary with overall status and governing check.
- Geometry-based section image with local axes and key dimensions.
- Loading diagram with supports, span, loads, reactions, and dimensions.
- Shear force, bending moment, deflection, and utilisation diagrams.
- Input, load, material, assumption, and section-property tables.
- Hand-calculation style design checks with formula, variables, substitution, unit conversion, result, resistance, utilisation, status, and warnings.
- Revision history, references, appendices, final summary, and signature boxes.

## Source Data Handling

Section sources are taken only from server-side row metadata. Unknown rows are reported as `Source to be confirmed`; the system does not invent catalogue references.

## Current Limitations

- Automatic plate-element section classification is not yet implemented. The selected section class is reported and flagged for designer justification.
- Some section rows do not expose all dimensions needed for drawings. The report derives drawing-only `tw`/`tf` values from available area and geometry where necessary and emits a warning.
- The HTML report is the professional print/PDF package in this implementation. The binary `/api/pdf` endpoint is a text-based fallback until a production PDF renderer is added.
