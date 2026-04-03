const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const app = express()
app.use(express.json({limit: '1mb'}))

const DATA_DIR = path.join(__dirname, 'data')

// Ensure data dir exists
fs.mkdirSync(DATA_DIR, {recursive: true})

function generatePageKey() {
  return crypto.randomUUID()
}

function readPage(pageKey) {
  const dir = path.join(DATA_DIR, pageKey)
  const metaPath = path.join(dir, 'metadata.json')
  const contentPath = path.join(dir, 'content.html')
  if (!fs.existsSync(metaPath)) return null
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  const content = fs.existsSync(contentPath)
    ? fs.readFileSync(contentPath, 'utf8')
    : ''
  return {...metadata, page_content: content}
}

function writePage(pageKey, fields) {
  const dir = path.join(DATA_DIR, pageKey)
  fs.mkdirSync(dir, {recursive: true})
  const {page_content, ...metadata} = fields
  metadata.page_key = pageKey
  fs.writeFileSync(
    path.join(dir, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n',
  )
  fs.writeFileSync(path.join(dir, 'content.html'), page_content || '')
}

function validateCreate(body) {
  const errors = []
  if (!body.space_key) errors.push('space_key is required')
  else if (body.space_key.length > 32) errors.push('space_key max 32 chars')

  if (!body.page_type) errors.push('page_type is required')
  else if (body.page_type !== 'DOCUMENT')
    errors.push('page_type must be "DOCUMENT"')

  if (body.page_title && body.page_title.length > 255)
    errors.push('page_title max 255 chars')

  if (!body.page_content) errors.push('page_content is required')
  else if (body.page_content.length > 65535)
    errors.push('page_content max 65535 chars')

  if (!body.page_content_format) errors.push('page_content_format is required')
  else if (body.page_content_format !== 'HTML')
    errors.push('page_content_format must be "HTML"')

  return errors
}

// --- KMS API endpoints ---

// Create page
app.post('/api/v1/page/create', (req, res) => {
  const errors = validateCreate(req.body)
  if (errors.length) return res.status(400).json({errors})

  const pageKey = generatePageKey()
  writePage(pageKey, {
    space_key: req.body.space_key,
    page_type: req.body.page_type,
    page_title: req.body.page_title || '',
    page_content: req.body.page_content,
    page_content_format: req.body.page_content_format,
    parent_page_key: req.body.parent_page_key || null,
    media_keys: req.body.media_keys || [],
    tags: req.body.tags || [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  res.status(201).json({page_key: pageKey})
})

// Update page
app.put('/api/v1/page/update', (req, res) => {
  if (!req.body.page_key)
    return res.status(400).json({errors: ['page_key is required']})

  const existing = readPage(req.body.page_key)
  if (!existing) return res.status(404).json({errors: ['page not found']})

  const errors = validateCreate(req.body)
  if (errors.length) return res.status(400).json({errors})

  writePage(req.body.page_key, {
    space_key: req.body.space_key,
    page_type: req.body.page_type,
    page_title: req.body.page_title || '',
    page_content: req.body.page_content,
    page_content_format: req.body.page_content_format,
    parent_page_key: req.body.parent_page_key || null,
    media_keys: req.body.media_keys || [],
    tags: req.body.tags || [],
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  })

  res.json({page_key: req.body.page_key})
})

// --- Convenience endpoints (not part of real KMS API) ---

// List all pages
app.get('/api/v1/pages', (req, res) => {
  if (!fs.existsSync(DATA_DIR)) return res.json([])
  const dirs = fs.readdirSync(DATA_DIR, {withFileTypes: true})
  const pages = dirs
    .filter(d => d.isDirectory())
    .map(d => readPage(d.name))
    .filter(Boolean)
  res.json(pages)
})

// Get single page
app.get('/api/v1/page/:pageKey', (req, res) => {
  const page = readPage(req.params.pageKey)
  if (!page) return res.status(404).json({errors: ['page not found']})
  res.json(page)
})

// --- Web UI ---

app.get('/', (req, res) => {
  if (!fs.existsSync(DATA_DIR)) return res.send(renderUI([]))
  const dirs = fs.readdirSync(DATA_DIR, {withFileTypes: true})
  const pages = dirs
    .filter(d => d.isDirectory())
    .map(d => readPage(d.name))
    .filter(Boolean)
  res.send(renderUI(pages))
})

app.get('/view/:pageKey', (req, res) => {
  const page = readPage(req.params.pageKey)
  if (!page) return res.status(404).send('Page not found')
  res.send(renderPageView(page))
})

function renderUI(pages) {
  // Build tree from flat list
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

  function renderTree(nodes, depth = 0) {
    return nodes
      .map(
        n => `
      <li style="margin-left:${depth * 20}px">
        <a href="/view/${n.page_key}">${n.page_title || '(untitled)'}</a>
        <small style="color:#888"> [${n.page_key.slice(0, 8)}...]</small>
        ${
          n.children.length
            ? '<ul>' + renderTree(n.children, depth + 1) + '</ul>'
            : ''
        }
      </li>`,
      )
      .join('')
  }

  return `<!DOCTYPE html>
<html><head><title>KMS Mock Server</title></head>
<body style="font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px">
  <h1>KMS Mock Server</h1>
  <p>${pages.length} page(s) stored</p>
  <ul>${renderTree(roots)}</ul>
</body></html>`
}

function renderPageView(page) {
  return `<!DOCTYPE html>
<html><head><title>${page.page_title || 'Untitled'} - KMS Mock</title></head>
<body style="font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px">
  <p><a href="/">&larr; Back to list</a></p>
  <h1>${page.page_title || 'Untitled'}</h1>
  <table style="font-size:0.9em;border-collapse:collapse;margin-bottom:20px">
    <tr><td style="padding:2px 10px;color:#888">page_key</td><td>${
      page.page_key
    }</td></tr>
    <tr><td style="padding:2px 10px;color:#888">space_key</td><td>${
      page.space_key
    }</td></tr>
    <tr><td style="padding:2px 10px;color:#888">parent_page_key</td><td>${
      page.parent_page_key || '(none)'
    }</td></tr>
    <tr><td style="padding:2px 10px;color:#888">tags</td><td>${
      (page.tags || []).join(', ') || '(none)'
    }</td></tr>
    <tr><td style="padding:2px 10px;color:#888">updated_at</td><td>${
      page.updated_at
    }</td></tr>
  </table>
  <hr>
  <article>${page.page_content}</article>
</body></html>`
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`KMS mock server running at http://localhost:${PORT}`)
  console.log(`Data directory: ${DATA_DIR}`)
})
