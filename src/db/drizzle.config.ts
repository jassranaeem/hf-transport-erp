import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Match the runtime loader: .env.local overrides nothing already set, then .env.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;

// Prefer a single connection string when available (docker-compose / hosted DB).
const dbCredentials = databaseUrl
  ? {
      url: databaseUrl,
      ssl:
        process.env.DATABASE_SSL === "true" ||
        /[?&]sslmode=(require|verify-ca|verify-full)/.test(databaseUrl)
          ? { rejectUnauthorized: false }
          : false,
    }
  : (() => {
      const sqlHost = process.env.SQL_HOST;
      const sqlDbName = process.env.SQL_DB_NAME;
      // Migrations may need elevated rights; fall back to the app user if no admin set.
      const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER;
      const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;

      if (!sqlHost || !sqlDbName || !user || !password) {
        throw new Error(
          "Database config missing. Set DATABASE_URL, or SQL_HOST + SQL_DB_NAME + " +
            "SQL_ADMIN_USER/SQL_USER + SQL_ADMIN_PASSWORD/SQL_PASSWORD in .env.local."
        );
      }

      return {
        host: sqlHost,
        port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
        user,
        password,
        database: sqlDbName,
        ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
      };
    })();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials,
  verbose: true,
});
