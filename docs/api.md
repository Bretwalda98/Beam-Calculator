# API Endpoints

## Health

- `GET /api/health`

Cloudflare Worker production response:

```json
{
  "ok": true,
  "service": "Beam Calculator API",
  "version": "1.0.0",
  "environment": "production"
}
```

## Authentication

- `GET /api/auth/providers`
- `GET /api/auth/session`
- `GET /api/auth/google/start`
- `GET /api/auth/apple/start`
- `POST /api/auth/email/start`
- `POST /api/auth/logout`
- `DELETE /api/account`

OAuth endpoints return setup errors until the required secrets and redirect domains are configured. The app does not fake authentication.

## Sections

- `GET /api/sections`
- `GET /api/sections/:family`
- `GET /api/sections/:id/preview`
- `GET /api/sections/sources`
- `GET /api/frame3d/sections`

The API exposes families plus constrained section selection metadata rather than raw database rows. The preview endpoint returns selected-section display geometry, visible properties and a versioned Solid-mode profile snapshot with source provenance and a canonical catalogue fingerprint.

The Frame3D section endpoint returns `A`, `Iy`, `Iz`, `J/It`, source metadata, the catalogue fingerprint and the same constrained profile snapshot required to create an immutable saved section. Rows with missing required properties are marked unavailable and list the missing fields.

## Calculations

- `POST /api/calculate`

Request body includes `section`, `material`, `model`, `loads`, `axial`, `settings`, and `combination`. The server returns result summaries, check utilizations, diagram series, and source references.

## Projects

All project endpoints require an authenticated session.

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects/:id/archive`
- `GET /api/projects/:id/pdf`

Each save creates a new project revision in the project record. The development implementation stores JSON under `storage/projects/<userId>`. Production should use PostgreSQL.

## CAD/FEM projects and jobs

All CAD/FEM routes require a validated Cloudflare Access identity at the public gateway and an owner-scoped PostgreSQL record in the native API.

- `GET /api/cad/projects`
- `POST /api/cad/projects`
- `GET /api/cad/projects/:id`
- `PATCH /api/cad/projects/:id`
- `POST /api/cad/projects/:id/commands`
- `POST /api/cad/projects/:id/imports`
- `POST /api/fea/studies/:id/mesh-jobs`
- `POST /api/fea/studies/:id/solve-jobs`
- `GET /api/jobs/:id`
- `DELETE /api/jobs/:id`
- `GET /api/jobs/:id/events`
- `GET /api/jobs/:id/artifacts/:artifactId`

The separate `CadFEMProject` schema uses immutable integer revisions. Mutating commands include a stable command ID and base revision. A stale revision returns `409`; replaying a command or job ID returns the original record without repeating work.

STEP import is a two-step flow. The first request creates short-lived signed R2 upload metadata. After upload, the second request supplies the artifact ID; the service verifies its metadata before queuing native regeneration. Large B-reps, meshes and result fields remain in R2 rather than Worker request bodies.

AWS Batch completion alone never marks a solution complete. The API requires a native output status and artifact manifest, and a solve can only complete when the native status records convergence. The platform spike permits only its named verification solve profile; arbitrary Solid-mode solve submission remains disabled until the benchmark gates pass.

## PDF

- `POST /api/pdf`

Generates a server-side lightweight PDF fallback from a supplied calculation result or from a supplied calculation input.

## Reports

- `POST /api/report`
- `POST /api/report/html`
- `POST /api/hand-calculation`
- `POST /api/report/latex`

Both endpoints accept the same body shape:

```json
{
  "input": {},
  "result": {},
  "metadata": {}
}
```

If `input` is present, the server recalculates where needed so older saved results can be upgraded to the current report object format. `/api/report` and `/api/report/html` return a professional print package with title page, executive summary, section SVG, loading diagram, graphs, calculation objects, assumptions, revision history, references, appendices, and final signature summary. `/api/hand-calculation` and `/api/report/latex` return generated `.tex` source from the same calculation objects.
