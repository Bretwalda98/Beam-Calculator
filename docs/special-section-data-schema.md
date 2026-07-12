# Verified Special-Section Data Schema

`backend/data/verified-special-sections.json` is the server-side data boundary for externally researched bulb-flat and rolled-angle records. The production file is intentionally empty until independently verified records are supplied. It does not replace or modify `backend/data/sections-database.js`.

Each record must contain:

- stable `id`, `family` (`bulb_flat` or `rolled_angle`) and `designation`;
- standard/source name, source reference and revision/date;
- `verified: true`;
- explicit unit declarations: mm, mm2, mm3, mm4, mm6 and kg/m;
- positive explicit dimensions;
- area, mass, Iy, Iz and elastic moduli for top, bottom, left and right extreme fibres;
- optional verified plastic moduli, shear areas, It, Iw, centroid and shear-centre coordinates;
- quality notes describing limitations or conversions.

The adapter rejects unverified records, duplicate IDs, unsupported families, invalid units, impossible dimensions and missing mandatory properties. Optional properties remain `null`; consumers must return `DATA_REQUIRED` or `INCOMPLETE` for dependent checks. No nearest-section substitution is permitted.

Use the template only as a field guide:

`backend/data/verified-special-sections.template.json`

Validate a supplied file with:

```powershell
node scripts/validate-special-section-data.js path\to\candidate.json
```
