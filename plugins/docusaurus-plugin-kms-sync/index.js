const fs = require('fs')
const path = require('path')
const {marked} = require('marked')
const matter = require('gray-matter')

const MAPPING_FILE = 'kms-sync-mapping.json'

module.exports = function pluginKmsSync(context, options) {
  const {kmsBaseUrl, spaceKey} = options

  return {
    name: 'docusaurus-plugin-kms-sync',

    async postBuild({outDir, siteConfig}) {
      // Check if KMS server is reachable
      try {
        await fetch(`${kmsBaseUrl}/api/v1/pages`, {
          signal: AbortSignal.timeout(3000),
        })
      } catch {
        console.log(
          `[kms-sync] KMS server not reachable at ${kmsBaseUrl}, skipping sync.`,
        )
        return
      }

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

      // Build doc ID -> file path index
      const docIndex = buildDocIndex(context.siteDir)

      // Flatten sidebar into ordered tree with parent refs
      const tree = flattenSidebar(docsSidebar)

      console.log(`[kms-sync] Syncing ${tree.length} items to ${kmsBaseUrl}`)

      // Process each item in order (parents before children)
      for (const node of tree) {
        const parentPageKey = node.parentId ? mapping[node.parentId] : null

        if (node.type === 'category') {
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
          // Doc page — read markdown source and convert to HTML
          const mdPath = resolveDocMarkdown(docIndex, node.id)
          if (!mdPath) {
            console.warn(
              `[kms-sync] Markdown not found for ${node.id}, skipping.`,
            )
            continue
          }
          const raw = fs.readFileSync(mdPath, 'utf8')
          const {title, content} = renderMarkdown(raw)

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
      result.push({type: 'doc', id: item, parentId})
    } else if (typeof item === 'object' && !Array.isArray(item)) {
      if (item.type === 'category') {
        const catId = `__cat__${item.label}`
        result.push({type: 'category', id: catId, label: item.label, parentId})
        if (item.items) {
          result.push(...flattenSidebar(item.items, catId))
        }
      } else if (!item.type) {
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

// --- Markdown resolution and rendering ---

function buildDocIndex(siteDir) {
  const docsDir = path.join(siteDir, 'docs')
  const index = {} // docId -> filePath
  walkDir(docsDir, filePath => {
    if (!/\.(md|mdx)$/.test(filePath)) return
    const raw = fs.readFileSync(filePath, 'utf8')
    const {data} = matter(raw)
    // Use frontmatter id if present, otherwise derive from relative path
    const rel = path.relative(docsDir, filePath).replace(/\.(md|mdx)$/, '')
    const docId = data.id || rel
    // For nested docs, combine directory with id
    const dir = path.dirname(rel)
    const key =
      dir !== '.' && data.id && !data.id.includes('/')
        ? `${dir}/${data.id}`
        : data.id || rel
    index[key] = filePath
    // Also index without directory prefix if id is set
    if (data.id && !index[data.id]) {
      index[data.id] = filePath
    }
  })
  return index
}

function walkDir(dir, callback) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkDir(fullPath, callback)
    } else {
      callback(fullPath)
    }
  }
}

function resolveDocMarkdown(docIndex, docId) {
  return docIndex[docId] || null
}

function renderMarkdown(raw) {
  // Parse frontmatter
  const {data, content: mdContent} = matter(raw)
  const title = data.title || ''

  // Pre-process MDX to plain markdown
  const cleaned = preprocessMdx(mdContent)

  // Convert to HTML
  const html = marked.parse(cleaned)

  return {title, content: html}
}

function preprocessMdx(content) {
  let result = content

  // Remove MDX import statements
  result = result.replace(/^import\s+.*$/gm, '')

  // Convert admonitions (:::tip, :::caution, etc.) to blockquotes
  result = result.replace(
    /^:::(tip|caution|warning|note|info|danger)(?:\s+(.*))?$/gm,
    (match, type, title) => {
      const label = title || type.charAt(0).toUpperCase() + type.slice(1)
      return `> **${label}**`
    },
  )
  // Continuation lines inside admonitions — handled by keeping them as-is
  // Close admonition markers
  result = result.replace(/^:::$/gm, '')

  // Convert <Tabs>/<TabItem> to headings
  // Remove <Tabs ...> and </Tabs>
  result = result.replace(/<Tabs[\s\S]*?>/g, '')
  result = result.replace(/<\/Tabs>/g, '')

  // Convert <TabItem value="..."> to a small heading
  result = result.replace(
    /<TabItem\s+value="([^"]*)">/g,
    (match, value) => `**${value}:**\n`,
  )
  result = result.replace(/<\/TabItem>/g, '')

  // Strip npm2yarn annotation from code blocks (keep just the npm command)
  result = result.replace(/```(\w+)\s+npm2yarn/g, '```$1')

  // Strip title annotation from code blocks
  result = result.replace(/```(\w+)\s+title="[^"]*"/g, '```$1')

  // Remove <details>/<summary> tags but keep content
  result = result.replace(/<details[^>]*>/g, '')
  result = result.replace(/<\/details>/g, '')
  result = result.replace(/<summary>(.*?)<\/summary>/g, '**$1**\n')

  return result
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

  let pageKey
  if (existingKey) {
    const resp = await fetch(`${kmsBaseUrl}/api/v1/page/update/${existingKey}`, {
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
    pageKey = data.page_key
    console.log(`[kms-sync] Updated: ${title} (${pageKey.slice(0, 8)}...)`)
  } else {
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
    pageKey = data.page_key
    console.log(`[kms-sync] Created: ${title} (${pageKey.slice(0, 8)}...)`)
  }

  // Publish after create/update
  const pubResp = await fetch(`${kmsBaseUrl}/api/v1/page/publish/${pageKey}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
  })
  if (!pubResp.ok) {
    console.error(`[kms-sync] Failed to publish ${id}: ${await pubResp.text()}`)
  }

  return pageKey
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
