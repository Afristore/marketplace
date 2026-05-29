# Database Migration Automation

This document outlines the automated database migration workflow, rollback strategies, and failure recovery processes for the Prisma-based indexer.

## Migration Workflow

1. **Deployment Phase**: During deployment (e.g., on Vercel, Railway, or standard Node environments), the dependencies are installed via `npm ci`.
2. **Build Phase**: The Prisma client is generated during the build step (`npm run build`).
3. **Pre-start Phase**: Before the application starts, `npx prisma migrate deploy` is executed automatically (configured via the `prestart` script in `package.json`).
4. **Health Check**: The migration command will fail and exit with a non-zero status code if the database cannot be reached or the migration fails. This prevents the application from starting with an incompatible schema.

## Migration Health Checks

The automated process relies on Prisma's built-in migration deployment mechanisms.
- **Pre-deployment Verification**: You can verify the status of migrations using `npx prisma migrate status`.
- **Application Startup Block**: The `prestart` script guarantees that `npx prisma migrate deploy` finishes successfully before `node dist/index.js` runs. If `npx prisma migrate deploy` fails, the deployment pipeline or container runtime will catch the failure and block the new release from taking live traffic.

## Rollback Strategy

If a migration fails during deployment:
1. **Identify the Issue**: Check the deployment logs to identify which migration failed.
2. **Revert the Code**: Revert the pull request or commit that introduced the faulty migration to restore the previous application state and schema definitions.
3. **Resolve DB State**: If the database is in a partially migrated state, you may need to use `npx prisma migrate resolve --rolled-back "MIGRATION_NAME"` after manually reverting the schema changes in the database.

## Failure Recovery Process

1. **Database Lock Issues**: If a migration is interrupted, Prisma might leave a lock on the database. Resolve this by checking the `_prisma_migrations` table and manually updating the status or dropping the failed migration record.
2. **Data Corruption**: Ensure regular automated backups of the PostgreSQL database are taken before each deployment. In case of irreversible data corruption during migration, restore from the latest snapshot.
3. **Application Downgrade**: To roll back the application version, ensure the database schema is backwards compatible with the older version. If it is not, restore the database backup matching the older application version.
