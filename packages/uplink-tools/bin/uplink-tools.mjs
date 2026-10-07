#!/usr/bin/env node
// A shim rather than a build banner, so the shebang belongs to a committed file instead of an artifact.
import { run } from "../dist/cli.js";

process.exitCode = await run(process.argv.slice(2));
