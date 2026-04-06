const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, 'data')
const OUT_DIR = process.argv[2] || path.join(__dirname, 'static-site')

function readAllPages() {
  if (!fs.existsSync(DATA_DIR)) return []
  return fs
    .readdirSync(DATA_DIR, {withFileTypes: true})
    .filter(d => d.isDirectory())
    .map(d => {
      const metaPath = path.join(DATA_DIR, d.name, 'metadata.json')
      if (!fs.existsSync(metaPath)) return null
      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      return metadata
    })
    .filter(Boolean)
}

function buildTree(pages) {
  const byKey = {}
  pages.forEach(p => (byKey[p.page_key] = {...p, children: []}))
  const roots = []
  pages.forEach(p => {
    if (p.parent_page_key && byKey[p.parent_page_key]) {
      byKey[p.parent_page_key].children.push(byKey[p.page_key])
    } else {
      roots.push(byKey[p.page_key])
    }
  })
  return roots
}

function renderNav(nodes) {
  if (!nodes.length) return ''
  return (
    '<ul>' +
    nodes
      .map(
        n =>
          `<li><a href="${n.page_key}/index.html">${
            n.page_title || '(untitled)'
          }</a>${renderNav(n.children)}</li>`,
      )
      .join('') +
    '</ul>'
  )
}

function generateIndex(pages) {
  const tree = buildTree(pages)
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>KMS Pages</title>
<style>
  body { font-family: sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h1>KMS Pages</h1>
  <p>${pages.length} page(s)</p>
  ${renderNav(tree)}
</body></html>`
}

function generatePageWrapper(metadata) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${metadata.page_title || 'Untitled'}</title>
<style>
  body { font-family: sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .meta { font-size: 0.85em; color: #666; margin-bottom: 20px; }
  .meta td { padding: 2px 10px 2px 0; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 4px; overflow-x: auto; }
  code { font-size: 0.9em; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 16px; color: #555; }
</style>
</head>
<body>
  <p><a href="../index.html">&larr; Back to list</a></p>
  <h1>${metadata.page_title || 'Untitled'}</h1>
  <table class="meta">
    <tr><td>page_key</td><td>${metadata.page_key}</td></tr>
    <tr><td>parent_page_key</td><td>${
      metadata.parent_page_key || '(none)'
    }</td></tr>
    <tr><td>tags</td><td>${
      (metadata.tags || []).join(', ') || '(none)'
    }</td></tr>
    <tr><td>updated_at</td><td>${metadata.updated_at}</td></tr>
  </table>
  <hr>
  <article>
    <iframe src="content.html" style="width:100%;border:none;min-height:80vh" onload="this.style.height=this.contentDocument.body.scrollHeight+'px'"></iframe>
  </article>
</body></html>`
}

// --- Main ---

const pages = readAllPages()
if (!pages.length) {
  console.log('No pages found in data directory.')
  process.exit(0)
}

// Create output dir
fs.mkdirSync(OUT_DIR, {recursive: true})

// Generate index
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), generateIndex(pages))

// Generate page directories
for (const page of pages) {
  const pageDir = path.join(OUT_DIR, page.page_key)
  fs.mkdirSync(pageDir, {recursive: true})

  // Copy content.html as-is
  const srcContent = path.join(DATA_DIR, page.page_key, 'content.html')
  if (fs.existsSync(srcContent)) {
    fs.copyFileSync(srcContent, path.join(pageDir, 'content.html'))
  }

  // Generate wrapper page
  fs.writeFileSync(path.join(pageDir, 'index.html'), generatePageWrapper(page))
}

console.log(`Generated static site: ${pages.length} pages in ${OUT_DIR}`)
