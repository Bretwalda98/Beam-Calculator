# Deployment

## Local Development

```bash
npm start
```

Run `npm run build:frontend`, then open:

- `http://127.0.0.1:4173/` for tool selection
- `http://127.0.0.1:4173/beam/` for Beam EC3
- `http://127.0.0.1:4173/frame3d/` for 3D project/study selection
- `http://127.0.0.1:4173/frame3d/frame/` for the existing 3D Frame Analysis
- `http://127.0.0.1:4173/frame3d/solid/` for the Solid FEM Beta workbench

The Beam EC3 document is a backend API client at `/beam/`. It does not load the old public `sections_database.js` file and does not run the protected Beam solver in the browser.

## Frontend Build

```bash
npm run build:frontend
```

The repository includes the generated Rust/WebAssembly package used by the Frame3D Vite build, so an existing Node-only Cloudflare Pages build remains supported. To rebuild and verify that package, install Rust, the `wasm32-unknown-unknown` target and `wasm-pack`, then run:

```bash
npm run build:verified
```

Set `BEAM_API_BASE_URL` when building a static package for GitHub Pages or another static host:

```bash
BEAM_API_BASE_URL=https://your-backend.example.com npm run build:frontend
```

For a static Frame/Solid preview, set `VITE_API_BASE_URL` to the matching preview Worker as well. This keeps both the stable branch alias and the unique Pages deployment URL on the same isolated API:

```bash
BEAM_API_BASE_URL=https://preview-api.example.com VITE_API_BASE_URL=https://preview-api.example.com npm run build:frontend
```

Cloudflare's Git build sets `CF_PAGES_BRANCH`. For the exact `codex/fea-platform-spike` branch, the build resolves both API bases to the isolated `codex-fea-platform-spike-beam-calculator-api` Worker automatically. Explicit `BEAM_API_BASE_URL` and `VITE_API_BASE_URL` settings still take precedence. Other branches, including `main`, retain the default same-origin behaviour.

Production source maps are not generated. `npm run security:bundle-check` fails if protected solver names, report generators, `PROFILE_DB`, or `sections_database.js` appear in the public static files.

Cloudflare Pages publishes `dist/`. The `_redirects` file canonicalises `/beam`, `/frame3d`, `/frame3d/frame`, `/frame3d/solid` and `/privacy` to their directory routes. The generated `_headers` file grants WebAssembly compilation only below `/frame3d/`. The API Worker remains separate; all existing `/api/...` routes are preserved and the read-only `/api/frame3d/sections` plus authenticated `/api/cad/...`, `/api/fea/...` and `/api/jobs/...` routes are additive.

## Environment

Required for production:

- `NODE_ENV=production`
- `PORT`
- `SESSION_SECRET`
- `ALLOWED_ORIGINS`
- Google OAuth variables
- Apple OAuth variables
- Database connection variables for PostgreSQL
- Object storage credentials for uploaded logos/files, if enabled

Solid-mode staging additionally requires:

- `DATABASE_URL` or split PostgreSQL connection variables
- `CAD_FEM_DATABASE_CA_PATH` for the reviewed AWS RDS trust bundle when TLS is enabled
- `CAD_FEM_GATEWAY_TOKEN`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `CAD_FEM_ORIGIN_URL` when the Worker proxies through Cloudflare Tunnel
- AWS Batch region, queue and job definition
- R2 endpoint, bucket, access key and secret
- `CAD_FEM_VERIFICATION_STEP_SHA256` for the reviewed axial-bar fixture

## Cloudflare Worker API

The Cloudflare Worker backend is configured by `wrangler.toml`:

```toml
name = "beam-calculator-api"
main = "src/worker.mjs"
compatibility_date = "2026-06-28"
compatibility_flags = ["nodejs_compat"]
```

Run locally:

```bash
npm run worker:dev
```

Deploy:

```bash
npm run worker:deploy
```

### Production release gate

Cloudflare production promotion is deliberately manual while the CAD/FEM programme is in staged development:

- Pages keeps preview deployments enabled but has automatic production-branch deployments disabled.
- The production Worker build trigger runs `npx wrangler versions upload`, which creates a reviewable version without changing the active deployment.
- Merging to `main` must therefore build and preserve evidence without publishing a new production frontend or Worker.

After the required security, cost, load and independent engineering reviews approve a release, an authorised maintainer may explicitly deploy the reviewed commit. Re-enabling automatic production deployment is not required. If automatic deployment is intentionally restored, use Cloudflare Pages **Settings → Builds → Branch control** and set the Worker production trigger deploy command back to `npm run worker:deploy`. Verify the active Pages deployment and Worker version before and after either change.

Required live API URL:

```text
https://beam-calculator-api.harrynixon98.workers.dev
```

The Cloudflare Pages frontend defaults to this API base URL when hosted at `https://beam-calculator.pages.dev` or `https://beamcalculatorstudio.com`. Solid mode uses same-origin absolute `/api/...` paths so Cloudflare Access and the Worker gateway remain in the request path.

## HTTPS

Terminate TLS at the platform load balancer or reverse proxy. Redirect HTTP to HTTPS. Set HSTS at the edge after the domain is stable.

## Database

Use PostgreSQL and run `npm run db:migrate`. The command applies `backend/db/schema.sql` and ordered migrations under `backend/db/migrations/`, recording checksums. The JSON store is for local development only and is rejected for production Solid-mode paths.

## Isolated CAD/FEM staging

`infra/aws/staging` defines a private ECS Fargate API service with a `cloudflared` sidecar, encrypted RDS PostgreSQL 16 and AWS Batch on Fargate in `eu-west-2`. The native Batch image reads immutable job inputs from R2 and writes status, logs, meshes and result manifests back to R2.

The Terraform requires immutable API, native and `cloudflared` image references. It has been formatted and validated locally, but no plan, apply, secret creation, DNS change or production deployment is part of this branch.

## Backups

Back up PostgreSQL with point-in-time recovery. Back up object storage with versioning and retention locks for enterprise tenants.
