#!/usr/bin/env node
// A three-line shim rather than a build banner, so the shebang belongs to a
// committed file instead of an artifact.
import { run } from "../dist/cli/index.js";

process.exitCode = await run(process.argv.slice(2));
