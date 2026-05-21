#!/bin/bash
# Run this once after billing is enabled to store secrets in GCP Secret Manager
set -e

PROJECT_ID="axis-and-bloom-prod"

echo "=== Setting up GCP Secrets ==="

create_or_update_secret() {
  local name=$1
  local value=$2
  if gcloud secrets describe "$name" --project "$PROJECT_ID" &>/dev/null; then
    echo "$value" | gcloud secrets versions add "$name" --data-file=- --project "$PROJECT_ID"
  else
    echo "$value" | gcloud secrets create "$name" --data-file=- --project "$PROJECT_ID"
  fi
  echo "Secret $name set"
}

# Load from backend .env - fill these in before running
source ../backend/.env

create_or_update_secret "DATABASE_URL" "$DATABASE_URL"
create_or_update_secret "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
create_or_update_secret "FIREBASE_PROJECT_ID" "$FIREBASE_PROJECT_ID"
create_or_update_secret "FIREBASE_PRIVATE_KEY" "$FIREBASE_PRIVATE_KEY"
create_or_update_secret "FIREBASE_CLIENT_EMAIL" "$FIREBASE_CLIENT_EMAIL"
create_or_update_secret "SHOPIFY_STORE_DOMAIN" "$SHOPIFY_STORE_DOMAIN"
create_or_update_secret "SHOPIFY_STOREFRONT_TOKEN" "$SHOPIFY_STOREFRONT_TOKEN"
create_or_update_secret "SHOPIFY_ADMIN_TOKEN" "$SHOPIFY_ADMIN_TOKEN"

# Grant Cloud Run SA access to secrets
SA="$PROJECT_ID@appspot.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor" \
  --project "$PROJECT_ID"

echo "=== Secrets setup complete ==="
