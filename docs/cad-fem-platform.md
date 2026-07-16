# CAD/FEM platform spike

## Status

This branch is the first staged branch of the CAD-integrated Solid FEM programme. It establishes production-shaped contracts and a reproducible native proof pipeline. It is not the finished CAD product and makes no verified-solver claim.

- `/frame3d/` selects Frame or Solid study types.
- `/frame3d/frame/` preserves the existing Rust/WebAssembly space-frame application.
- `/frame3d/solid/` is a separate React/Three.js Beta workbench shell.
- Beam EC3 remains at `/beam/`; its formula engine and public API routes are unchanged.
- Solid geometry, meshing and solution are server-authoritative. There is no JavaScript solid-solver fallback.

## Authoritative data

`packages/cad-fem-schema` defines the versioned `CadFEMProject` contract independently of `Frame3DModel`. It includes part documents, assemblies, persistent topology references, solid studies, immutable job manifests and result manifests. Internal units are N, mm, N/mm², N·mm and kg/mm³.

PostgreSQL stores project ownership, revisions, commands, studies, jobs, artifacts and identity mappings. Commands and jobs are idempotent. R2 stores immutable STEP files, OCAF documents, B-reps, topology metadata, tessellations, meshes, logs and result fields.

## Native proof pipeline

`services/cad-fem-native` contains a C++20/CMake container build with pinned sources and licence inventory:

1. OCCT/OCAF imports STEP and persists the document, B-rep, topology metadata and authoritative tessellation.
2. Netgen creates a tetrahedral volume mesh.
3. MFEM performs a Float64 linear-elastic solve using quadratic displacement elements by default.
4. Results include displacement, stress/von Mises fields, reactions, strain energy and equilibrium diagnostics.
5. An optional MFEM/Tribol frictionless mortar-contact patch target is included but is not enabled in the default image.

The native CTest pipeline generates an axial-bar STEP input, meshes it and requires displacement error at or below 1% plus normalised equilibrium residual at or below `1e-8`.

## Compute and gateway

Cloudflare Pages remains the static host. Cloudflare Access and the Worker form the public CAD/FEM gateway. A private ECS Fargate API service is reached through Cloudflare Tunnel; RDS PostgreSQL stores metadata and AWS Batch on Fargate executes native jobs in `eu-west-2`.

Job input and output prefixes are immutable. The API supports cancellation and reconciles Batch state, but never treats Batch success alone as a completed stage or converged analysis. Native geometry/mesh jobs report success without a convergence claim; solve jobs additionally require native convergence metadata.

## Deliberate gates

- Arbitrary Solid-mode solves are rejected in this spike. Only the named axial-bar verification profile, exact approved material/load/mesh settings and a configured reviewed STEP SHA-256 are accepted.
- A new project can be created and inspected but cannot be solved until it has geometry, a material assignment, a support and a load.
- Poisson ratio `ν >= 0.49` is rejected and `ν > 0.45` is warned.
- Nonlinear contact results cannot be described as complete unless the native convergence manifest says so.
- No production deployment, DNS change or secret creation is included.

## Verification state

TypeScript, schema, service, route and Terraform validation run locally. The workstation used for this branch does not have Docker, CMake, Ninja or the pinned native dependencies, so the OCCT/Netgen/MFEM container and its benchmark must run in CI. Until that passes, the UI remains visibly labelled Beta and the project must not claim verified solid or contact results.

Later workbench, assembly/meshing, solid-linear and contact branches start only after this spike is reviewed and merged.
