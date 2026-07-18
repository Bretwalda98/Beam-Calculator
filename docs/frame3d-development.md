# Frame3D development

## Prerequisites

- Node.js 20 or later;
- Rust stable;
- the `wasm32-unknown-unknown` Rust target;
- `wasm-pack`;
- a supported native linker for Rust build scripts.

Install JavaScript dependencies:

```bash
npm install
```

## Commands

```bash
npm run check:frame3d   # TypeScript type checking
npm run check:rust      # rustfmt check and clippy with warnings denied
npm run test:frame3d    # Rust unit tests and compiled-WASM verification
npm run build:wasm      # regenerate wasm-bindgen package
npm run build:frame3d   # Vite production bundle
npm run build:verified  # regenerate WASM and build the complete static site
npm run check           # existing repository checks plus Frame3D TypeScript
npm run smoke           # existing Beam regression suite and route smoke
```

`npm run build:frontend` intentionally consumes the committed generated WASM package so the current Cloudflare Pages build remains Node-only. When Rust code changes, run `npm run build:verified` and commit the regenerated files in `apps/frame3d/src/wasm`.

## Development routing

Build the static files and run the existing server:

```bash
npm run build:frontend
npm start
```

Routes:

- `/` tool selection;
- `/beam/` Beam EC3;
- `/frame3d/` Frame3D;
- `/api/...` existing APIs;
- `/api/frame3d/sections` read-only section snapshots.

## Dependencies and licences

- Vite and TypeScript are development/build dependencies.
- `wasm-bindgen` is MIT/Apache-2.0.
- `serde` and `serde_json` are MIT/Apache-2.0.
- `nalgebra` is Apache-2.0.

No model data is sent to analytics or external services. Analysis requires no network request.

## Version-1 limitations and planned next stages

Version 1 supports prismatic 3D frame members, nodal restraints, nodal force/moment cases and linear combinations. Planned work includes a graphical modeller, member loads, releases, springs, offsets, second-order analysis and design-code checks. Plates, shells, solids and contact are outside the frame-solver architecture.
