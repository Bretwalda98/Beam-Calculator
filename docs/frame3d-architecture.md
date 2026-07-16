# Frame3D architecture

## Runtime separation

Frame3D is independent from Beam EC3.

- `/beam/` retains the existing Beam EC3 document, state keys and `/api/...` calculation/report requests.
- `/frame3d/` is a Vite/TypeScript application under `apps/frame3d`.
- Shared serialisable types, unit helpers and browser-side validation live under `packages/frame3d-*`.
- The numerical solver lives under `crates/frame3d-solver` and is compiled to WebAssembly with `wasm-bindgen`.
- A dedicated browser Web Worker imports the generated WASM package. The main browser thread does not assemble or solve stiffness matrices.
- The Cloudflare Worker is not used for structural solution. It only exposes the existing APIs plus read-only Frame3D-compatible section snapshots at `GET /api/frame3d/sections`.

Frame3D state is held only in `apps/frame3d/src/state/store.ts`. It does not read or mutate Beam EC3 draft keys.

## Analysis pipeline

1. The table editor updates a versioned `Frame3DModel`.
2. TypeScript validation checks schema, references, finite values, properties, connectivity and obvious rigid-body instability.
3. The main thread starts a dedicated worker with a request ID and model revision.
4. The worker reports `Validating`, `Assembling`, `Solving` and `Recovering results`.
5. Rust validates the model again, constructs member transformations and local stiffness matrices, and assembles the original global system.
6. Restrained degrees of freedom are removed to form the free-DOF system.
7. `nalgebra` solves the symmetric positive-definite reduced system using Cholesky factorisation after an eigenvalue singularity check.
8. The full displacement vector is reconstructed.
9. Reactions are recovered from the original system using `R = KU − F`.
10. Member local end actions and global force/moment equilibrium residuals are recovered.

Cancellation terminates the worker. Request IDs and model revisions prevent an old worker response from replacing results for a newer edit.

## Matrix and constraint method

Every node has six global degrees of freedom ordered `UX, UY, UZ, RX, RY, RZ`. A two-node member therefore has twelve local degrees of freedom. The element is a prismatic, small-displacement Euler–Bernoulli space-frame element with axial, Saint-Venant torsional and biaxial bending stiffness.

The global matrix is assembled by direct stiffness addition:

`K_global(member) = Tᵀ k_local T`

Nodal load-case vectors are superposed using the selected load case or linear-combination factors. Restrained displacements are zero in version 1; the solver extracts and solves only the free/free partition.

## Section snapshots

The existing server section database remains private. `listFrame3dSections()` exposes only:

- designation and family;
- availability;
- missing required property names;
- a snapshot containing `A`, `Iy`, `Iz`, `J/It` and source metadata when all properties exist.

Assigning a catalogue section adds that snapshot to the model. A later database revision cannot silently alter a saved model.

## Deployment structure

The requested `apps/`, `packages/` and `crates/` structure is used. Generated static files remain in `dist/` because the repository’s Cloudflare Pages process already publishes that directory. Generated `wasm-bindgen` files are committed under `apps/frame3d/src/wasm` so the existing Node-only Pages build can bundle Frame3D without requiring Rust in the Pages environment. They are regenerated with `npm run build:wasm`; `npm run build:verified` regenerates them before the production frontend build.
