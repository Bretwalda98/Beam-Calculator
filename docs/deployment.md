# Deployment

## Local Development

```bash
npm start
```

Open `http://127.0.0.1:4173/`.

The root `index.html` is now a backend API client. It does not load the old public `sections_database.js` file and does not run the protected solver in the browser.

## Frontend Build

```bash
npm run build:frontend
```

Set `BEAM_API_BASE_URL` when building a static package for GitHub Pages or another static host:

```bash
BEAM_API_BASE_URL=https://your-backend.example.com npm run build:frontend
```

Production source maps are not generated. `npm run security:bundle-check` fails if protected solver names, report generators, `PROFILE_DB`, or `sections_database.js` appear in the public static files.

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

For GitHub Pages, keep the frontend static and deploy the API separately on a Node-capable HTTPS host such as Render, Fly.io or Railway. Configure the backend `ALLOWED_ORIGINS` to include `https://bretwalda98.github.io`.

## HTTPS

Terminate TLS at the platform load balancer or reverse proxy. Redirect HTTP to HTTPS. Set HSTS at the edge after the domain is stable.

## Database

Use PostgreSQL and apply `backend/db/schema.sql`. The JSON store is for local development only.

## Backups

Back up PostgreSQL with point-in-time recovery. Back up object storage with versioning and retention locks for enterprise tenants.
