# KMS Sync - Implementation Guide

## Goal

Maintain documentation using markdown + git + Docusaurus (industry standard), while also publishing to a corporate knowledge management service (KMS) via its API. Best of both worlds.

This repo (forked from testing-library/testing-library-docs) serves as the test bed.

## Overview

1. **Maintain docs** with markdown and git (already done - this repo)
2. **Build and publish** a static site with Docusaurus to GitHub Pages
3. **Develop a Docusaurus plugin** (`docusaurus-plugin-kms-sync`) that publishes pages to the corporate KMS API after build

## Phase 1: Deploy to GitHub Pages

Configure Docusaurus for GitHub Pages deployment.

### Changes needed

- **`docusaurus.config.js`**: Update `url` and `baseUrl` for GitHub Pages:
  - `url`: `https://rophy.github.io`
  - `baseUrl`: `/testing-library-docs/`
  - `organizationName`: `rophy`
  - `projectName`: `testing-library-docs`
- **GitHub Actions workflow**: Create `.github/workflows/deploy.yml` that:
  - Triggers on push to `main`
  - Installs dependencies, builds site (`npm run build`)
  - Deploys `build/` directory to `gh-pages` branch
  - Uses `actions/deploy-pages` or similar

### Expected result

Site available at: `https://rophy.github.io/testing-library-docs/`

## Phase 2: Mock KMS API

Build a simple mock server that simulates the corporate KMS, so the plugin can be developed and tested locally.

### KMS API Design

The corporate KMS is a home-grown Confluence-like knowledge management service.

**Core concepts:**
- **Space**: A top-level container for documents (like a Confluence space)
- **Page**: A document within a space, organized in a tree hierarchy
- **Content**: HTML body of a page

**API endpoints (REST, JSON):**

```
# Space management
GET    /api/spaces                    # List all spaces
POST   /api/spaces                    # Create a space
GET    /api/spaces/:spaceKey          # Get space details

# Page management
GET    /api/spaces/:spaceKey/pages    # List pages in a space (flat list with parentId)
POST   /api/spaces/:spaceKey/pages    # Create a page
GET    /api/pages/:pageId             # Get a page (includes HTML body)
PUT    /api/pages/:pageId             # Update a page
DELETE /api/pages/:pageId             # Delete a page

# Tree structure
GET    /api/spaces/:spaceKey/tree     # Get full page tree for a space
```

**Data models:**

```json
// Space
{
  "key": "TL",
  "name": "Testing Library Docs",
  "description": "Documentation for Testing Library"
}

// Page
{
  "id": "page-123",
  "spaceKey": "TL",
  "parentId": null,          // null = root-level page
  "title": "Introduction",
  "slug": "introduction",    // maps to Docusaurus doc ID
  "body": "<h1>...</h1>...", // HTML content
  "createdAt": "2026-04-03T00:00:00Z",
  "updatedAt": "2026-04-03T00:00:00Z"
}
```

**No authentication** required for now (will be added later).

### Mock server implementation

- Simple Node.js/Express server
- In-memory storage (no database)
- Implement all endpoints above
- Add a basic web UI to browse spaces/pages (helpful for visual verification)
- Location: `kms-mock-server/` directory in this repo

## Phase 3: Docusaurus Plugin (`docusaurus-plugin-kms-sync`)

A Docusaurus plugin that syncs built pages to the KMS API.

### Plugin behavior

1. Hooks into the `postBuild` Docusaurus lifecycle
2. Reads the sidebar structure from `sidebars.js` to determine page hierarchy
3. For each doc page:
   - Extracts the article content HTML (strips Docusaurus chrome: navbar, footer, sidebar)
   - Creates or updates the corresponding KMS page via the API
   - Preserves the tree structure (parent-child relationships)
4. Maintains a mapping file (`kms-sync-mapping.json`) that maps `docSlug -> kmsPageId`

### Plugin configuration (in `docusaurus.config.js`)

```js
plugins: [
  ['docusaurus-plugin-kms-sync', {
    kmsBaseUrl: 'http://localhost:3001',  // KMS API URL
    spaceKey: 'TL',                       // target space
    spaceName: 'Testing Library Docs',    // space display name
  }],
],
```

### Key design decisions

- **Sidebar is the source of truth** for tree structure, not the filesystem
- **Idempotent sync**: create if missing, update if changed
- **Mapping file** (`kms-sync-mapping.json`) committed to git, tracks `slug -> pageId`
- **HTML extraction**: parse the built HTML files and extract only the `<article>` content, stripping Docusaurus layout/chrome

### Location

- Plugin source: `plugins/docusaurus-plugin-kms-sync/` directory in this repo

## File Structure (planned)

```
testing-library-docs/
├── docs/                          # (existing) markdown docs
├── sidebars.js                    # (existing) sidebar/tree structure
├── docusaurus.config.js           # (modify) add gh-pages config + plugin
├── .github/workflows/deploy.yml   # (new) GitHub Pages deployment
├── kms-mock-server/               # (new) Mock KMS API server
│   ├── package.json
│   ├── server.js
│   └── ...
├── plugins/                       # (new) Docusaurus plugins
│   └── docusaurus-plugin-kms-sync/
│       ├── index.js
│       └── package.json
├── kms-sync-mapping.json          # (new, generated) slug-to-pageId mapping
└── IMPLEMENTATION_GUIDE.md        # (this file)
```

## Development Workflow

1. Start the mock KMS server: `cd kms-mock-server && npm start`
2. Build the Docusaurus site: `npm run build`
3. The plugin runs during build and syncs to the mock KMS
4. Verify pages in the mock KMS UI at `http://localhost:3001`
