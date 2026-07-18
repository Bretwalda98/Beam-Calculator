# CAD/FEM platform spike

## Status

The merged platform spike established production-shaped contracts and a reproducible native proof pipeline. The CAD workbench stage adds recoverable parametric modelling and a native sketch-kernel boundary. It is not the finished CAD product and makes no verified-solver claim.

- `/frame3d/` selects Frame or Solid study types.
- `/frame3d/frame/` preserves the existing Rust/WebAssembly space-frame application.
- `/frame3d/solid/` is a separate React/Three.js Beta workbench shell.
- Beam EC3 remains at `/beam/`; its formula engine and public API routes are unchanged.
- Solid geometry, meshing and solution are server-authoritative. There is no JavaScript solid-solver fallback.

## CAD workbench stage

Solid mode now provides line, arc and circle drafting, dimensional/geometric constraint authoring, sketch and feature trees, extrude/revolve command records, an immutable feature/revision timeline, undo/redo by server-owned snapshot restoration, STEP upload, and the existing Beam EC3 catalogue bridge. Three.js continues to render only a clearly labelled drafting preview.

The separate native `cad-fem-sketch-solve` executable uses pinned Ceres 2.2 Float64 automatic differentiation. It returns solved coordinates, residuals, Jacobian rank, degrees of freedom, kernel version and structured under-, fully- or over-constrained diagnostics. Native CTest fixtures gate all three states. The API refuses a sketch response without Ceres evidence and returns `503` when native compute is unavailable.

`packages/cad-fem-topology` defines deterministic feature-history semantic names and a conservative persistent-reference resolver. Exact semantic matches take priority; geometric/adjacency signatures are a fallback. Zero matches become broken and equal matches become ambiguous, and both states invalidate dependent features, loads, supports or contacts until explicit reselection.

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

## Beam EC3 catalogue bridge

The existing server-side Beam EC3 catalogue now exposes a constrained Solid-mode profile snapshot for all 368 production rows. Each snapshot includes the designation, family, source dimensions, analysis properties, source citation and a canonical SHA-256 catalogue revision. Saving an `appendCatalogueExtrusion` command copies that immutable snapshot into `CadFEMProject`; subsequent catalogue changes cannot silently alter saved geometry.

The browser uses the profile only for a nominal Three.js preview. A native `cad-fem-section-step` executable creates OCCT STEP geometry for one saved I-section, channel or RHS extrusion, after which the normal OCAF and Netgen stages run. This first generator uses nominal sharp-corner geometry. Root/toe radii and flange slopes remain in the snapshot and are reported as unapplied warnings in `section-generation.json`; the generated geometry is not represented as an exact catalogue shape or a verified solid solution.

AWS Batch mesh jobs may use either an uploaded, verified STEP artefact or one saved catalogue extrusion. Arbitrary catalogue-section solves remain rejected. The approved axial-bar fixture and exact hash/settings gate remain the only native solve path until the wider benchmark suite passes.

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

TypeScript, schema, service, route and Terraform validation pass locally and in CI. The workstation used for this branch does not have Docker, CMake, Ninja or the pinned native dependencies, so the native pipeline runs in the reproducible Linux CI image. CI run `29621269146` passed all eight sanitised native CTests. Its 203-node/426-tetrahedron axial-bar solve returned `0.00474927 mm` against `0.00476190 mm` analytically (0.2654% error) and a `3.9343 × 10^-11` normalised equilibrium residual, passing the named proof benchmark's 1% and `1 × 10^-8` gates.

That result verifies only the axial proof fixture and native integration path. It does not satisfy the wider bending, torsion, pressure, multi-material, mesh-convergence or contact benchmark matrix required for a verified Solid FEM release. The UI therefore remains visibly labelled Beta, arbitrary solid solves remain disabled, and the project makes no verified solid/contact product claim.

Later workbench, assembly/meshing, solid-linear and contact branches start only after this spike is reviewed and merged.
