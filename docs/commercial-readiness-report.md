# Commercial Readiness Report

## Files Modified Or Added

- `server.js`
- `index.html`
- `public/app.js`
- `public/styles.css`
- `backend/config.js`
- `backend/auth/auth-service.js`
- `backend/data/materials.js`
- `backend/data/sections-database.js`
- `backend/services/calculation-service.js`
- `backend/services/sections-service.js`
- `backend/services/project-service.js`
- `backend/services/pdf-service.js`
- `backend/middleware/http.js`
- `backend/db/schema.sql`
- `backend/legacy/legacy-index.html`
- `docs/*.md`

## Security Improvements

- Removed calculation algorithms from the public browser client.
- Removed beam section database from public serving.
- Added API security headers and rate limiting.
- Added server-side request validation and error handling.
- Added authenticated project API boundaries.
- Added server-side PDF generation.
- Added OAuth setup gates that do not fake authentication.

## Remaining Setup Required

- OAuth credentials and callback domains.
- Production HTTPS and HSTS.
- PostgreSQL implementation of `schema.sql`.
- Production PDF renderer if branded visual reports require company logos and diagrams beyond the current server PDF.
- License/subscription provider integration.
- CI security scanning.

## Future Recommendations

- Add golden-master tests comparing the server engine against archived legacy outputs for all support/load combinations.
- Finish continuous multi-span migration in the server calculation service.
- Add a typed API schema such as OpenAPI.
- Add tenant-aware company/team sharing.
- Add audit-log writes and admin review tools.
