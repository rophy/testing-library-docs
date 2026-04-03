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

The corporate KMS is a home-grown Confluence-like knowledge management service.

### KMS API Design

**Create page:** `POST /api/v1/page/create`

| Field | Type | Max Length | Required | Notes |
|-------|------|-----------|----------|-------|
| space_key | string | 32 | yes | Fixed value for our use case |
| page_type | string | 32 | yes | Only `"DOCUMENT"` is allowed |
| page_title | string | 255 | no | |
| page_content | string | 65535 | yes | The page body content |
| page_content_format | string | 32 | yes | Only `"HTML"` is allowed |
| parent_page_key | string | — | no | References another page's key; forms tree hierarchy |
| media_keys | string[] | — | no | |
| tags | string[] | — | no | |

**Response:** `{ "page_key": "..." }`

**Update page:** `PUT /api/v1/page/update`

Same fields as create, plus:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| page_key | string | yes | The page to update |

**Assumptions (to be verified when more API docs arrive):**
- No authentication required for mock server
- No GET/DELETE/list endpoints defined yet — mock server will add these for development convenience

### Mock server implementation

- Simple Node.js/Express server
- Implement the create and update endpoints above
- Add convenience GET endpoints for browsing (not part of real API)
- Add a basic web UI to browse pages (helpful for visual verification)
- Location: `kms-mock-server/` directory in this repo

### Storage

Pages are persisted to disk for easy validation:

```
kms-mock-server/data/          # gitignored
└── <page_key>/
    ├── metadata.json          # all fields except page_content
    └── content.html           # the page_content
```

This allows inspecting HTML directly in a browser and diffing outputs between syncs.

## Phase 3: Docusaurus Plugin (`docusaurus-plugin-kms-sync`)

TBD — depends on API design from Phase 2.
