#!/bin/bash
set -e

PROJECT_ID="your-gcp-project-id"
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
  --set-secrets "DATABASE_URL=axis-bloom-secrets:DATABASE_URL:latest,ANTHROPIC_API_KEY=axis-bloom-secrets:ANTHROPIC_API_KEY:latest,SHOPIFY_STORE_DOMAIN=axis-bloom-secrets:SHOPIFY_STORE_DOMAIN:latest,SHOPIFY_STOREFRONT_TOKEN=axis-bloom-secrets:SHOPIFY_STOREFRONT_TOKEN:latest,SHOPIFY_ADMIN_TOKEN=axis-bloom-secrets:SHOPIFY_ADMIN_TOKEN:latest,FIREBASE_PROJECT_ID=axis-bloom-secrets:FIREBASE_PROJECT_ID:latest,FIREBASE_PRIVATE_KEY=axis-bloom-secrets:FIREBASE_PRIVATE_KEY:latest,FIREBASE_CLIENT_EMAIL=axis-bloom-secrets:FIREBASE_CLIENT_EMAIL:latest"

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
