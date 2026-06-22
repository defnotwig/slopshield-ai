import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { PrismaClient } from "@prisma/client";

/**
 * Migration / connection integration test.
 *
 * Validates:
 *   - Requirement 4.3: `prisma migrate deploy` against an empty Postgres
 *     applies every migration under `apps/api/prisma/migrations` successfully.
 *   - Requirement 4.4: the API connects to the database with a valid
 *     `DATABASE_URL` (a `PrismaClient.$connect()` succeeds against the freshly
 *     migrated database).
 *
 * Strategy: against a reachable Postgres, create a throwaway database, run the
 * real Prisma CLI `migrate deploy` against it, then assert that the
 * `_prisma_migrations` ledger contains exactly the migrations on disk and that
 * the expected tables exist. Finally, prove `$connect()` succeeds with the
 * valid `DATABASE_URL`. The throwaway database is dropped in cleanup.
 *
 * Environment gating: DB-dependent like the rest of the suite. When no Postgres
 * is reachable (no `DATABASE_URL`/docker-compose Postgres in this environment),
 * the test logs a clear skip message and no-ops, while remaining fully runnable
 * in CI or locally where the docker-compose Postgres (localhost:5433) is up.
 */

// Default matches docker-compose.yml / .env.example (localhost:5433).
const DEFAULT_DB_URL =
  "postgresql://slopshield:slopshield_dev@localhost:5433/slopshield?schema=public";

const baseUrl = process.env.DATABASE_URL ?? DEFAULT_DB_URL;

// Resolve the Prisma CLI entry point so we can invoke it cross-platform via
// `node <cli> migrate deploy` without relying on a shell or pnpm.
const prismaCli = path.join(
  path.dirname(require.resolve("prisma/package.json")),
  "build",
  "index.js",
);

// Schema lives at apps/api/prisma/schema.prisma (this file is in apps/api/src/prisma).
const schemaPath = path.resolve(
  __dirname,
  "..",
  "..",
  "prisma",
  "schema.prisma",
);
const migrationsDir = path.resolve(
  __dirname,
  "..",
  "..",
  "prisma",
  "migrations",
);

/** Names of the migrations on disk (the source of truth for the DB schema). */
function migrationsOnDisk(): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Replace the database name (path segment) of a Postgres URL, keeping query params. */
function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

/** Quick reachability probe: can we open a Prisma connection to `baseUrl`? */
async function isPostgresReachable(): Promise<boolean> {
  const probe = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  try {
    await probe.$connect();
    await probe.$queryRawUnsafe("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect().catch(() => undefined);
  }
}

describe("prisma migrate deploy + connection (integration, Requirements 4.3, 4.4)", () => {
  let dbAvailable = false;
  let throwawayDb = "";
  let throwawayUrl = "";
  let admin: PrismaClient;

  beforeAll(async () => {
    dbAvailable = await isPostgresReachable();
    if (!dbAvailable) {
      // eslint-disable-next-line no-console
      console.warn(
        `[migrate-deploy.int] SKIPPED: no Postgres reachable at ${
          new URL(baseUrl).host
        }. Start docker-compose (postgres on 5433) or set DATABASE_URL to run this test.`,
      );
      return;
    }

    // A unique, valid identifier (letters/digits/underscores only).
    throwawayDb = `slopshield_mig_test_${Date.now()}_${Math.floor(
      Math.random() * 1e6,
    )}`;
    throwawayUrl = withDatabaseName(baseUrl, throwawayDb);

    // Connect to the existing (maintenance) database to issue CREATE DATABASE.
    admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
    await admin.$connect();
    // CREATE DATABASE cannot run inside a transaction; $executeRawUnsafe issues
    // it as a standalone statement. Identifier is generated locally (no injection).
    await admin.$executeRawUnsafe(`CREATE DATABASE "${throwawayDb}"`);
  });

  afterAll(async () => {
    if (dbAvailable && admin && throwawayDb) {
      // FORCE terminates any lingering connections (Postgres 13+).
      await admin
        .$executeRawUnsafe(
          `DROP DATABASE IF EXISTS "${throwawayDb}" WITH (FORCE)`,
        )
        .catch(() => undefined);
    }
    await admin?.$disconnect().catch(() => undefined);
  });

  it("applies every on-disk migration via `prisma migrate deploy` (Requirement 4.3)", async () => {
    if (!dbAvailable) return; // environment-gated skip (message logged in beforeAll)

    const expected = migrationsOnDisk();
    expect(expected.length).toBeGreaterThan(0);

    // Run the real Prisma CLI against the throwaway database. Throws (failing
    // the test) on a non-zero exit, surfacing the migration error output.
    let output = "";
    try {
      output = execFileSync(
        process.execPath,
        [prismaCli, "migrate", "deploy", "--schema", schemaPath],
        {
          env: { ...process.env, DATABASE_URL: throwawayUrl },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
      throw new Error(
        `prisma migrate deploy failed:\n${String(e.stdout ?? "")}\n${String(
          e.stderr ?? "",
        )}`,
      );
    }

    // Prisma reports success in its stdout; tolerate the "already in sync" wording too.
    expect(output).toMatch(/migrat/i);

    // Assert the migration ledger records exactly the on-disk migrations, all applied.
    const migrated = new PrismaClient({
      datasources: { db: { url: throwawayUrl } },
    });
    try {
      const rows = await migrated.$queryRawUnsafe<
        { migration_name: string; finished_at: Date | null }[]
      >(
        `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name`,
      );
      const appliedNames = rows.map((r) => r.migration_name).sort();
      expect(appliedNames).toEqual(expected);
      // Every applied migration must have a finished_at (no failed/rolled-back rows).
      expect(rows.every((r) => r.finished_at !== null)).toBe(true);

      // Spot-check that the schema's core tables now exist.
      const tables = await migrated.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tableNames = tables.map((t) => t.table_name);
      for (const expectedTable of [
        "users",
        "projects",
        "scan_jobs",
        "scan_files",
        "findings",
        "rules",
        "lark_events",
        "fix_tasks",
        "project_members",
        "notification_settings",
      ]) {
        expect(tableNames).toContain(expectedTable);
      }
    } finally {
      await migrated.$disconnect().catch(() => undefined);
    }
  });

  it("establishes a connection with a valid DATABASE_URL (Requirement 4.4)", async () => {
    if (!dbAvailable) return; // environment-gated skip

    // Use a PrismaClient exactly as the API does at boot, pointed at the
    // freshly migrated throwaway database via a valid DATABASE_URL.
    const client = new PrismaClient({
      datasources: { db: { url: throwawayUrl } },
    });
    try {
      await expect(client.$connect()).resolves.toBeUndefined();
      // A trivial query proves the connection is live and usable.
      const result =
        await client.$queryRawUnsafe<{ ok: number }[]>("SELECT 1 as ok");
      expect(result[0].ok).toBe(1);
      // The migrated schema is queryable (no rows expected in a fresh DB).
      const userCount = await client.user.count();
      expect(userCount).toBe(0);
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  });
});
