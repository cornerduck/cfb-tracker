import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Lists the image files in public/images so the app only requests images
// that exist (a missing logo falls back to a monogram without a 404).
const listImages = (root: string): string[] => {
  try {
    return readdirSync(root).flatMap((name) => {
      const path = join(root, name)
      return statSync(path).isDirectory() ? listImages(path) : [path]
    })
  } catch {
    return []
  }
}
const imagesRoot = join(__dirname, 'public', 'images')
const imageFiles = listImages(imagesRoot)
  .map((path) => relative(imagesRoot, path).split('\\').join('/'))
  .filter((path) => /\.(png|jpe?g|webp|svg)$/i.test(path))

export default defineConfig({
  base: '/cfb-tracker/',
  define: {
    __IMAGE_FILES__: JSON.stringify(imageFiles),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['strdys-icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'STRDYS',
        short_name: 'STRDYS',
        description: 'The FBS college football season, updated automatically',
        theme_color: '#0B0C0E',
        background_color: '#0B0C0E',
        display: 'standalone',
        start_url: '/cfb-tracker/',
        scope: '/cfb-tracker/',
        icons: [
          {
            src: 'strdys-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
