# Professional Beam Calculator Architecture

## Runtime Split

The application is now structured as a backend-first web app.

- Tool selection: `index.html`
- Beam EC3 frontend: `beam/index.html`, `public/secure-app.js`, `public/styles.css`
- Frame3D frontend: `apps/frame3d/**`, shared TypeScript packages under `packages/frame3d-*`, and the Rust solver under `crates/frame3d-solver`
- Backend API: `server.js`, `backend/**`
- Server data: `backend/data/sections-database.js`, `backend/data/materials.js`
- Legacy parity source: `backend/legacy/legacy-index.html`
- Database design: `backend/db/schema.sql`

The Beam EC3 public frontend is only a presentation layer. It handles forms, theme/layout preferences, diagram drawing from returned arrays, and report/download actions. It does not contain engineering equations, design rules, material tables, section properties, or the full section database.

Frame3D is a separate Vite/TypeScript application. It has its own state and validation packages and executes its Rust/WebAssembly space-frame solver in a browser Web Worker. It does not use Beam EC3 state or calculation services.

## Request Flow

1. User enters calculation data in the browser.
2. Browser sends normalized JSON to `POST /api/calculate`.
3. Server validates inputs, loads the section/material from server files, runs the finite element solver and design checks, and returns result data.
4. Browser renders the returned summary, checks, and graph series.
5. Server-generated reports are requested through `POST /api/report`, `POST /api/hand-calculation`, compatibility aliases under `/api/report/*`, or the lightweight fallback `POST /api/pdf`.

## Backend Modules

- `backend/services/calculation-service.js`: server-side solver and engineering checks.
- `backend/services/sections-service.js`: section lookup, source metadata, and source index generation.
- `backend/services/project-service.js`: authenticated project and revision persistence for the local development store.
- `backend/services/report-service.js`: server-side report model, HTML print package, LaTeX source, SVG figures, and PDF fallback generation without exposing report logic to the client.
- `backend/services/pdf-service.js`: compatibility wrapper for the PDF fallback export.
- `backend/auth/auth-service.js`: OAuth provider configuration gates. Authentication is not faked when secrets are missing.
- `backend/middleware/http.js`: security headers, CORS, rate limits, JSON parsing, signed-cookie helpers, auth guard.

## Legacy Parity

The previous monolithic browser app is stored at `backend/legacy/legacy-index.html`. It is not served by `server.js`. It remains in the repository only as a parity reference while the server engine is expanded and regression-tested.

## Public Bundle Guard

`scripts/check-public-bundle.js` scans the production static surface and fails if protected Beam tokens such as `PROFILE_DB`, the old section database script, Beam solver functions, or report-generation functions appear in the public files. The independent, permissively licensed Frame3D WebAssembly solver is intentionally part of the public Frame3D bundle.

## Production Target

For production, place the API behind HTTPS, run with `NODE_ENV=production`, provide a strong `SESSION_SECRET`, configure OAuth secrets, and replace the local JSON project store with PostgreSQL using `backend/db/schema.sql`.
