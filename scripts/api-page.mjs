#!/usr/bin/env node
/*
 * Generates the API page from asyncapi.yaml with the AsyncAPI generator and
 * the template in docs/api/template.
 *
 *   node scripts/api-page.mjs [<output directory>]
 *
 * The output directory defaults to docs/api/dist and holds one file,
 * index.html, which deploy.yml publishes beside each channel's app.
 */

import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(REPO_ROOT, "docs/api/template");
const DOCUMENT = join(REPO_ROOT, "asyncapi.yaml");

export async function generateApiPage(output) {
  const Generator = createRequire(import.meta.url)("@asyncapi/generator");
  rmSync(output, { recursive: true, force: true });
  const generator = new Generator(TEMPLATE, output, { forceWrite: true });
  await generator.generateFromFile(DOCUMENT);
  const page = join(output, "index.html");
  if (!existsSync(page))
    throw new Error(`the generator finished without writing ${page}`);
  return page;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? join(REPO_ROOT, "docs/api/dist"));
  generateApiPage(output).then(
    (page) => console.log(`api page: wrote ${page}`),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
