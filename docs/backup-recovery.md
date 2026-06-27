# Backup And Recovery Strategy

## Data Classes

- User accounts and auth provider subjects
- Company and license records
- Projects and revision history
- Calculation inputs/results
- Audit logs
- Uploaded logos and report assets

## Backup Targets

- PostgreSQL: continuous WAL archiving and daily logical dumps.
- Object storage: versioning enabled with lifecycle retention.
- Configuration: secrets stored in the deployment platform secret manager, not in git.

## Recovery Objectives

- Free/Professional: RPO 24 hours, RTO 8 hours.
- Enterprise: contract-specific RPO/RTO, typically RPO 1 hour and RTO 4 hours or better.

## Recovery Procedure

1. Freeze writes if data corruption is suspected.
2. Restore PostgreSQL to a clean point in time.
3. Restore object storage versions matching that point.
4. Rebuild derived caches.
5. Run calculation parity smoke checks.
6. Re-enable writes and record the incident in the audit log.
