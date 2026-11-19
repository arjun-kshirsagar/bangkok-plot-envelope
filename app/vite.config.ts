/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // maplibre-gl and deck.gl are ~1 MB each minified and cannot be split further usefully.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        // Vendor chunks: parallel download, separate cache entries, and a small app chunk that
        // changes on every deploy. Nothing is lazy-loaded; the map needs all of these at start.
        codeSplitting: {
          groups: [
            { name: 'vendor-maplibre', test: /node_modules[\\/]maplibre-gl/, priority: 30 },
            { name: 'vendor-deck', test: /node_modules[\\/](@deck\.gl|@luma\.gl|@loaders\.gl|@math\.gl|@probe\.gl|mjolnir\.js|gl-matrix)/, priority: 30 },
            { name: 'vendor-geo', test: /node_modules[\\/](@turf|polygon-clipping|proj4|terra-draw|robust-predicates|splaytree|rbush|earcut|concaveman|mgrs|wkt-parser)/, priority: 20 },
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
