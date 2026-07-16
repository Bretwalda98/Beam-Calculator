# Security Model

## Implemented

- Engineering calculations run on the backend.
- Section and material data are server-side only.
- Public static serving explicitly blocks `backend`, `storage`, and section database paths.
- Security headers include CSP, frame blocking, MIME sniffing protection, referrer policy, and permissions policy.
- API rate limiting is applied by route/IP bucket.
- JSON request size is capped.
- Authenticated project endpoints enforce a server session check.
- OAuth setup does not fake login when secrets are missing.
- Project storage isolates records by authenticated user id.
- Errors sent to users avoid stack traces.
- CAD/FEM public routes validate Cloudflare Access JWTs against the configured remote JWKS and audience.
- The Worker removes browser-supplied identity headers and injects its own identity plus a shared gateway token.
- The private ECS API rejects CAD/FEM requests without the configured gateway token and resolves the Access subject to an owner record.
- CAD/FEM commands, jobs and artifacts are owner-scoped in PostgreSQL.
- R2 upload and download URLs are short-lived; native jobs use immutable input/output prefixes.
- Native job retries are disabled in the platform spike and duplicate job IDs are idempotent.

## Remaining Production Setup

- Configure HTTPS/TLS at the reverse proxy or hosting layer.
- Set `NODE_ENV=production`.
- Set a strong `SESSION_SECRET`.
- Configure Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- Configure Apple OAuth: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_REDIRECT_URI`.
- Apply and verify the PostgreSQL migrations in the isolated staging environment.
- Add audit-log writes for every project, auth, license, and account deletion action.
- Add CSRF tokens for browser-mutating routes before public deployment.
- Add dependency scanning, SAST, SBOM generation and container image scanning in CI.
- Complete threat modelling, Cloudflare Access policy review, quota abuse testing and signed-URL leakage testing before a public Solid-mode release.

## Security Audit Findings From Legacy App

- Legacy frontend exposed calculation algorithms and section data in browser JavaScript.
- Legacy localStorage project saves were not account-bound.
- Legacy sign-in placeholders could be mistaken for authentication.
- Legacy PDF/report generation ran in the browser.

Those surfaces have been moved behind the backend boundary or replaced with non-fake setup gates.
