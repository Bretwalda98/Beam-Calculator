# Frame3D foundation task log

## CAD-integrated solid FEM programme — 16 July 2026

- Stacked branch: `codex/fea-platform-spike`, based on the open foundation branch at `59c3263`; foundation PR #9 is not yet merged into `main`.
- Baseline `npm run check`: passed.
- Baseline `npm run verify:frame3d`: passed (26 Rust tests, 7 compiled-WASM analytical comparisons, Worker and direct-route smoke tests).
- Baseline `npm run smoke`: retains the previously recorded section-catalogue SHA-256 mismatch and reaches no new failure before that assertion.
- Native environment: Rust/Node/Git are available. Docker, WSL, CMake, Ninja, AWS CLI and a system C++ toolchain are not installed. A portable LLVM-MinGW compiler is available outside the repository.
- Native CAD/FEM code must therefore have a reproducible Linux container/CI build and must fail clearly when OCCT, Netgen, MFEM or Tribol are unavailable. No browser or JavaScript solid-solver substitute is permitted.

### Staged implementation plan

1. Add a separate versioned `CadFEMProject` contract, validation package, PostgreSQL migration, immutable command/job interfaces and authenticated edge/native-service boundaries.
2. Split `/frame3d/` into a project selector, preserve the existing solver at `/frame3d/frame/`, and add a separate React/Three.js solid workbench at `/frame3d/solid/`.
3. Add the C++20 native service, pinned dependency/container build, OCCT document and STEP pipeline, Netgen tetrahedral meshing, MFEM linear elasticity and structured result artefacts.
4. Add assembly mates, bonded interfaces, nonlinear frictionless Tribol contact and convergence diagnostics only after their native benchmarks pass.
5. Add AWS ECS/Batch/RDS staging infrastructure and Cloudflare gateway/R2 configuration without changing production DNS, secrets or routes.
6. Run existing Beam/Frame regressions plus CAD schema, routing, native build and benchmark gates. Never label solid/contact results verified until those gates pass.

### EC3 section integration action — 17 July 2026

1. Expose immutable, provenance-bearing profile snapshots from the existing 368-row Beam EC3 catalogue without changing Beam calculations or API routes.
2. Make the Frame section picker load automatically and add designation/family filtering while preserving property snapshots used by the frame solver.
3. Replace the Solid workbench's hard-coded box with a real I-section/channel/RHS extrusion preview driven by the selected EC3 dimensions.
4. Store the selected section, dimensions, properties, source and catalogue fingerprint in a separate `CadFEMProject` feature; never retain only a mutable catalogue ID.
5. Generate native STEP input from a single saved catalogue extrusion for OCCT regeneration and Netgen meshing. Keep arbitrary solid solves disabled until benchmark gates pass.
6. Re-run all Beam, Frame, CAD/FEM, route and catalogue tests; use CI for the native container tests unavailable on this workstation.

Implemented locally: all 368 profiles have complete verified source snapshots; Frame search/filter and Solid selection/preview are wired; immutable save/idempotency tests pass; and the Batch input path can generate nominal sharp-corner STEP geometry from the saved snapshot. Root/toe radii and tapered flanges remain recorded but intentionally unapplied by this first native generator, with explicit artefact warnings. Native CTest remains a required CI gate and no solid-result verification claim is made.

The previously recorded raw-file catalogue checksum failure is removed. The test now pins a canonical data fingerprint and separately verifies row count, profile availability, provenance and flange-slope coverage. `npm run smoke` now passes without altering the Beam engineering engine.

CI packaging correction: the native diagnostic job now loads a slim test image containing installed runtime libraries, CTest metadata and test executables rather than the complete upstream source/build trees. Upstream build directories are removed in their own image layers after installation, cache export remains useful without transferring those trees, and branch concurrency cancels superseded runs.

Native benchmark diagnosis: CI run `29618078259` built the pinned image and passed STEP generation plus both OCAF geometry stages. Netgen then produced and saved a valid 203-node/426-tetrahedron mesh, but AddressSanitizer found a double free inside upstream `Ng_DeleteMesh`: `Mesh::DeleteMesh()` deleted boundary-name pointers without clearing the pointer array, and the immediately following `Mesh` destructor deleted them again. The image now applies and distributes a one-line pinned-source patch that clears the array after the first deletion. Mesh and solve CTests remain the acceptance gate; this diagnosis alone is not a verified-solver claim.

