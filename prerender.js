import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, 'dist')

// The Cloudflare Vite plugin hashes SSR output filenames into
// dist/server/assets/entry-server-<hash>.js, while older builds dropped
// the file at dist/server/entry-server.js. Resolve whichever exists so
// prerender works with both build modes.
function resolveSsrEntry() {
  const flat = path.resolve(distDir, 'server/entry-server.js')
  if (fs.existsSync(flat)) return flat
  const assetsDir = path.resolve(distDir, 'server/assets')
  if (fs.existsSync(assetsDir)) {
    const match = fs.readdirSync(assetsDir).find(f => /^entry-server.*\.js$/.test(f))
    if (match) return path.join(assetsDir, match)
  }
  throw new Error(`No entry-server build output found in ${distDir}/server`)
}

async function prerender() {
  const ssrPath = resolveSsrEntry()
  const { render, getAllPaths } = await import(`file://${ssrPath}`)
  const template = fs.readFileSync(path.resolve(distDir, 'index.html'), 'utf-8')

  const routes = getAllPaths()
  console.log(`Pre-rendering ${routes.length} pages...`)

  for (const url of routes) {
    const { html } = render(url)

    let page = template

    // Extract SEO tags from rendered HTML (React 19 renders them inline)
    const titleMatch = html.match(/<title[^>]*>[\s\S]*?<\/title>/)
    const metaTags = html.match(/<meta[^>]*>/g) || []
    const linkTags = html.match(/<link[^>]*rel="canonical"[^>]*>/g) || []
    const scriptTags = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []

    // Build SEO block from extracted tags
    const seoparts = []
    if (titleMatch) seoparts.push(titleMatch[0])
    seoparts.push(...metaTags)
    seoparts.push(...linkTags)
    seoparts.push(...scriptTags)

    if (seoparts.length > 0) {
      page = page.replace(
        /<!--seo-head-start-->[\s\S]*?<!--seo-head-end-->/,
        seoparts.join('\n    ')
      )
    }

    // Strip SEO tags from body HTML (they've been moved to <head>)
    let cleanHtml = html
      .replace(/<title[^>]*>[\s\S]*?<\/title>/g, '')
      .replace(/<meta[^>]*>/g, '')
      .replace(/<link[^>]*rel="canonical"[^>]*>/g, '')
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')

    page = page.replace(
      '<div id="root"></div>',
      `<div id="root">${cleanHtml}</div>`
    )

    const filePath = url === '/'
      ? path.resolve(distDir, 'index.html')
      : path.resolve(distDir, `${url.slice(1)}/index.html`)

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, page)
  }

  console.log(`Done! ${routes.length} pages pre-rendered.`)
}

prerender().catch(err => {
  console.error('Pre-render failed:', err)
  process.exit(1)
})
