# Frame3D foundation task log

## Baseline — 16 July 2026

- Branch: `codex/frame3d-foundation-v1`, created from `origin/main` at `9b5ee6e`.
- Repository: 74 tracked files; clean before implementation.
- `npm run check`: passed.
- `npm run build:frontend`: passed.
- `npm run smoke`: existing failure in `backend/tests/special-section-data-boundary.js`.
  - Actual catalogue SHA-256: `ad2022577fb81246c808f7ae213419bd82e31f62eac5d8ee0d274f5251fd181d`
  - Pinned expected SHA-256: `a9d15c34db320151fcb36730e04b87c41eeaeecd26bd404fff62b688906d9d26`
- Local route smoke before changes:
  - `/`: 200
  - `/public/secure-app.js`: 200
  - `/api/health`: 200
  - `/privacy`, `/beam/`, `/frame3d/`: 404
- Rust/Cargo/wasm-pack/wasm-bindgen were not installed at baseline.

## Root-hosting assumptions found

- `index.html` is the Beam EC3 document and loads `public/secure-app.js` relatively.
- `scripts/build-frontend.js` copies root `index.html` directly to `dist/index.html`.
- `server.js` maps `/` to `index.html` and otherwise only permits files below `public/`.
- `scripts/check-public-bundle.js` scans root `index.html`, `public/`, and `dist/`.
- `docs/architecture.md` and `docs/deployment.md` describe Beam EC3 at `/`.
- `privacy.html`, `robots.txt`, and `sitemap.xml` assume the existing root layout.
- Beam API calls use `/api/...` paths through the existing API base helper. Beam persistence keys are already Beam-specific.

## Implementation plan

1. Preserve the Beam document and client unchanged in behaviour, serving them at `/beam/` with corrected absolute assets and privacy links.
2. Replace `/` with a responsive Beam Calculator Studio tool selector that shares the existing visual language and theme preference.
3. Add a separate Vite/TypeScript Frame3D application at `/frame3d/`, with isolated model state, validation, results, and solver-worker modules.
4. Add shared TypeScript schema, unit, and validation packages, using SI units internally.
5. Implement a Rust `wasm-bindgen` Float64 3D space-frame solver using a permissively licensed matrix library; include assembly, constraints, diagnostics, solution, and result recovery.
6. Build Rust/WASM first, then bundle Frame3D with Vite. Do not add a JavaScript solver fallback.
7. Update the local static server, static build, Pages routing artefacts, documentation, sitemap, and route/security tests while preserving every `/api/...` route.
8. Run native solver benchmarks, WASM/TypeScript builds, existing checks, existing smoke tests, and direct-route smoke tests. Only describe Frame3D results as verified if benchmark tests pass.

## Implementation outcome

- `/` now provides the responsive tool selector.
- The existing Beam EC3 document is served at `/beam/`; its calculation client, API paths and Beam-specific persistence keys remain unchanged.
- `/frame3d/` is a separate Vite/TypeScript application with isolated state, schema, units and validation modules.
- The Frame3D solver is Rust/WebAssembly and runs in a browser Web Worker. No JavaScript solver fallback exists.
- The generated Rust/WASM package is checked in so the existing Node-only Pages build remains usable. `npm run build:verified` recompiles WASM before the frontend build.
- The local Node server and generated Pages `_redirects` support direct navigation to all three applications and privacy.
- Existing Worker/API routes, Beam engineering formula modules and the section catalogue were preserved. One additive read-only route, `/api/frame3d/sections`, exposes only the four required analysis properties and availability metadata.

## Expanded foundation requirements

The final attached specification expanded the foundation after the first routing implementation. The completed scope now also includes:

- versioned schema `1.0.0` using N, mm, N/mm², N·mm and radians internally;
- metadata, display units, section/material snapshots, load cases, linear combinations and analysis selection;
- optional `G` with derivation from `E` and Poisson ratio;
- deterministic automatic member axes, optional references and section roll;
- force and moment equilibrium residuals;
- structured mechanism, connectivity and validation diagnostics;
- a dense table editor for project, nodes, members, materials, sections, nodal loads, load cases and combinations;
- JSON import/export with version and model validation;
- worker state reporting, cancellation and stale-result rejection;
- six documented examples, including a deliberately unstable diagnostic model;
- read-only Frame3D section snapshots from the existing server section data;
- sortable result tables and solver/version summaries;
- the five requested Frame3D engineering/development documents.

## Verification outcome

- `npm run check`: passed.
- `npm run build:verified`: passed, including Rust-to-WASM compilation and Vite production build.
- `npm run test:frame3d`: passed before the expanded verification set and is rerun in the final release audit.
- Rust verification now contains 26 tests, covering all twenty requested benchmark/diagnostic cases plus schema, references, combinations and derived shear modulus.
- Compiled-WASM verification prints seven analytical expected/actual/error comparisons and checks structured instability diagnostics.
- `node backend/tests/routing-smoke.js`: passed for `/`, `/beam/`, `/frame3d/`, `/privacy/`, Beam static assets, API health and WASM MIME serving.
- `npm run smoke`: reaches the same pre-existing production catalogue hash failure recorded at baseline. The Beam UI path assertion was updated from root `index.html` to `beam/index.html`.
- Headless Chrome inspection passed for the landing page, Beam EC3 and Frame3D production bundles. A true 390 px mobile emulation reported `scrollWidth === clientWidth`; the desktop and mobile layouts were visually inspected.
- Browser interaction smoke completed the portal-frame analysis through the production Web Worker/WASM bundle, rendered three result tables, loaded 368 section-property snapshots and retained the unstable model's rigid-body error in the interface.
- The browser smoke initially exposed a restrictive local CSP that blocked WebAssembly compilation. Frame3D now receives a route-specific `wasm-unsafe-eval`/`worker-src 'self'` policy in the Node server and generated Cloudflare Pages `_headers`; Beam EC3 does not receive that additional permission.
