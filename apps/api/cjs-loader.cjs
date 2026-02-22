// Patches Node.js CJS resolver to remap .js extensions -> .ts for ts-node-dev
const Module = require('module');
const path = require('path');
const fs = require('fs');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.endsWith('.js') && parent && !request.includes('node_modules')) {
    const tsRequest = request.slice(0, -3) + '.ts';
    try {
      return origResolve.call(this, tsRequest, parent, isMain, options);
    } catch (_) {}
  }
  return origResolve.call(this, request, parent, isMain, options);
};
