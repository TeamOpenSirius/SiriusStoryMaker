import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: '../public/wds-adv-player',
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@esotericsoftware')) return 'spine'
          if (id.includes('node_modules/pixi.js') || id.includes('node_modules/@pixi')) return 'pixi'
        },
      },
    },
  },
  define: { __VERSION__: JSON.stringify('1.0.4-sirius.1') },
})
