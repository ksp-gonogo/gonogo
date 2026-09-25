// Where each narrow scan looks, for the changed-only local run (scan-scope.mjs).
//
// A scan listed here is skipped locally when no changed file matches its
// domain and none of its own sources changed. A scan NOT listed always runs,
// so leaving one out costs time and never coverage. List a scan only when its
// footprint is plainly narrower than the source tree, and write the domain wide
// enough to hold everything it reads, lists, stats, greps and executes: a
// domain that misses a file makes the local run blind to that file, and only
// the full run in CI would then see it.
//
// `scan-domains.test.ts` holds every entry to the scan's own source: a repo
// path the scan spells out that its domain does not match fails there.

/** A change to any of these runs every scan: the machinery, or the ground under all of them. */
export const SCANS_RUN_ON_ANY_CHANGE = [
  /^packages\/core\/(scan-[^/]+\.m?[jt]s|vitest(\.scans)?\.config\.ts|package\.json)$/,
  /^packages\/core\/src\/scanScope\.ts$/,
  /^packages\/core\/src\/test\/setup\.ts$/,
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json)$/,
  // `git ls-files --exclude-standard` and `git grep --untracked` read these.
  /(^|\/)\.gitignore$/,
  /^\.gitattributes$/,
];

const MOD = /^mod\//;
const GITHUB = /^\.github\//;
const SDK = /^mod\/sitrep-sdk\//;
const UI_KIT = /^packages\/ui-kit\//;
const THEME = /^packages\/theme\//;
/** The shrink-only debt lists `ratchetBaseRef.ts` names, which a scan importing it can read. */
const RATCHET_LISTS = /^packages\/core\/src\/[^/]+\.(allowlist|debt)\.ts$/;

/** Scan test file (relative to packages/core) to the repo paths it can see. */
export const SCAN_DOMAINS = {
  "src/act-gate-update-scope.test.ts": [/^scripts\/act-warning-/],
  "src/asyncapi-document.test.ts": [
    MOD,
    /^asyncapi\.yaml$/,
    /^scripts\/asyncapi/,
  ],
  "src/ci-mandatory-steps.test.ts": [GITHUB],
  "src/ci-test-project-coverage.test.ts": [GITHUB, MOD],
  "src/contract-version-parity.test.ts": [
    MOD,
    RATCHET_LISTS,
    UI_KIT,
    /^packages\/app\/vite\.config\.ts$/,
  ],
  "src/errormsg-correlator-audit.test.ts": [MOD],
  "src/generated-contract-docs.test.ts": [MOD],
  "src/one-render-process.test.ts": [MOD],
  "src/publish-mods-matrix-paths.test.ts": [GITHUB, MOD],
  "src/published-barrel-collisions.test.ts": [SDK, UI_KIT, THEME],
  "src/published-design-doc-refs.test.ts": [SDK, UI_KIT, /^docs\//],
  "src/ratchet-base-ref.test.ts": [/^packages\/core\//],
  "src/reckoning-candidates.test.ts": [MOD, RATCHET_LISTS],
  "src/replay-fixture-conformance.test.ts": [SDK, /^tests\/playwright\//],
  "src/scan-project-membership.test.ts": [/^packages\/core\//],
  "src/styleguide-boundary.test.ts": [/^packages\/sitrep-client\//, UI_KIT],
  "src/styleguide-command-delay-single-source.test.ts": [MOD],
  "src/styleguide-duplicate-primitives.test.ts": [/^packages\/ui\//, UI_KIT],
  "src/styleguide-focus-ring.test.ts": [UI_KIT, THEME],
  "src/styleguide-generated-null-unions.test.ts": [MOD],
  "src/styleguide-no-deprecations.test.ts": [UI_KIT, SDK],
  "src/styleguide-panel-parts.test.ts": [UI_KIT],
  "src/styleguide-reserved-reading-keys.test.ts": [
    SDK,
    /^mod\/Sitrep\.Contract\//,
  ],
  "src/styleguide-shared-published-surface.test.ts": [SDK, UI_KIT],
  "src/styleguide-ui-kit-wildcard-exports.test.ts": [UI_KIT],
  "src/truenow-allowlist.test.ts": [MOD],
  "src/unknown-cast-debt-cli.test.ts": [
    /^scripts\/unknown-cast-debt/,
    /^packages\/core\//,
    UI_KIT,
  ],
  "src/uplink-augment-route.test.ts": [MOD],
  "src/uplink-isolation.test.ts": [
    MOD,
    RATCHET_LISTS,
    /^packages\/[^/]+\/package\.json$/,
  ],
  "src/uplink-matrix-coverage.test.ts": [
    GITHUB,
    MOD,
    /^scripts\/uplink-matrix/,
  ],
  "src/uplink-mod-build-coverage.test.ts": [
    GITHUB,
    MOD,
    /^scripts\/uplink-mod-build/,
  ],
  "src/uplink-tsconfig-parity.test.ts": [MOD, RATCHET_LISTS],
  "src/wire-payload-reachability.test.ts": [
    MOD,
    /^scripts\/wire-payload-coverage/,
    /^scripts\/asyncapi\//,
    /^scripts\/uplink-matrix/,
  ],
  "src/ws-suite-budgets.test.ts": [MOD],
};
