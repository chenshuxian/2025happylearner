import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import * as schema from "./schema";

/**
 * 資料庫實例，提供 Drizzle ORM 操作。
 * 透過 Vercel Postgres 的 sql 用戶端建立連線並載入所有 schema。
 */
export const db = drizzle(sql, { schema });