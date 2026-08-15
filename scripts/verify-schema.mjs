import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const connectionString = `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`;

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = await client.query(`
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name;
`);
console.log("Tables:", tables.rows.map((r) => r.table_name).join(", "));

const rls = await client.query(`
  select relname, relrowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
`);
console.log("\nRLS enabled:");
for (const row of rls.rows) console.log(`  ${row.relname}: ${row.relrowsecurity}`);

const instruments = await client.query(`select count(*) from instrument_reference;`);
console.log(`\ninstrument_reference row count: ${instruments.rows[0].count}`);

await client.end();
