import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: { target: 'esnext', outDir: '../public/wds-adv-player', emptyOutDir: true },
  define: { __VERSION__: JSON.stringify('1.0.4-sirius.1') },
})
