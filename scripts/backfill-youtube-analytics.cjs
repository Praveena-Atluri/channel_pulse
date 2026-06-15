#!/usr/bin/env node

const Module = require("node:module");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveChannelPulseAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(rootDir, request.slice(2)), parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const jiti = require("jiti")(__filename, {
  interopDefault: true
});

jiti("./backfill-youtube-analytics.ts");
