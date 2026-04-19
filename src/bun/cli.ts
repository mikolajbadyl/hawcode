#!/usr/bin/env node
process.title = "hawcode";
process.emitWarning = (() => {}) as typeof process.emitWarning;

await import("../cli.js");
