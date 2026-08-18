#!/bin/bash
# Pushes .env.local values to Vercel production env, without exposing
# values in shell history or command output.
set -e
cd "$(dirname "$0")/.."

VARS="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_PASSWORD ANTHROPIC_API_KEY CRON_SECRET SEMANTIC_SCHOLAR_API_KEY"

for name in $VARS; do
  value=$(grep "^${name}=" .env.local | cut -d= -f2-)
  if [ -z "$value" ]; then
    echo "SKIP $name (empty)"
    continue
  fi
  # Remove existing value first (vercel env add fails if already set)
  npx vercel env rm "$name" production --yes > /dev/null 2>&1 || true
  printf '%s' "$value" | npx vercel env add "$name" production > /dev/null 2>&1
  echo "SET $name"
done
