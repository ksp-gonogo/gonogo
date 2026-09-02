#!/usr/bin/env bash
#
# BEFORE/AFTER visual review for a widget-migration branch.
#
# For a branch cut off `origin/staging`, render every CHANGED widget in its
# BEFORE state (as on the base ref) and its AFTER state (as on the branch),
# then composite each widget's two states side by side into ONE labelled PNG so
# an operator can eyeball visual parity at a glance. Also emits a contact-sheet
# montage of every before/after pair.
#
#   scripts/visual-before-after.sh --branch <branch> \
#       [--base <ref>] [--engine <chromium|firefox|webkit>] [--widget <id>]
#
#   --branch   the migration branch (or any ref/sha) = AFTER state.  (required)
#   --base     the reference to diff against = BEFORE state.  (default origin/staging)
#   --engine   render engine.  (default chromium)
#   --widget   render ONLY this widget id, skip the changed-file mapping.
#
# Output: local_docs/renders/_before-after/<branch-slug>/
#   <widget>__<fixture>--<mode>.png   one joined BEFORE|AFTER image per render
#   _contact-sheet.png                all pairs stacked
#
# HOW IT WORKS (thin wrapper over the existing container + probe + compositor):
#   • Both states are rendered inside the SAME CI-faithful Linux container the
#     visual gate uses (scripts/visual-preview.Containerfile), because macOS
#     font rasterisation is noise. Two throwaway git worktrees (base + branch)
#     are checked out so your working tree and the migration branches are never
#     touched.
#   • Each worktree is rendered via `render-widget <id>` (whole-widget,
#     uncropped `fullContent` shots) into that worktree's
#     local_docs/renders/<outPath>/.
#   • The two render trees are stitched on the HOST with ImageMagick.
#
# Prereqs (same as scripts/visual-preview.sh):
#   • podman (default /opt/podman/bin/podman; override with $PODMAN)
#   • ~/.npmrc mounted read-only for @ksp-gonogo registry auth
#   • ImageMagick (`magick`) on the host for compositing
#
# The container does its OWN Linux `pnpm install` into the SAME named volumes
# visual-preview.sh uses, so if you have run that already, re-runs are fast.
set -euo pipefail

PODMAN="${PODMAN:-/opt/podman/bin/podman}"
# MUST match pnpm-lock.yaml's resolved `playwright` version (= what CI installs).
PLAYWRIGHT_VERSION="1.60.0"
IMAGE="${VISUAL_PREVIEW_IMAGE:-localhost/gonogo-visual-preview:pw${PLAYWRIGHT_VERSION}}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STORE_VOL="gonogo-visualpreview-pnpm-store"
NM_PREFIX="gonogo-visualpreview-nm"

# Composite palette.
PANEL_BG="#0b0e14"
CAP_BG="#161b22"
BEFORE_FG="#9aa4b2"
AFTER_FG="#7fd1ff"
HDR_BG="#1f2733"
HDR_FG="#e6edf3"
MISS_FG="#ff8f8f"

usage() {
  echo "usage: visual-before-after.sh --branch <branch> [--base <ref>] [--engine <chromium|firefox|webkit>] [--widget <id>]" >&2
  exit 2
}

BRANCH=""
BASE="origin/staging"
ENGINE="chromium"
WIDGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --base)   BASE="${2:-}"; shift 2 ;;
    --engine) ENGINE="${2:-}"; shift 2 ;;
    --widget) WIDGET="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done
[ -n "$BRANCH" ] || { echo "error: --branch is required" >&2; usage; }
case "$ENGINE" in
  chromium|firefox|webkit) ;;
  *) echo "error: --engine must be chromium|firefox|webkit" >&2; usage ;;
esac

# ── preflight ────────────────────────────────────────────────────────────────
if [ ! -x "$PODMAN" ] && ! command -v "$PODMAN" >/dev/null 2>&1; then
  echo "error: podman not found at '$PODMAN' (set \$PODMAN)" >&2; exit 2
fi
if [ ! -f "$HOME/.npmrc" ]; then
  echo "error: ~/.npmrc not found: needed for registry auth inside the container." >&2; exit 2
fi
MAGICK=""
if command -v magick >/dev/null 2>&1; then MAGICK="magick"
elif command -v convert >/dev/null 2>&1; then MAGICK="convert"
else echo "error: ImageMagick ('magick' or 'convert') not found: needed to composite." >&2; exit 2
fi
mident() { "$MAGICK" identify -format "$1" "$2"; }