Native exchange diagnosis: CI run `29620524855` passed the patched Netgen mesh lifecycle test, including the 203-node/426-tetrahedron mesh under AddressSanitizer. The solve then stopped before assembly because Netgen 6.2's modern `mesh3d` `.vol` header is not one of the formats recognised by the pinned MFEM loader. The pipeline now retains that native audit artefact and separately writes MFEM's documented `NETGEN` neutral stream from the in-memory first-order tetrahedra and boundary triangles, rejecting any unsupported element type. The axial displacement and equilibrium gates remain pending until the replacement CI run passes.

Reaction-recovery diagnosis: CI run `29621105838` loaded the neutral mesh, converged the quadratic MFEM solve and produced `0.004749267 mm` average end displacement against `0.004761905 mm` analytically (0.2654% error, inside the 1% gate). Its equilibrium gate exposed that reaction recovery was multiplying by MFEM's boundary-eliminated matrix and decoding `Ordering::byVDIM` as component-block ordering. Recovery now uses MFEM's full uneliminated operator, the preserved assembled load vector and the documented interleaved component mapping. The equilibrium gate remains pending until CI confirms the correction.

Native benchmark outcome: CI run `29621269146` passed all eight staged CTests in the pinned sanitised image. The final 203-node/426-tetrahedron quadratic-displacement axial bar returned `0.00474927 mm` against `0.00476190 mm` analytically (0.2654% relative error) and a `3.9343 × 10^-11` normalised equilibrium residual, passing the 1% and `1 × 10^-8` gates. This verifies the named proof benchmark only; the broader linear benchmark matrix and nonlinear contact release gates have not run and the Solid workbench remains Beta with arbitrary solves disabled.

### Platform-spike outcome

- `/frame3d/` is now a study selector, `/frame3d/frame/` preserves the existing frame-element application and `/frame3d/solid/` hosts an isolated React/Three.js Beta workbench shell.
- Added the separate versioned `CadFEMProject` schema, validation and solve-readiness gates without mixing it with `Frame3DModel`.
- Added PostgreSQL project/revision/command/study/job/artifact persistence, Cloudflare Access gateway validation, idempotent APIs, short-lived R2 artifact transport and AWS Batch submission/cancellation/reconciliation.
- Added a pinned C++20 native container pipeline for STEP/OCCT/OCAF regeneration, Netgen tetrahedral meshing and MFEM Float64 linear elasticity, plus an optional MFEM/Tribol frictionless contact patch.
- Added isolated `eu-west-2` ECS/RDS/Batch staging Terraform and CI jobs. Terraform formatting and validation pass; nothing has been applied or deployed.
- Local TypeScript, contract, route and existing Frame3D checks pass. The native container and benchmark have not run locally because Docker/CMake/native dependencies are unavailable; CI is the required gate.
- Final local audit: `npm run check`, `npm test`, `npm run verify:cad-fem`, full `npm audit`, Git Bash syntax checking and Terraform 1.15.8 formatting/validation pass. The 13-route smoke includes `/`, `/beam/`, `/frame3d/`, `/frame3d/frame/` and `/frame3d/solid/`.
- Final `npm run smoke` reaches the same pre-existing section-catalogue SHA mismatch: actual `ad2022577fb81246c808f7ae213419bd82e31f62eac5d8ee0d274f5251fd181d`, expected `a9d15c34db320151fcb36730e04b87c41eeaeecd26bd404fff62b688906d9d26`.
- The final source audit corrected the OCCT/Netgen release pins to their resolvable annotated-tag commits, strips browser credentials at the Tunnel boundary, preserves Beam-only production startup and requires an exact reviewed STEP hash plus fixed benchmark settings for native solve submission.
- Arbitrary solid solves remain disabled. Only the named axial-bar verification profile may be submitted, and no solid/contact result is described as verified.
- This branch is stacked on the unmerged foundation branch because the programme requires later stages to begin only after the preceding stage is reviewed and merged. Stages 2–5 have not been started.

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
