const fs = require('fs')
const path = require('path')
const cheerio = require('cheerio')

const MAPPING_FILE = 'kms-sync-mapping.json'

module.exports = function pluginKmsSync(context, options) {
  const {kmsBaseUrl, spaceKey} = options

  return {
    name: 'docusaurus-plugin-kms-sync',

    async postBuild({outDir, siteConfig}) {
      const sidebarPath = path.join(context.siteDir, 'sidebars.js')
      const sidebars = require(sidebarPath)
      const docsSidebar = sidebars.docs
      if (!docsSidebar) {
        console.warn('[kms-sync] No "docs" sidebar found, skipping sync.')
        return
      }

      // Load existing mapping
      const mappingPath = path.join(context.siteDir, MAPPING_FILE)
      const mapping = loadMapping(mappingPath)

      // Flatten sidebar into ordered tree with parent refs
      const tree = flattenSidebar(docsSidebar)

      console.log(`[kms-sync] Syncing ${tree.length} items to ${kmsBaseUrl}`)

      // Process each item in order (parents before children)
      for (const node of tree) {
        const parentPageKey = node.parentId ? mapping[node.parentId] : null

        if (node.type === 'category') {
          // Placeholder page for categories
          const pageKey = await syncPage({
            kmsBaseUrl,
            spaceKey,
            id: node.id,
            title: node.label,
            content: '<!-- category placeholder -->',
            parentPageKey: parentPageKey,
            mapping,
          })
          mapping[node.id] = pageKey
        } else {
          // Doc page — read and extract HTML
          const htmlPath = resolveDocHtml(outDir, node.id)
          if (!htmlPath) {
            console.warn(`[kms-sync] HTML not found for ${node.id}, skipping.`)
            continue
          }
          const html = fs.readFileSync(htmlPath, 'utf8')
          const {title, content} = extractArticle(html)

          let finalContent = content
          if (content.length > 65535) {
            console.warn(
              `[kms-sync] Content truncated for ${node.id}: ${content.length} -> 65535 chars`,
            )
            finalContent = content.slice(0, 65535)
          }

          const pageKey = await syncPage({
            kmsBaseUrl,
            spaceKey,
            id: node.id,
            title: title || node.id,
            content: finalContent,
            parentPageKey: parentPageKey,
            mapping,
          })
          mapping[node.id] = pageKey
        }
      }

      // Save mapping
      saveMapping(mappingPath, mapping)
      console.log(`[kms-sync] Done. ${tree.length} items synced.`)
    },
  }
}

// --- Sidebar parsing ---

function flattenSidebar(items, parentId = null) {
  const result = []

  for (const item of items) {
    if (typeof item === 'string') {
      // Simple doc ID
      result.push({type: 'doc', id: item, parentId})
    } else if (typeof item === 'object' && !Array.isArray(item)) {
      if (item.type === 'category') {
        // Explicit category
        const catId = `__cat__${item.label}`
        result.push({type: 'category', id: catId, label: item.label, parentId})
        if (item.items) {
          result.push(...flattenSidebar(item.items, catId))
        }
      } else if (!item.type) {
        // Shorthand category: { "Label": [...items] }
        for (const [label, children] of Object.entries(item)) {
          const catId = `__cat__${label}`
          result.push({type: 'category', id: catId, label, parentId})
          if (Array.isArray(children)) {
            result.push(...flattenSidebar(children, catId))
          }
        }
      }
    }
  }

  return result
}

// --- HTML extraction ---

function resolveDocHtml(outDir, docId) {
  // Docusaurus outputs docs at: build/docs/<docId>/index.html
  // where docId slashes become directory separators
  const candidates = [
    path.join(outDir, 'docs', docId, 'index.html'),
    path.join(outDir, 'docs', `${docId}.html`),
    // 'introduction' is the docs root, served at /docs/index.html
    ...(docId === 'introduction'
      ? [path.join(outDir, 'docs', 'index.html')]
      : []),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function extractArticle(html) {
  const $ = cheerio.load(html)
  const article = $('article')

  // Remove breadcrumbs and TOC
  article.find('nav.theme-doc-breadcrumbs').remove()
  article.find('.tocCollapsible_ETCw').remove()

  const title = article.find('header h1').first().text() || ''

  // Get the markdown content div
  const markdownDiv = article.find('.theme-doc-markdown')
  const content = markdownDiv.length ? markdownDiv.html() : article.html()

  return {title, content: content || ''}
}

// --- KMS API ---

async function syncPage({
  kmsBaseUrl,
  spaceKey,
  id,
  title,
  content,
  parentPageKey,
  mapping,
}) {
  const existingKey = mapping[id]

  const body = {
    space_key: spaceKey,
    page_type: 'DOCUMENT',
    page_title: title,
    page_content: content,
    page_content_format: 'HTML',
    parent_page_key: parentPageKey || undefined,
  }

  if (existingKey) {
    // Update
    body.page_key = existingKey
    const resp = await fetch(`${kmsBaseUrl}/api/v1/page/update`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const err = await resp.text()
      console.error(`[kms-sync] Failed to update ${id}: ${err}`)
      return existingKey
    }
    const data = await resp.json()
    console.log(
      `[kms-sync] Updated: ${title} (${data.page_key.slice(0, 8)}...)`,
    )
    return data.page_key
  } else {
    // Create
    const resp = await fetch(`${kmsBaseUrl}/api/v1/page/create`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const err = await resp.text()
      console.error(`[kms-sync] Failed to create ${id}: ${err}`)
      return null
    }
    const data = await resp.json()
    console.log(
      `[kms-sync] Created: ${title} (${data.page_key.slice(0, 8)}...)`,
    )
    return data.page_key
  }
}

// --- Mapping file ---

function loadMapping(filePath) {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }
  return {}
}

function saveMapping(filePath, mapping) {
  fs.writeFileSync(filePath, JSON.stringify(mapping, null, 2) + '\n')
}
