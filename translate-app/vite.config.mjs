import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      // Vite's React refresh preamble is inline; production keeps script-src self.
      transformIndexHtml: (html) => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
    },
  ],
})
