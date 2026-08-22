#!/usr/bin/env node
// The `gonogo-uplink` bin. A three-line shim rather than a tsup banner, so the
// shebang belongs to a committed file instead of a build artifact.
import { run } from "../dist/render.js";

process.exitCode = await run(process.argv.slice(2));
