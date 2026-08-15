import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

const STOPWORDS = new Set([
  "the", "and", "for", "score", "scale", "index", "questionnaire", "assessment",
  "quality", "life", "health", "survey", "rating", "measure", "outcome",
  "clinical", "symptom", "severity",
]);

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function matchInstrument(outcomeName, instruments) {
  const outcomeUpperNormalized = outcomeName.toUpperCase().replace(/[-_]/g, " ");
  for (const instrument of instruments) {
    const idAsWords = instrument.instrument_id.replace(/[-_]/g, " ");
    if (outcomeUpperNormalized.includes(idAsWords)) return instrument.instrument_id;
  }
  const outcomeTokens = new Set(normalize(outcomeName));
  if (outcomeTokens.size === 0) return null;
  let best = null;
  for (const instrument of instruments) {
    const nameTokens = new Set(normalize(instrument.instrument_full_name));
    if (nameTokens.size === 0) continue;
    const overlap = [...nameTokens].filter((t) => outcomeTokens.has(t)).length;
    if (overlap < 2) continue;
    const score = overlap / Math.min(nameTokens.size, outcomeTokens.size);
    if (score > 0.6 && (!best || score > best.score)) best = { id: instrument.instrument_id, score };
  }
  return best?.id ?? null;
}

const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const client = new Client({
  connectionString: `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: instruments } = await client.query("select instrument_id, instrument_full_name from instrument_reference");
const { rows: outcomes } = await client.query("select id, outcome_name, matched_instrument_id from trial_outcomes");

let changed = 0;
for (const o of outcomes) {
  const newMatch = matchInstrument(o.outcome_name, instruments);
  if (newMatch !== o.matched_instrument_id) {
    await client.query("update trial_outcomes set matched_instrument_id = $1 where id = $2", [newMatch, o.id]);
    console.log(`${o.outcome_name.slice(0, 60)} : ${o.matched_instrument_id} -> ${newMatch}`);
    changed++;
  }
}
console.log(`\nRe-matched ${changed}/${outcomes.length} outcome rows.`);
await client.end();
