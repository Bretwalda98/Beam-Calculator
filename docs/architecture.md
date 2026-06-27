# Professional Beam Calculator Architecture

## Runtime Split

The application is now structured as a backend-first web app.

- Frontend: `index.html`, `public/app.js`, `public/styles.css`
- Backend API: `server.js`, `backend/**`
- Server data: `backend/data/sections-database.js`, `backend/data/materials.js`
- Legacy parity source: `backend/legacy/legacy-index.html`
- Database design: `backend/db/schema.sql`

The public frontend is only a presentation layer. It handles forms, theme/layout preferences, diagram drawing from returned arrays, and report/download actions. It does not contain engineering equations, design rules, material tables, or section properties.

## Request Flow

1. User enters calculation data in the browser.
2. Browser sends normalized JSON to `POST /api/calculate`.
3. Server validates inputs, loads the section/material from server files, runs the finite element solver and design checks, and returns result data.
4. Browser renders the returned summary, checks, and graph series.
5. Server-generated reports are requested through `POST /api/report/html`, `POST /api/report/latex`, or the lightweight fallback `POST /api/pdf`.

## Backend Modules

- `backend/services/calculation-service.js`: server-side solver and engineering checks.
- `backend/services/sections-service.js`: section lookup, source metadata, and source index generation.
- `backend/services/project-service.js`: authenticated project and revision persistence for the local development store.
- `backend/services/report-service.js`: server-side report model, HTML print package, LaTeX source, SVG figures, and PDF fallback generation without exposing report logic to the client.
- `backend/services/pdf-service.js`: compatibility wrapper for the PDF fallback export.
- `backend/auth/auth-service.js`: OAuth provider configuration gates. Authentication is not faked when secrets are missing.
- `backend/middleware/http.js`: security headers, CORS, rate limits, JSON parsing, signed-cookie helpers, auth guard.

## Legacy Parity

The previous monolithic browser app has been moved to `backend/legacy/legacy-index.html`. It is not served by `server.js`. It remains in the repository only as a parity reference while the server engine is expanded and regression-tested.

## Production Target

For production, place the API behind HTTPS, run with `NODE_ENV=production`, provide a strong `SESSION_SECRET`, configure OAuth secrets, and replace the local JSON project store with PostgreSQL using `backend/db/schema.sql`.
