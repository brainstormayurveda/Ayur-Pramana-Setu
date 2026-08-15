import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

function extractIcd10Category(conditionText) {
  if (!conditionText) return null;
  const m = conditionText.match(/\b([A-Z]\d{2})\d*\s*-/);
  return m ? m[1] : null;
}

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const client = new Client({
  connectionString: `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query("select ctri_id, condition from trials_raw where condition is not null and condition_icd10_category is null");
let updated = 0;
for (const row of rows) {
  const category = extractIcd10Category(row.condition);
  if (category) {
    await client.query("update trials_raw set condition_icd10_category = $1 where ctri_id = $2", [category, row.ctri_id]);
    updated++;
  }
}
console.log(`Backfilled condition_icd10_category for ${updated}/${rows.length} rows.`);
await client.end();
