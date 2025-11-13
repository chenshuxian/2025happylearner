const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    console.log("PG CONNECTED");
    await c.query("BEGIN");
    console.log("BEGIN transaction");
    await c.query("CREATE TABLE IF NOT EXISTS dev_conn_test (id SERIAL PRIMARY KEY, note TEXT, created_at TIMESTAMP DEFAULT now())");
    console.log("CREATE TABLE IF NOT EXISTS executed");
    const insert = await c.query("INSERT INTO dev_conn_test (note) VALUES ($1) RETURNING id, created_at", ["test from script"]);
    console.log("INSERT OK:", insert.rows);
    const sel = await c.query("SELECT id, note, created_at FROM dev_conn_test ORDER BY id DESC LIMIT 1");
    console.log("SELECT OK:", sel.rows);
    await c.query("ROLLBACK");
    console.log("ROLLED BACK transaction (no DB changes persisted)");
    await c.end();
    console.log("PG DISCONNECTED");
    process.exit(0);
  } catch (e) {
    console.error("DB ERROR:");
    console.error(e);
    try { await c.end(); } catch {}
    process.exit(2);
  }
})();