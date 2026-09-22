import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export const createPool = () => {
  const common = {
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    max: 10,
    keepAlive: true,
  };

  // Preferred: a single DATABASE_URL (what docker-compose, Cloud Run and most
  // hosts provide). Falls back to the discrete SQL_* vars used by AI Studio.
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const wantsSsl =
      process.env.DATABASE_SSL === "true" ||
      /[?&]sslmode=(require|verify-ca|verify-full)/.test(connectionString);
    return new Pool({
      connectionString,
      ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
      ...common,
    });
  }

  return new Pool({
    host: process.env.SQL_HOST,
    port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    ...common,
  });
};

// Create a single, long-lived Pool instance
export const pool = createPool();

// Handle errors on idle clients in the pool to prevent unhandled exceptions
pool.on("error", (err) => {
  console.error("[Database Pool Error] Unexpected error on idle client:", err.message || err);
});

// Self-healing proxy pool that transparently retries on connection failures (e.g. EPIPE, connection terminated)
const proxyPool = {
  connect: async () => {
    let attempts = 0;
    const maxAttempts = 15; // Retrying up to 15 times allows us to evict up to 10 dead pool clients and establish a fresh one
    let delay = 10;

    while (true) {
      try {
        return await pool.connect();
      } catch (err: any) {
        attempts++;
        const errMsg = (err.message || "").toLowerCase();
        const errCode = (err.code || "").toString().toUpperCase();
        const isConnectionError = 
          errMsg.includes("terminated") || 
          errMsg.includes("closed") || 
          errMsg.includes("connection") || 
          errMsg.includes("pool") ||
          errMsg.includes("timeout") ||
          errMsg.includes("end") ||
          errMsg.includes("epipe") ||
          errMsg.includes("econnreset") ||
          errMsg.includes("econnrefused") ||
          errMsg.includes("socket") ||
          errMsg.includes("bad file descriptor") ||
          errCode === "EPIPE" ||
          errCode === "ECONNRESET" ||
          errCode === "ECONNREFUSED" ||
          errCode === "ETIMEDOUT" ||
          errCode === "57P01" || 
          errCode === "57P02" || 
          errCode === "57P03";

        if (isConnectionError && attempts < maxAttempts) {
          console.warn(`[Database Autorecovery] Connection checkout failed: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempts}/${maxAttempts})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 1000);
          continue;
        }
        throw err;
      }
    }
  },
  query: async (queryText: string, values?: any[]) => {
    let attempts = 0;
    const maxAttempts = 15;
    let delay = 10;

    while (true) {
      try {
        return await pool.query(queryText, values);
      } catch (err: any) {
        attempts++;
        const errMsg = (err.message || "").toLowerCase();
        const errCode = (err.code || "").toString().toUpperCase();
        const isConnectionError = 
          errMsg.includes("terminated") || 
          errMsg.includes("closed") || 
          errMsg.includes("connection") || 
          errMsg.includes("pool") ||
          errMsg.includes("timeout") ||
          errMsg.includes("end") ||
          errMsg.includes("epipe") ||
          errMsg.includes("econnreset") ||
          errMsg.includes("econnrefused") ||
          errMsg.includes("socket") ||
          errMsg.includes("bad file descriptor") ||
          errCode === "EPIPE" ||
          errCode === "ECONNRESET" ||
          errCode === "ECONNREFUSED" ||
          errCode === "ETIMEDOUT" ||
          errCode === "57P01" || 
          errCode === "57P02" || 
          errCode === "57P03";

        if (isConnectionError && attempts < maxAttempts) {
          console.warn(`[Database Autorecovery] Query execution failed: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempts}/${maxAttempts})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 1000);
          continue;
        }
        throw err;
      }
    }
  },
  on: (event: any, handler: any) => {
    pool.on(event, handler);
  },
  end: async () => {
    return pool.end();
  }
};

export const db = drizzle(proxyPool as any, { schema });
export { schema };
