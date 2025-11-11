import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });

/**
 * Drizzle ORM 組態檔：定義遷移輸出、Schema 路徑與資料庫連線資訊。
 */
export default defineConfig({
  out: "./db/migrations",
  schema: "./db/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://mac:uqlkss@0217@localhost:5432/happy_learner",
  },
  verbose: true,
  strict: true,
});