import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", override: true });
config({ path: ".env", override: false });

/**
 * Drizzle ORM 組態檔：定義遷移輸出、Schema 路徑與資料庫連線資訊。
 */
const resolvedDatabaseUrl =
  // Prefer an explicit TEST_DATABASE_URL when running tests or CI to avoid
  // accidentally applying migrations to the development database.
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  "postgres://user:password@localhost:5432/happy_learner";

/**
 * 產生遮罩後的連線字串，便於偵錯時確認實際指向的資料庫而不洩漏敏感資訊。
 * @returns {string} 已遮罩或無法解析的連線字串
 */
const redactedDatabaseUrl = (() => {
  try {
    const url = new URL(resolvedDatabaseUrl);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "[unparsable-url]";
  }
})();

console.info("[drizzle-config] Resolved database URL:", redactedDatabaseUrl);

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: resolvedDatabaseUrl,
  },
  verbose: true,
  strict: true,
});
