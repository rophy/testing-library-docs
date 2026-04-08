FROM node:20-alpine

# Install tools needed by GitHub Actions
RUN apk add --no-cache tar gzip git

# Install root dependencies
WORKDIR /deps/root
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# Install plugin dependencies
WORKDIR /deps/plugin
COPY plugins/docusaurus-plugin-kms-sync/package.json plugins/docusaurus-plugin-kms-sync/package-lock.json ./
RUN npm ci

# Install mock server dependencies
WORKDIR /deps/kms-mock
COPY kms-mock-server/package.json kms-mock-server/package-lock.json ./
RUN npm ci

WORKDIR /app
