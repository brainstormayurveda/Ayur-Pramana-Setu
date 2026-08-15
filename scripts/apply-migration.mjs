import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD;

if (!password) {
  console.error("SUPABASE_DB_PASSWORD not set in .env.local");
  process.exit(1);
}

const encodedPassword = encodeURIComponent(password);
const candidates = [
  `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encodedPassword}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
];

const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

let client;
let connected = false;
for (const connectionString of candidates) {
  const c = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await c.connect();
    console.log(`Connected via: ${connectionString.replace(encodedPassword, "***")}`);
    client = c;
    connected = true;
    break;
  } catch (err) {
    console.log(`Failed (${connectionString.split("@")[1]}): ${err.message}`);
    try { await c.end(); } catch {}
  }
}

if (!connected) {
  console.error("\nCould not connect via any candidate host/pooler combination.");
  process.exit(1);
}

try {
  await client.query(`
    create table if not exists _migrations (
      filename text primary key,
      applied_at timestamptz default now()
    );
  `);
  const { rows: appliedRows } = await client.query("select filename from _migrations");
  const applied = new Set(appliedRows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied).`);
      continue;
    }
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await client.query(sql);
    await client.query("insert into _migrations (filename) values ($1)", [file]);
    console.log(`Applied ${file}.`);
  }
  console.log("All migrations applied.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
