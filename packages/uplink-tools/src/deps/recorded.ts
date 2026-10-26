import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Http } from "./channels";

const here = dirname(fileURLToPath(import.meta.url));

/** One response recorded from a live channel, trimmed to the fields the reads use. */
export const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, "recorded", name), "utf8"));

const CKAN_API = "https://api.github.com/repos/KSP-CKAN/CKAN-meta/contents";
const CKAN_RAW = "https://raw.githubusercontent.com/KSP-CKAN/CKAN-meta/master";

/** The recorded responses, by the URL a read asks for. */
export const RECORDED_ROUTES: Record<string, unknown> = {
  "https://api.github.com/repos/example-org/example-mod/releases/latest":
    recorded("github-release-ex1.json"),
  [`${CKAN_API}/Example-1`]: recorded("ckan-dir-ex1.json"),
  [`${CKAN_RAW}/Example-1/Example-1-v4.8.1.0.ckan`]: recorded(
    "ckan-ex1-4.8.1.0.json",
  ),
  [`${CKAN_RAW}/Example-1/Example-1-v4.8.0.0.ckan`]: recorded(
    "ckan-ex1-4.8.0.0.json",
  ),
  "https://spacedock.info/api/mod/1685": recorded("spacedock-agext.json"),
  "https://api.github.com/repos/tag-org/TagMod/tags?per_page=100": recorded(
    "github-tags-tagmod.json",
  ),
  "https://registry.npmjs.org/@ksp-gonogo%2fsitrep-sdk": recorded(
    "npm-sitrep-sdk.json",
  ),
};

/** A network that answers from recorded responses and fails any other address, so no test reaches the live one. */
export function recordedHttp(
  routes: Record<string, unknown> = RECORDED_ROUTES,
  bytes: Record<string, Uint8Array> = {},
): Http & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async json(url) {
      asked.push(url);
      if (!(url in routes)) throw new Error(`${url} answered 404`);
      return routes[url];
    },
    async bytes(url) {
      asked.push(url);
      if (!(url in bytes)) throw new Error(`${url} answered 404`);
      return bytes[url];
    },
  };
}
