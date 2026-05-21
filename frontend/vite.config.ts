import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const inlineRasterImages = () => ({
  name: 'inline-raster-images',
  enforce: 'pre' as const,
  load(id: string) {
    const cleanId = id.split('?')[0];
    if (cleanId.endsWith('.png') || cleanId.endsWith('.jpg') || cleanId.endsWith('.jpeg')) {
      if (fs.existsSync(cleanId)) {
        const buffer = fs.readFileSync(cleanId);
        const mime = cleanId.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const base64 = buffer.toString('base64');
        return `export default "data:${mime};base64,${base64}";`;
      }
    }
  }
});

export default defineConfig({
  plugins: [
    inlineRasterImages(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv', '**/*.mp4'],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
