#!/usr/bin/env node
/*
 * Writes one channel's files into a checkout of the organisation site,
 * ksp-gonogo/ksp-gonogo.github.io, which serves https://ksp-gonogo.github.io/.
 *
 *   node scripts/pages-compose.mjs rc      <app dist> <api page> <site checkout>
 *   node scripts/pages-compose.mjs release <app dist> <api page> <site checkout>
 *
 * `<api page>` is the folder scripts/api-page.mjs wrote, generated from the
 * same tree's asyncapi.yaml.
 *
 * The site holds several tenants, and each run owns only its own paths:
 *
 *   rc       /rc/                              the RC app
 *            /rc/api/                          the API page of the RC's contract
 *   release  /app/                             the release app
 *            /index.html /404.html             the landing page
 *            /README.md                        one link to this repository, written once
 *            /gonogo/                          redirects from the old URLs
 *            /gonogo/api/                      the API page, written with the redirects
 *   both     /.nojekyll                        an empty marker, see below
 *
 * Before the first release there is no /app/, so the rc channel also writes
 * the root paths (landing page, 404 page, /gonogo/ redirects and the API page
 * beside them, from the RC's contract) with every app link pointing at /rc/. Once /app/ exists the rc channel leaves them alone and
 * the release channel is their only writer, so a path never has two writers
 * at once (deploy.yml runs the channels one at a time).
 *
 * Nothing else is read, written or removed, so an RC cannot disturb the
 * release, and neither writes under /uplink-dev-docs/, which GitHub serves
 * from that repository's own Pages. The one shared file is `.nojekyll`:
 * the site repository builds with legacy Jekyll, which drops every file whose
 * name starts with an underscore, and a Vite build emits such chunks. An RC
 * published before the first release would lose them, so both channels make
 * sure the marker is there. It is empty and never changes. `OWNED_PATHS` is the same list for
 * deploy.yml, which stages exactly those paths and so cannot commit a file
 * outside them even if this script were wrong.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The paths each channel owns in the site checkout, relative to its root. */
export const OWNED_PATHS = {
  rc: ["rc", "gonogo", "index.html", "404.html", ".nojekyll"],
  release: [
    "app",
    "gonogo",
    "index.html",
    "404.html",
    "README.md",
    ".nojekyll",
  ],
};

/**
 * The app's client-side routes. Pages has no server-side routing and serves
 * only the ROOT 404.html as a fallback, which is the landing site's, so each
 * route is written out as a real file or a direct hit on it never boots the app.
 */
export const SPA_ROUTES = ["station", "pilot"];

/**
 * Where the API page goes, relative to the site root. `root` is written with
 * the root paths, by whichever channel writes those. Neither clashes with a
 * redirect: a redirect page is written only at the old app routes (`/gonogo/`,
 * `/gonogo/rc/` and their client-side routes), and Pages serves a real file
 * before it falls back to the root 404.
 */
export const API_PAGE_PATHS = { rc: "rc/api", root: "gonogo/api" };

/** Old project-page URL to new URL for an app served at `appBase`, longest first so the redirect script matches the most specific. */
export function redirectsTo(appBase) {
  return [
    ["/gonogo/rc/", "/rc/"],
    ["/gonogo/", appBase],
  ];
}

export const REDIRECTS = redirectsTo("/app/");

/** The whole of the site repository's README: a pointer at where the project lives. */
const README = "[ksp-gonogo/gonogo](https://github.com/ksp-gonogo/gonogo)\n";

/**
 * A page that sends the browser from an old `/gonogo/...` URL to its new home,
 * keeping the rest of the path, the query string and the hash: a station link
 * or QR code carries its host in the query, and losing it lands on a blank
 * connect form. `fallback` is where the visible link points for a browser
 * with scripts off, which cannot carry the query.
 */
export function redirectPage(
  fallback,
  message = "This page has moved.",
  redirects = REDIRECTS,
) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>gonogo has moved</title>
    <script>
      (function () {
        var moves = ${JSON.stringify(redirects)};
        var path = location.pathname;
        if (path === "/gonogo") path = "/gonogo/";
        for (var i = 0; i < moves.length; i++) {
          if (path.indexOf(moves[i][0]) === 0) {
            location.replace(
              moves[i][1] + path.slice(moves[i][0].length) + location.search + location.hash,
            );
            return;
          }
        }
      })();
    </script>
  </head>
  <body>
    <p>${message} <a href="${fallback}">Continue to gonogo</a>.</p>
  </body>
</html>
`;
}

function replaceDir(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

/** Copies the app into `to` and materialises each client-side route beside it. */
function writeApp(dist, to) {
  replaceDir(dist, to);
  for (const route of SPA_ROUTES) {
    mkdirSync(join(to, route), { recursive: true });
    cpSync(join(to, "index.html"), join(to, route, "index.html"));
  }
}

function writeRedirects(site, redirects) {
  const root = join(site, "gonogo");
  rmSync(root, { recursive: true, force: true });
  for (const [from, to] of redirects) {
    for (const route of ["", ...SPA_ROUTES]) {
      const dir = join(site, from, route);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "index.html"),
        redirectPage(`${to}${route}`, undefined, redirects),
      );
    }
  }
}

const LANDING_APP_LINK = "https://ksp-gonogo.github.io/app/";

function writeApiPage(apiPage, to) {
  if (!existsSync(join(apiPage, "index.html")))
    throw new Error(
      `no API page at ${apiPage}: run scripts/api-page.mjs first`,
    );
  replaceDir(apiPage, to);
}

/** The landing page, its app links pointing at `appBase`, with the redirects and the API page beside them. */
function writeRoot(site, appBase, apiPage) {
  const landing = readFileSync(
    join(REPO_ROOT, "docs/homepage/index.html"),
    "utf8",
  );
  writeFileSync(
    join(site, "index.html"),
    landing.replaceAll(
      LANDING_APP_LINK,
      `https://ksp-gonogo.github.io${appBase}`,
    ),
  );
  // An old deep link that is not one of the written routes still lands here, so the root fallback is the redirect page too.
  writeFileSync(
    join(site, "404.html"),
    redirectPage("/", "Nothing is at this address.", redirectsTo(appBase)),
  );
  writeRedirects(site, redirectsTo(appBase));
  writeApiPage(apiPage, join(site, API_PAGE_PATHS.root));
}

export function compose(channel, dist, apiPage, site) {
  if (channel !== "rc" && channel !== "release")
    throw new Error(`unknown channel "${channel}"`);
  writeFileSync(join(site, ".nojekyll"), "");
  if (channel === "rc") {
    writeApp(dist, join(site, "rc"));
    writeApiPage(apiPage, join(site, API_PAGE_PATHS.rc));
    if (!existsSync(join(site, "app", "index.html")))
      writeRoot(site, "/rc/", apiPage);
    return;
  }

  writeApp(dist, join(site, "app"));
  writeRoot(site, "/app/", apiPage);
  // Written once and then kept: a release never rewrites or removes it.
  if (!existsSync(join(site, "README.md")))
    writeFileSync(join(site, "README.md"), README);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [channel, dist, apiPage, site] = process.argv.slice(2);
  if (!channel || !dist || !apiPage || !site) {
    console.error(
      "usage: pages-compose.mjs <rc|release> <app dist> <api page> <site checkout>",
    );
    process.exit(2);
  }
  compose(channel, resolve(dist), resolve(apiPage), resolve(site));
  console.log(
    `${channel}: wrote ${OWNED_PATHS[channel].join(", ")} in ${resolve(site)}`,
  );
}
