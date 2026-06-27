# Deployment

## Local Development

```bash
npm start
```

Open `http://127.0.0.1:4173/`.

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

## HTTPS

Terminate TLS at the platform load balancer or reverse proxy. Redirect HTTP to HTTPS. Set HSTS at the edge after the domain is stable.

## Database

Use PostgreSQL and apply `backend/db/schema.sql`. The JSON store is for local development only.

## Backups

Back up PostgreSQL with point-in-time recovery. Back up object storage with versioning and retention locks for enterprise tenants.