BASE_SHA="$(git -C "$REPO_ROOT" rev-parse --verify "${BASE}^{commit}" 2>/dev/null)" \
  || { echo "error: base ref '$BASE' does not resolve" >&2; exit 2; }
BRANCH_SHA="$(git -C "$REPO_ROOT" rev-parse --verify "${BRANCH}^{commit}" 2>/dev/null)" \
  || { echo "error: branch ref '$BRANCH' does not resolve" >&2; exit 2; }

BRANCH_SLUG="$(echo "$BRANCH" | tr '/ ' '--' | tr -cd 'A-Za-z0-9._-')"
OUT_DIR="$REPO_ROOT/local_docs/renders/_before-after/$BRANCH_SLUG"

# ── build the font-baked image on first use (shared with visual-preview.sh) ──
if [ "$IMAGE" = "localhost/gonogo-visual-preview:pw${PLAYWRIGHT_VERSION}" ] \
   && ! "$PODMAN" image exists "$IMAGE" 2>/dev/null; then
  echo "building font-baked image $IMAGE (first time)..."
  "$PODMAN" build \
    --build-arg "PW_VERSION=${PLAYWRIGHT_VERSION}" \
    -t "$IMAGE" \
    -f "$REPO_ROOT/scripts/visual-preview.Containerfile" \
    "$REPO_ROOT/scripts"
fi

# ── work out which widgets to render ─────────────────────────────────────────
# Emit one `<srcDir>\t<widgetId>\t<renderKey>` row per widget config, straight
# from the BRANCH's widgets.ts. Blocks are ordered widgetId → (label?) →
# fixturesPath; `render-widget` resolves a config by `label ?? widgetId`, so the
# RENDER KEY (what we actually pass) is the label when present, else the id. All
# three fields are anchored to the config-level 4-space indent so nested
# `label:`/`id:` inside modes/fixtures never leak in.
widget_map() {
  git -C "$REPO_ROOT" show "${BRANCH_SHA}:packages/components/scripts/widgets.ts" 2>/dev/null | awk '
    /^    widgetId:/     { l=$0; sub(/.*widgetId: "/,"",l);     sub(/".*/,"",l); wid=l; lbl="" }
    /^    label:/        { l=$0; sub(/.*label: "/,"",l);        sub(/".*/,"",l); lbl=l }
    /^    fixturesPath:/ { l=$0; sub(/.*fixturesPath: "/,"",l); sub(/\/.*/,"",l); sub(/".*/,"",l);
                           key=(lbl!="" ? lbl : wid); print l "\t" wid "\t" key }
  '
}
MAP="$(widget_map)"

RENDER_KEYS=()   # what we pass to render-widget (label ?? widgetId)
WIDGET_IDS=()    # the widget ids, for display
seen_key=" "; seen_id=" "
add_key() { # <widgetId> <renderKey>
  case "$seen_key" in *" $2 "*) ;; *) seen_key="${seen_key}$2 "; RENDER_KEYS+=("$2") ;; esac
  case "$seen_id"  in *" $1 "*) ;; *) seen_id="${seen_id}$1 ";  WIDGET_IDS+=("$1") ;; esac
}

if [ -n "$WIDGET" ]; then
  # Expand the requested id to its render keys; if it's already a key (or
  # unknown), fall through to using it verbatim.
  matched=0
  while IFS=$'\t' read -r dir wid key; do
    [ -n "$key" ] || continue
    if [ "$wid" = "$WIDGET" ] || [ "$key" = "$WIDGET" ]; then add_key "$wid" "$key"; matched=1; fi
  done <<< "$MAP"
  [ "$matched" = 1 ] || { WIDGET_IDS=("$WIDGET"); RENDER_KEYS=("$WIDGET"); }
