#!/bin/bash
set -e

PROJECT_ID="axis-and-bloom-prod"
REGION="us-central1"
REPO="axis-bloom"

echo "=== Axis & Bloom Deploy ==="

# Build and push backend
echo "Building backend..."
gcloud builds submit ./backend \
  --tag gcr.io/$PROJECT_ID/$REPO-backend:latest \
  --project $PROJECT_ID

# Deploy backend to Cloud Run
echo "Deploying backend to Cloud Run..."
gcloud run deploy axis-bloom-backend \
  --image gcr.io/$PROJECT_ID/$REPO-backend:latest \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-secrets "DATABASE_URL=APP_DATABASE_URL:latest,OWNER_DATABASE_URL=OWNER_DATABASE_URL:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,SHOPIFY_STORE_DOMAIN=SHOPIFY_STORE_DOMAIN:latest,SHOPIFY_STOREFRONT_TOKEN=SHOPIFY_STOREFRONT_TOKEN:latest,SHOPIFY_ADMIN_TOKEN=SHOPIFY_ADMIN_TOKEN:latest,FIREBASE_PROJECT_ID=FIREBASE_PROJECT_ID:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest,FIREBASE_CLIENT_EMAIL=FIREBASE_CLIENT_EMAIL:latest,RESEND_API_KEY=RESEND_API_KEY:latest,MAILCHIMP_API_KEY=MAILCHIMP_API_KEY:latest,MAILCHIMP_LIST_ID=MAILCHIMP_LIST_ID:latest,CRON_SECRET=CRON_SECRET:latest,SMS_PROVIDER_ACCOUNT_SID=SMS_PROVIDER_ACCOUNT_SID:latest,SMS_PROVIDER_AUTH_TOKEN=SMS_PROVIDER_AUTH_TOKEN:latest,SMS_FROM_NUMBER=SMS_FROM_NUMBER:latest"

BACKEND_URL=$(gcloud run services describe axis-bloom-backend --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "Backend live at: $BACKEND_URL"

# Build and deploy frontend to Firebase Hosting
echo "Building frontend..."
cd frontend
VITE_API_URL=$BACKEND_URL npm run build

echo "Deploying frontend to Firebase Hosting..."
npx firebase deploy --only hosting --project $PROJECT_ID
cd ..

echo "=== Deploy complete ==="
