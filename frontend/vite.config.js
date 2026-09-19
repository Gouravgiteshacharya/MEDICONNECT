import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const PUBLIC_PATHS = ['/', '/privacy', '/terms', '/partner/pharmacy/apply', '/partner/rider/apply']

function publicWebEssentials(siteOrigin) {
  return {
    name: 'mediconnect-public-web-essentials',
    apply: 'build',
    transformIndexHtml(html) {
      const origin = siteOrigin.replace(/\/$/, '')
      return html
        .replaceAll('content="/social-preview.jpg"', `content="${origin}/social-preview.jpg"`)
        .replace('</head>', `    <meta property="og:url" content="${origin}/" />\n    <link rel="canonical" href="${origin}/" />\n  </head>`)
    },
    async closeBundle() {
      const origin = siteOrigin.replace(/\/$/, '')
      const robots = [
        'User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /app/',
        'Disallow: /pharmacy/', 'Disallow: /rider/', '', `Sitemap: ${origin}/sitemap.xml`, '',
      ].join('\n')
      const urls = PUBLIC_PATHS.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join('\n')
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
      await Promise.all([
        writeFile(resolve('dist/robots.txt'), robots),
        writeFile(resolve('dist/sitemap.xml'), sitemap),
      ])
    },
  }
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const vercelProductionOrigin = environment.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${environment.VERCEL_PROJECT_PRODUCTION_URL}`
    : ''
  const siteOrigin = environment.VITE_PUBLIC_SITE_URL
    || vercelProductionOrigin
    || 'https://mediconnect-gourav-acharyas-projects.vercel.app'

  return { plugins: [react(), publicWebEssentials(siteOrigin)] }
})