else
  CHANGED="$(git -C "$REPO_ROOT" diff --name-only "$BASE_SHA" "$BRANCH_SHA" -- packages/components/src 'mod/*/client/src' 2>/dev/null || true)"
  if [ -z "$CHANGED" ]; then
    echo "No changed files under packages/components/src or mod/*/client/src between" >&2
    echo "  $BASE ($BASE_SHA)  and  $BRANCH ($BRANCH_SHA)." >&2
    echo "Nothing to review. (Pass --widget <id> to force a widget.)" >&2
    exit 1
  fi
  MOD_COUNT=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      packages/components/src/*)
        srcdir="${f#packages/components/src/}"; srcdir="${srcdir%%/*}"
        # every render key whose fixtures live under this source dir
        while IFS=$'\t' read -r dir wid key; do
          [ "$dir" = "$srcdir" ] || continue
          add_key "$wid" "$key"
        done <<< "$MAP"
        ;;
      mod/*/client/src/*) MOD_COUNT=$((MOD_COUNT + 1)) ;;
    esac
  done <<< "$CHANGED"

  if [ "$MOD_COUNT" -gt 0 ]; then
    echo "note: ${MOD_COUNT} changed mod/*/client widget file(s) are NOT renderable via the" >&2
    echo "      components probe harness and are skipped (uplink client widgets have no fixtures here)." >&2
  fi
  if [ "${#RENDER_KEYS[@]}" -eq 0 ]; then
    echo "error: changed component files did not map to any known widget id." >&2
    echo "       (Changed dirs may be shared/non-widget code. Pass --widget <id> to force one.)" >&2
    exit 1
  fi
fi

echo "image:   $IMAGE"
echo "engine:  $ENGINE"
echo "base:    $BASE  ($BASE_SHA)"
echo "branch:  $BRANCH  ($BRANCH_SHA)"
echo "widgets: ${WIDGET_IDS[*]}"
echo "renders: ${RENDER_KEYS[*]}"
echo "output:  $OUT_DIR"
echo

# ── throwaway worktrees for both states (never touch the working tree) ───────
WORK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/gonogo-ba.XXXXXX")"
BEFORE_WT="$WORK_TMP/before"
AFTER_WT="$WORK_TMP/after"
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$BEFORE_WT" 2>/dev/null || true
  git -C "$REPO_ROOT" worktree remove --force "$AFTER_WT" 2>/dev/null || true
  rm -rf "$WORK_TMP" 2>/dev/null || true
}
trap cleanup EXIT
git -C "$REPO_ROOT" worktree add --detach "$BEFORE_WT" "$BASE_SHA" >/dev/null
git -C "$REPO_ROOT" worktree add --detach "$AFTER_WT"  "$BRANCH_SHA" >/dev/null

# ── render one worktree in the container ─────────────────────────────────────
render_worktree() {
  local wt="$1"; shift
  local keys=("$@")

  # Shadow each workspace package's node_modules with its own named volume so
  # the container's Linux install lands in volumes and never in the checkout.
  local NM_MOUNTS=()
  add_nm() {
    local dir="$1" target slug
    if [ "$dir" = "." ]; then target="/work/node_modules"; slug="root"
    else target="/work/$dir/node_modules"; slug="$(echo "$dir" | tr '/' '-')"; fi
    NM_MOUNTS+=( -v "${NM_PREFIX}-${slug}:${target}" )
  }
  add_nm "."
  local glob
  for glob in "packages"/* "mod"/* "mod"/*/client; do
    [ -f "$wt/$glob/package.json" ] && add_nm "$glob"
  done

  # One render-widget call per render key (reuses the single install+build).
  local RENDERS=""
  local key
  for key in "${keys[@]}"; do
    RENDERS="${RENDERS}
echo '── render-widget ${key} ──'
pnpm --filter @ksp-gonogo/components render-widget \"${key}\" --engine ${ENGINE}"
  done

  local IN_CMD="set -e
corepack enable
echo '── pnpm install (frozen) ──'
pnpm install --frozen-lockfile --store-dir /pnpm-store
echo '── build render deps ──'
pnpm --filter '@ksp-gonogo/components...' build${RENDERS}"

  "$PODMAN" run --rm \
    -v "$wt:/work" \
    -v "$STORE_VOL:/pnpm-store" \
    "${NM_MOUNTS[@]}" \
    -v "$HOME/.npmrc:/root/.npmrc:ro" \
    -w /work \
    "$IMAGE" bash -lc "$IN_CMD"
}

echo "════════ rendering BEFORE ($BASE) ════════"
render_worktree "$BEFORE_WT" "${RENDER_KEYS[@]}"
echo
echo "════════ rendering AFTER ($BRANCH) ════════"
render_worktree "$AFTER_WT" "${RENDER_KEYS[@]}"

