const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');
const sharp = require('sharp');
const path = require('path');

const storage = new Storage();
const SKIP_EXTENSIONS = ['.svg', '.mp4']; // pass through untouched — no optimized/ copy for these
const MOBILE_MAX_WIDTH = 800;
const CACHE_CONTROL = 'public, max-age=300';

functions.cloudEvent('optimizeImage', async (cloudEvent) => {
  const data = cloudEvent.data; // gen2 storage CloudEvents deliver the object metadata directly on .data — bucket, name, contentType, size
  const bucketName = data.bucket;
  const filePath = data.name; // e.g. raw/archetypes/floral/hero.png

  if (!filePath.startsWith('raw/')) return; // ignore anything not under raw/ (avoids reprocessing our own output — required, do not remove)

  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.includes(ext)) return; // svg/video skipped — bag PNGs and all photos DO get processed below

  const bucket = storage.bucket(bucketName);
  const relativePath = filePath.slice('raw/'.length); // archetypes/floral/hero.png
  const withoutExt = relativePath.slice(0, -ext.length); // archetypes/floral/hero

  const [buffer] = await bucket.file(filePath).download();

  // Full-size WebP
  const fullWebp = await sharp(buffer).webp({ quality: 85 }).toBuffer();
  await bucket.file(`optimized/${withoutExt}.webp`).save(fullWebp, {
    metadata: { contentType: 'image/webp', cacheControl: CACHE_CONTROL },
  });

  // Mobile-width WebP
  const mobileWebp = await sharp(buffer)
    .resize({ width: MOBILE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  await bucket.file(`optimized/${withoutExt}-mobile.webp`).save(mobileWebp, {
    metadata: { contentType: 'image/webp', cacheControl: CACHE_CONTROL },
  });

  console.log(`Optimized ${filePath} -> optimized/${withoutExt}.webp (+ -mobile variant)`);
});
