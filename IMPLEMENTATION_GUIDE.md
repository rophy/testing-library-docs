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

TBD — to be designed with user input.

### Mock server implementation

TBD — depends on API design above.

## Phase 3: Docusaurus Plugin (`docusaurus-plugin-kms-sync`)

TBD — depends on API design from Phase 2.