# ── composite on the host ────────────────────────────────────────────────────
BEFORE_RENDERS="$BEFORE_WT/local_docs/renders"
AFTER_RENDERS="$AFTER_WT/local_docs/renders"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Caption bar stacked above an image, full image width.
label_panel() { # <img> <caption> <fg> <out>
  local img="$1" cap="$2" fg="$3" out="$4" w
  w="$(mident '%w' "$img")"
  "$MAGICK" \
    \( -size "${w}x38" -background "$CAP_BG" -fill "$fg" -gravity West -pointsize 22 -font '/System/Library/Fonts/Supplemental/Arial.ttf' caption:"  $cap" \) \
    "$img" -background "$PANEL_BG" -append "$out"
}

# Placeholder panel sized to the present side, for a new/removed render.
missing_panel() { # <ref-img> <caption> <out>
  local ref="$1" cap="$2" out="$3" w h
  w="$(mident '%w' "$ref")"; h="$(mident '%h' "$ref")"
  "$MAGICK" \
    \( -size "${w}x38" -background "$CAP_BG" -fill "$MISS_FG" -gravity West -pointsize 22 -font '/System/Library/Fonts/Supplemental/Arial.ttf' caption:"  $cap" \) \
    \( -size "${w}x${h}" -background "#20242c" -fill "#6b7684" -gravity center -pointsize 26 -font '/System/Library/Fonts/Supplemental/Arial.ttf' caption:"(no render)" \) \
    -background "$PANEL_BG" -append "$out"
}

# Union of render paths relative to each worktree's local_docs/renders.
rel_list() { # <root>
  local root="$1"
  [ -d "$root" ] || return 0
  ( cd "$root" && find . -type f -name '*.png' \
      -not -path './_before-after/*' -not -path './_visual-gate*/*' \
      | sed 's|^\./||' )
}
ALL_RELS="$( { rel_list "$BEFORE_RENDERS"; rel_list "$AFTER_RENDERS"; } | sort -u )"

if [ -z "$ALL_RELS" ]; then
  echo "error: no PNG renders were produced in either state (render failed?)." >&2
  exit 1
fi

PAIRS=()
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  before="$BEFORE_RENDERS/$rel"
  after="$AFTER_RENDERS/$rel"
  slug="$(echo "$rel" | sed 's|/|__|g')"
  pair="$OUT_DIR/$slug"
  tmpb="$WORK_TMP/b.png"; tmpa="$WORK_TMP/a.png"

  if [ -f "$before" ]; then
    label_panel "$before" "BEFORE  ($BASE)" "$BEFORE_FG" "$tmpb"
  else
    missing_panel "$after" "BEFORE  ($BASE)" "$tmpb"
  fi
  if [ -f "$after" ]; then
    label_panel "$after" "AFTER  ($BRANCH)" "$AFTER_FG" "$tmpa"
  else
    missing_panel "$before" "AFTER  ($BRANCH)" "$tmpa"
  fi

  # BEFORE | gap | AFTER, then a header strip naming the render.
  "$MAGICK" "$tmpb" \( -size 10x1 xc:"$PANEL_BG" \) "$tmpa" -background "$PANEL_BG" +append "$WORK_TMP/pair.png"
  pw="$(mident '%w' "$WORK_TMP/pair.png")"
  "$MAGICK" \
    \( -size "${pw}x44" -background "$HDR_BG" -fill "$HDR_FG" -gravity West -pointsize 24 -font '/System/Library/Fonts/Supplemental/Arial.ttf' caption:"  $rel" \) \
    "$WORK_TMP/pair.png" -background "$PANEL_BG" -append "$pair"
  PAIRS+=("$pair")
  echo "  ✓ $slug"
done <<< "$ALL_RELS"

# Contact sheet: every pair stacked in one column.
CONTACT="$OUT_DIR/_contact-sheet.png"
if command -v montage >/dev/null 2>&1; then
  montage "${PAIRS[@]}" -tile 1x -geometry +0+18 -background "$PANEL_BG" "$CONTACT"
else
  "$MAGICK" "${PAIRS[@]}" -background "$PANEL_BG" -append "$CONTACT"
fi

echo
echo "════════════ BEFORE/AFTER SUMMARY ════════════"
echo "engine:  $ENGINE"
echo "widgets: ${WIDGET_IDS[*]}"
echo "${#PAIRS[@]} joined before/after image(s) →"
echo "  $OUT_DIR"
echo "contact sheet:"
echo "  $CONTACT"
