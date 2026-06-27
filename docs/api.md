# API Endpoints

## Health

- `GET /api/health`

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
- `GET /api/sections/sources`

The API exposes family and section names for selection. It does not expose full section property rows to the browser.

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

## PDF

- `POST /api/pdf`

Generates a server-side lightweight PDF fallback from a supplied calculation result or from a supplied calculation input.

## Reports

- `POST /api/report/html`
- `POST /api/report/latex`

Both endpoints accept the same body shape:

```json
{
  "input": {},
  "result": {},
  "metadata": {}
}
```

If `input` is present, the server recalculates where needed so older saved results can be upgraded to the current report object format. The HTML endpoint returns a professional print package with title page, executive summary, section SVG, loading diagram, graphs, calculation objects, assumptions, revision history, references, appendices, and final signature summary. The LaTeX endpoint returns generated `.tex` source from the same calculation objects.
