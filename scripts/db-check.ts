import { db } from "../src/db/index.ts";
import { users } from "../src/db/schema.ts";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Checking database connection...");
  try {
    const result = await db.select().from(users).limit(1);
    console.log("Database connection successful. Existing user count: ", result.length);
    process.exit(0);
  } catch (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }
}

main();
