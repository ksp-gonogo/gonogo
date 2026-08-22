#!/usr/bin/env bash
# gonogo_claude_tools.sh: purpose-scoped helpers Claude Code can invoke
# without per-call permission prompts.
#
# Allow-list once in .claude/settings.local.json:
#   "Bash(./scripts/gonogo_claude_tools.sh *)"
#
# Each subcommand does ONE thing. New functionality means adding a
# subcommand here, not a new allow-list entry.
#
# Subcommands:
#   decompile <Type> [<Type>...]
#       Print public/protected/private/internal signatures of a KSP type
#       from the synced kspdata Managed/ DLLs. Falls back across DLLs
#       on miss; if a bare name still doesn't match, auto-resolves the
#       fully-qualified name (a la `findtype`) and retries. Output is
#       filtered to signature lines only and capped at 80 lines per type.
#
#   findtype <Name> [<Name>...]
#       Resolve simple type names to their fully-qualified namespace.Type
#       form. Searches every DLL in the synced kspdata Managed/ folder
#       and prints `<FQN> (in <dll>)` per match. First call per session
#       is slow (~30s per DLL on cold cache); subsequent calls reuse
#       the textual disassembly cache in /tmp/gonogo-decompile-cache/.
#
#   dump <Type> [<Type>...]
#       Like decompile, but prints the full ilspycmd output for the type
#       (method bodies, field initialisers, the lot): no signature
#       filter. Same Tier 1/2/3 fallback as decompile. Use when you need
#       to see what a method actually does, not just its signature.
#
#   members <Type> [<Type>...]
#       Lists every public member (field / property / method) inside
#       a type by line-range scan of the cached full disassembly.
#       Unlike `decompile`, has no per-type cap, useful for large
#       classes like KSP's `Part` (5000+ lines) where the 80-line
#       decompile filter truncates before reaching the interesting
#       fields. Output is one member per line, in source order. Falls
#       back to findtype for namespaced lookups; you can pass either
#       `Part` or `Strategies.Strategy`.
#
#   body <Type> <Method>
#       Print one method's body from the cached disassembly. Pairs
#       with `members`: use `members` to spot a method by signature,
#       then `body` to see what it actually does. Returns the first
#       overload that matches by name; if you have overloads, use
#       `dump` instead. Detects the matching close-brace by indent
#       level (ilspycmd output is consistently formatted).
#
#   build ocisly [--baseline]
#       Build the OCISLY fork at ~/personal/OfCourseIStillLoveYou/
#       and copy OfCourseIStillLoveYou.dll into the synced
#       kspdata GameData/OfCourseIStillLoveYou/Plugins/ directory.
#       With --baseline, defines KERBCAST_BASELINE to enable per-frame
#       capture-timing CSV output + KSP-timestamp piggybacked on the
#       Altitude metadata field. See local_docs/kerbcast/baseline_harness_plan.md.
#
#   build kerbcast
#       Build the kerbcast KSP plugin at ~/personal/kerbcast/Plugin/,
#       install it into the synced kspdata at GameData/Kerbcast/Plugins/,
#       seed libAsyncGPUReadbackPlugin.so + settings.cfg on first
#       install, and (best-effort) pull the latest CI-built sidecar
#       binary into GameData/Kerbcast/sidecar/ via `gh run download`.
#       Sidecar fetch is best-effort: skips silently if gh isn't
#       installed / not authed / no successful run found.
#
#   build gonogo
#       Build the first-party Gonogo.KSP mod (mod/Gonogo.KSP/Gonogo.KSP.csproj)
#       and copy Gonogo.dll + the net472-flavored Sitrep.*.dll deps into the
#       synced kspdata GameData/Gonogo/Plugins/ directory.
#
#   help
#       Print this comment block.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The syncthing mirror is the normal local path. A cloud session has no
# syncthing, but the CI image carries the same Managed directory, so fall back
# to it rather than reporting "no KSP assemblies" and skipping a decompile that
# was actually possible. KSP_MANAGED_DIR overrides both.
DLL="$ROOT/local_docs/syncthing/kspdata/KSP_Data/Managed/Assembly-CSharp.dll"
if [ -n "${KSP_MANAGED_DIR:-}" ] && [ -f "$KSP_MANAGED_DIR/Assembly-CSharp.dll" ]; then
  DLL="$KSP_MANAGED_DIR/Assembly-CSharp.dll"
elif [ ! -f "$DLL" ] && [ -f "/workspace/ksp-managed/KSP_Data/Managed/Assembly-CSharp.dll" ]; then
  DLL="/workspace/ksp-managed/KSP_Data/Managed/Assembly-CSharp.dll"
fi
ILSPYCMD="$HOME/.dotnet/tools/ilspycmd"
DECOMPILE_TIMEOUT_S=60
BUILD_TIMEOUT_S=300
TELE_TIMEOUT_S=15

# Internal: resolve a type name to its full ilspycmd dump using a
# three-tier strategy. Sets these globals on success:
#   _RT_RAW         : the full ilspycmd textual output for the type
#   _RT_SOURCE_DLL  : absolute path of the DLL that owned the type
#   _RT_RESOLVED_FQN: empty if the bare name worked; the FQN if Tier 3
#                      had to expand a bare name
# All three are reset to empty when the type can't be located anywhere.
# Globals (vs. echo) keep the multi-line raw output untouched.
_resolve_type() {
  _RT_RAW=""
  _RT_SOURCE_DLL=""
  _RT_RESOLVED_FQN=""
  local t="$1"
  local managed_dir
  managed_dir="$(dirname "$DLL")"

  # Tier 1: Assembly-CSharp.dll: almost every gameplay type lives here.
  # `|| true` keeps `set -e` from killing the script when ilspycmd exits
  # non-zero on a type-not-found miss.
  _RT_RAW="$(perl -e 'alarm shift; exec @ARGV' "$DECOMPILE_TIMEOUT_S" \
    "$ILSPYCMD" "$DLL" -t "$t" 2>/dev/null || true)"
  if [ -n "$_RT_RAW" ]; then
    _RT_SOURCE_DLL="$DLL"
    return 0
  fi

  # Tier 2: walk the other Managed/ DLLs until one yields a non-empty
  # result. Bare name only: namespaced types fall through to Tier 3.
  for cand in "$managed_dir"/*.dll; do
    [ "$cand" = "$DLL" ] && continue
    local try
    try="$(perl -e 'alarm shift; exec @ARGV' "$DECOMPILE_TIMEOUT_S" \
      "$ILSPYCMD" "$cand" -t "$t" 2>/dev/null || true)"
    if [ -n "$try" ]; then
      _RT_RAW="$try"
      _RT_SOURCE_DLL="$cand"
      return 0
    fi
  done

  # Tier 3: bare-name lookups all missed. Type might be namespaced,
  # resolve the FQN via findtype's textual-dump search and retry. Pays
  # the dump-cost once per session; cache makes repeated lookups cheap.
  local fqn_line
  fqn_line="$(_findtype_emit "$t" | head -1 || true)"
  if [ -n "$fqn_line" ]; then
    _RT_RESOLVED_FQN="${fqn_line%% (in *}"
    local fqn_dll="${fqn_line#* (in }"
    fqn_dll="${fqn_dll%)}"
    _RT_RAW="$(perl -e 'alarm shift; exec @ARGV' "$DECOMPILE_TIMEOUT_S" \
      "$ILSPYCMD" "$managed_dir/$fqn_dll" -t "$_RT_RESOLVED_FQN" 2>/dev/null || true)"
    if [ -n "$_RT_RAW" ]; then
      _RT_SOURCE_DLL="$managed_dir/$fqn_dll"
      return 0
    fi
  fi
}

decompile() {
  if [ "$#" -lt 1 ]; then
    echo "usage: gonogo_claude_tools.sh decompile <Type> [<Type>...]"
    return 2
  fi
  if [ ! -f "$DLL" ]; then
    echo "Assembly-CSharp.dll not found at $DLL"
    echo "(kspdata syncthing folder must be synced)"
    return 3
  fi
  if [ ! -x "$ILSPYCMD" ]; then
    echo "ilspycmd not found at $ILSPYCMD"
    echo "Install with: dotnet tool install -g ilspycmd"
    return 4
  fi
  for t in "$@"; do
    _resolve_type "$t"
    if [ -n "$_RT_RAW" ]; then
      local title="$t"
      [ -n "$_RT_RESOLVED_FQN" ] && title="$t → $_RT_RESOLVED_FQN"
      echo "=== $title (in $(basename "$_RT_SOURCE_DLL")) ==="
      echo "$_RT_RAW" \
        | grep -E '^[[:space:]]*(public|protected|private|internal|\[|class |enum |struct |namespace |using )' \
        | head -80
    else
      echo "=== $t ==="
      echo "(not found in any Managed/ DLL)"
    fi
    echo
  done
}

dump() {
  if [ "$#" -lt 1 ]; then
    echo "usage: gonogo_claude_tools.sh dump <Type> [<Type>...]"
    return 2
  fi
  if [ ! -f "$DLL" ]; then
    echo "Assembly-CSharp.dll not found at $DLL"
    return 3
  fi
  if [ ! -x "$ILSPYCMD" ]; then
    echo "ilspycmd not found at $ILSPYCMD"
    return 4
  fi
  for t in "$@"; do
    _resolve_type "$t"
    if [ -n "$_RT_RAW" ]; then
      local title="$t"
      [ -n "$_RT_RESOLVED_FQN" ] && title="$t → $_RT_RESOLVED_FQN"
      echo "=== $title (in $(basename "$_RT_SOURCE_DLL")) ==="
      echo "$_RT_RAW"
    else
      echo "=== $t ==="
      echo "(not found in any Managed/ DLL)"
    fi
    echo
  done
}

# Internal: extract the body line-range of a type in a cached
# disassembly. Sets these globals:
#   _RANGE_FILE : cache file the type lives in
#   _RANGE_LO   : first line number (the class/interface/struct/enum line)
#   _RANGE_HI   : last line number, exclusive (next top-level type, or file end)
#   _RANGE_DLL  : basename of the originating DLL
# Empty file/lo/hi if the bare name isn't found. Use after the cache has
# been built (i.e. after at least one _findtype_emit run this session).
_resolve_type_range() {
  _RANGE_FILE=""
  _RANGE_LO=""
  _RANGE_HI=""
  _RANGE_DLL=""
  local name="$1"
  local managed_dir
  managed_dir="$(dirname "$DLL")"
  local cache_dir="/tmp/gonogo-decompile-cache"
  for cand in "$managed_dir"/*.dll; do
    local cache="$cache_dir/$(basename "$cand").txt"
    [ -f "$cache" ] || continue
    # Find the FIRST line declaring this type. ilspycmd indents types
    # one tab when they're inside a `namespace …;` block, so allow
    # leading whitespace before the modifiers.
    # `|| true` keeps `set -euo pipefail` from killing the function on
    # a grep miss (return 1 = "no match" propagates through the pipe).
    local lo
    lo="$( { grep -nE "^[[:space:]]*(public |internal |abstract |sealed |static )*((public |internal |abstract |sealed |static )*)(class|interface|struct|enum) ${name}([[:space:]<:]|$)" "$cache" 2>/dev/null || true ; } | head -1 | cut -d: -f1)"
    [ -z "$lo" ] && continue
    # Find the NEXT sibling type declaration after $lo at the SAME
    # indent level: that's the exclusive upper bound. Picking
    # "same indent" rather than "any depth" prevents nested classes
    # from cutting the parent short.
    local lo_indent
    lo_indent="$(awk -v lo="$lo" 'NR==lo { match($0, /^[[:space:]]*/); print RLENGTH; exit }' "$cache")"
    local hi
    hi="$(awk -v lo="$lo" -v ind="$lo_indent" '
      NR>lo {
        match($0, /^[[:space:]]*/)
        # Strict same-or-shallower indent + a type keyword.
        if (RLENGTH <= ind && $0 ~ /(public |internal |abstract |sealed |static )*(class|interface|struct|enum) /) {
          print NR; exit
        }
      }
    ' "$cache")"
    [ -z "$hi" ] && hi="$(wc -l < "$cache" | tr -d ' ')"
    _RANGE_FILE="$cache"
    _RANGE_LO="$lo"
    _RANGE_HI="$hi"
    _RANGE_DLL="$(basename "$cand")"
    return 0
  done
}

body() {
  if [ "$#" -lt 2 ]; then
    echo "usage: gonogo_claude_tools.sh body <Type> <Method>"
    echo "  Print one method's body from the cached disassembly. Useful"
    echo "  when you've spotted a method via 'members' and want to see"
    echo "  what it actually does (KSP's null-checks, side effects,"
    echo "  fallback paths). Returns the first overload that matches"
    echo "  by name."
    return 2
  fi
  if [ ! -f "$DLL" ]; then
    echo "Assembly-CSharp.dll not found at $DLL"
    return 3
  fi
  local t="$1"
  local m="$2"
  # Hydrate the disassembly cache the same way 'members' does.
  _findtype_emit "$t" > /dev/null 2>&1
  _resolve_type_range "$t"
  if [ -z "$_RANGE_FILE" ]; then
    local fqn_line
    fqn_line="$(_findtype_emit "$t" | head -1 || true)"
    if [ -n "$fqn_line" ]; then
      local fqn="${fqn_line%% (in *}"
      local leaf="${fqn##*.}"
      _resolve_type_range "$leaf"
    fi
  fi
  if [ -z "$_RANGE_FILE" ]; then
    echo "=== $t::$m ==="
    echo "(type not found in any cached disassembly)"
    return 1
  fi
  # Find the method declaration. We accept any public/protected/private
  # modifier so non-public bodies are still inspectable. The method must
  # be at strictly deeper indent than the class declaration (its body).
  local class_indent
  class_indent="$(awk -v lo="$_RANGE_LO" 'NR==lo { match($0, /^[[:space:]]*/); print RLENGTH; exit }' "$_RANGE_FILE")"
  local match
  match="$(awk \
    -v lo="$_RANGE_LO" -v hi="$_RANGE_HI" -v m="$m" -v ci="$class_indent" '
    NR > lo && NR < hi {
      match($0, /^[[:space:]]*/)
      ind = RLENGTH
      if (ind <= ci) next
      # Match signature: "<modifiers> [type] m("  or "<modifiers> [type] m<…>("
      # Skip variable declarations by requiring an `(` after the name.
      pat = "(public|protected|private|internal|static)[^(]*[[:space:]]+" m "[[:space:]<(]"
      if ($0 ~ pat) {
        print NR ":" ind
        exit
      }
    }
  ' "$_RANGE_FILE")"
  if [ -z "$match" ]; then
    echo "=== $t::$m ==="
    echo "(method not found in $t within lines $_RANGE_LO..$_RANGE_HI)"
    return 1
  fi
  local sig_line="${match%%:*}"
  local sig_indent="${match##*:}"
  # Walk forward looking for the matching close-brace at the same indent
  # as the signature. ilspycmd's output is consistently brace-matched at
  # indent level so this works without a full brace-counter.
  local end_line
  end_line="$(awk -v from="$sig_line" -v si="$sig_indent" '
    NR > from {
      match($0, /^[[:space:]]*/)
      if (RLENGTH == si && $0 ~ /^[[:space:]]*}[[:space:]]*$/) {
        print NR; exit
      }
    }
  ' "$_RANGE_FILE")"
  [ -z "$end_line" ] && end_line="$_RANGE_HI"
  echo "=== $t::$m (in $_RANGE_DLL, lines $sig_line..$end_line) ==="
  awk -v lo="$sig_line" -v hi="$end_line" 'NR>=lo && NR<=hi { print }' "$_RANGE_FILE"
  echo
}

members() {
  if [ "$#" -lt 1 ]; then
    echo "usage: gonogo_claude_tools.sh members <Type> [<Type>...]"
    echo "  Lists every public member (field / property / method)"
    echo "  declared inside a type, by line-range scan of the cached"
    echo "  full disassembly. Use this when 'decompile' gets truncated"
    echo "  at 80 lines: `members` has no per-type cap."
    return 2
  fi
  if [ ! -f "$DLL" ]; then
    echo "Assembly-CSharp.dll not found at $DLL"
    return 3
  fi
  if [ ! -x "$ILSPYCMD" ]; then
    echo "ilspycmd not found at $ILSPYCMD"
    return 4
  fi
  for t in "$@"; do
    # Ensure the textual cache exists; _findtype_emit hydrates per-DLL
    # caches on first call this session.
    _findtype_emit "$t" > /dev/null 2>&1
    _resolve_type_range "$t"
    # Fallback: type might be namespaced. Resolve its FQN to the bare
    # leaf and retry the range scan with that.
    if [ -z "$_RANGE_FILE" ]; then
      local fqn_line
      fqn_line="$(_findtype_emit "$t" | head -1 || true)"
      if [ -n "$fqn_line" ]; then
        local fqn="${fqn_line%% (in *}"
        local leaf="${fqn##*.}"
        _resolve_type_range "$leaf"
      fi
    fi
    if [ -z "$_RANGE_FILE" ]; then
      echo "=== $t ==="
      echo "(not found in any cached disassembly)"
      echo
      continue
    fi
    echo "=== $t (in $_RANGE_DLL, lines $_RANGE_LO..$_RANGE_HI) ==="
    # Filter to public members at any nesting depth inside the type body.
    # Skip the class-declaration line itself; skip lines that are nested
    # class declarations (those start their own scope and clutter the
    # listing: use a separate `members` call to inspect them).
    awk -v lo="$_RANGE_LO" -v hi="$_RANGE_HI" '
      NR > lo && NR < hi {
        # Public members appear with at least one leading tab.
        if (match($0, /^[[:space:]]+public /)) {
          # Skip nested class/interface/struct/enum declarations.
          if ($0 ~ /public (class|interface|struct|enum) /) next
          print
        }
      }
    ' "$_RANGE_FILE"
    echo
  done
}

# Internal: emit `<FQN> (in <dll>)` lines for every DLL containing a
# class/interface/struct/enum named exactly $1. Caches textual dumps
# in /tmp/gonogo-decompile-cache/.
_findtype_emit() {
  local name="$1"
  local managed_dir
  managed_dir="$(dirname "$DLL")"
  local cache_dir="/tmp/gonogo-decompile-cache"
  mkdir -p "$cache_dir"
  for cand in "$managed_dir"/*.dll; do
    local cache="$cache_dir/$(basename "$cand").txt"
    if [ ! -f "$cache" ] || [ "$cand" -nt "$cache" ]; then
      perl -e 'alarm shift; exec @ARGV' 90 \
        "$ILSPYCMD" "$cand" > "$cache" 2>/dev/null || true
    fi
    awk -v t="$name" -v dll="$(basename "$cand")" '
      /^namespace /{ns=$2; sub(/[;{].*/,"",ns)}
      $0 ~ "(class|interface|struct|enum) " t "([[:space:]<:]|$)" {
        if (ns) print ns "." t " (in " dll ")"
        else    print t " (in " dll ")"
      }
    ' "$cache"
  done | sort -u
}

findtype() {
  if [ "$#" -lt 1 ]; then
    echo "usage: gonogo_claude_tools.sh findtype <Name> [<Name>...]"
    return 2
  fi
  if [ ! -f "$DLL" ]; then
    echo "Assembly-CSharp.dll not found at $DLL"
    return 3
  fi
  if [ ! -x "$ILSPYCMD" ]; then
    echo "ilspycmd not found at $ILSPYCMD"
    return 4
  fi
  for t in "$@"; do
    local lines
    lines="$(_findtype_emit "$t")"
    if [ -z "$lines" ]; then
      echo "$t: not found"
    else
      echo "$lines"
    fi
  done
}

build_ocisly() {
  # The Mac-friendly SDK-style csproj lives in the syncthing fork dir;
  # source-of-truth .cs files live in ~/personal/OfCourseIStillLoveYou/.
  # The .Mac.csproj points <Compile Include> at those .cs files via $ForkRoot.
  local mac_proj_dir="$ROOT/local_docs/syncthing/ocisly-fork"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/OfCourseIStillLoveYou/Plugins"
  local baseline=""
  if [ "${1:-}" = "--baseline" ]; then
    baseline="/p:KerbcastBaseline=true"
    echo "=== building OCISLY fork (KERBCAST_BASELINE enabled) ==="
  else
    echo "=== building OCISLY fork ==="
  fi
  if [ ! -f "$mac_proj_dir/OfCourseIStillLoveYou.Mac.csproj" ]; then
    echo "OfCourseIStillLoveYou.Mac.csproj not found at $mac_proj_dir"
    return 3
  fi
  if [ ! -d "$install_dir" ]; then
    echo "kspdata GameData/OfCourseIStillLoveYou/Plugins not found at $install_dir"
    return 3
  fi
  (
    cd "$mac_proj_dir"
    perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
      dotnet build OfCourseIStillLoveYou.Mac.csproj -c Release --nologo -v minimal $baseline
  )
  local out_dll="$mac_proj_dir/bin/Release/OfCourseIStillLoveYou.dll"
  if [ ! -f "$out_dll" ]; then
    echo "OfCourseIStillLoveYou.dll not produced at $out_dll"
    return 4
  fi
  cp "$out_dll" "$install_dir/OfCourseIStillLoveYou.dll"
  echo "=== installed ==="
  ls -la "$install_dir/OfCourseIStillLoveYou.dll"
}

build_kerbcast() {
  local proj="$HOME/personal/kerbcast/Plugin/Kerbcast.csproj"
  local ksp_root="$ROOT/local_docs/syncthing/kspdata"
  local managed="$ksp_root/KSP_Data/Managed"
  local gamedata="$ksp_root/GameData"
  local install_dir="$gamedata/Kerbcast/Plugins"
  local install_native="$install_dir/x86_64"
  local seed_so="$gamedata/OfCourseIStillLoveYou/Plugins/x86_64/libAsyncGPUReadbackPlugin.so"

  if [ ! -f "$proj" ]; then
    echo "kerbcast csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$managed" ]; then
    echo "kspdata Managed/ not found at $managed"
    return 3
  fi

  mkdir -p "$install_dir" "$install_native"

  echo "=== building kerbcast plugin ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal \
      "/p:KspManaged=$managed" \
      "/p:KspGameData=$gamedata"

  local out_dll="$HOME/personal/kerbcast/Plugin/bin/Release/Kerbcast.dll"
  if [ ! -f "$out_dll" ]; then
    echo "Kerbcast.dll not produced at $out_dll"
    return 4
  fi
  cp "$out_dll" "$install_dir/Kerbcast.dll"

  # Seed the native AsyncGPUReadback .so on first install. Reuses the
  # copy already living in the OCISLY mod's tree; once kerbcast ships
  # its own download path, this fallback drops away.
  if [ ! -f "$install_native/libAsyncGPUReadbackPlugin.so" ]; then
    if [ -f "$seed_so" ]; then
      cp "$seed_so" "$install_native/libAsyncGPUReadbackPlugin.so"
      echo "seeded libAsyncGPUReadbackPlugin.so from OCISLY install"
    else
      echo "warning: libAsyncGPUReadbackPlugin.so not found at $seed_so"
      echo "         place it at $install_native/ before launching KSP"
    fi
  fi

  # Seed settings.cfg on first install only; never clobber user edits.
  local settings_dest="$gamedata/Kerbcast/settings.cfg"
  local settings_src="$HOME/personal/kerbcast/Plugin/settings.cfg"
  if [ ! -f "$settings_dest" ] && [ -f "$settings_src" ]; then
    cp "$settings_src" "$settings_dest"
    echo "seeded settings.cfg (defaults: 127.0.0.1:8088, 1024x576)"
  fi

  # Pull the latest CI-built sidecar binary if gh is available + auth'd.
  # The sidecar is Rust + cross-compiles to Linux x86_64 in CI (QEMU on
  # the Mac is a non-starter, rustc segfaults under amd64 emulation).
  # Best-effort: a failure here doesn't abort the helper; the existing
  # binary in place still works.
  #
  # The CI artefact now contains both the binary and a sibling lib/
  # directory with bundled ffmpeg .so files (SteamOS doesn't ship
  # libavutil.so.58 etc). fetch_kerbcast_sidecar takes the sidecar dir
  # and writes both pieces in the layout the plugin's LD_LIBRARY_PATH
  # prepend expects.
  local sidecar_dir="$gamedata/Kerbcast/sidecar"
  local sidecar_dest="$sidecar_dir/kerbcast-sidecar"
  mkdir -p "$sidecar_dir"
  fetch_kerbcast_sidecar "$sidecar_dir"

  echo "=== installed ==="
  ls -la \
    "$install_dir/Kerbcast.dll" \
    "$install_native/libAsyncGPUReadbackPlugin.so" \
    "$settings_dest" \
    "$profile_dest" \
    "$sidecar_dest" 2>&1 || true
  if [ -d "$sidecar_dir/lib" ]; then
    echo "bundled ffmpeg libs:"
    ls -la "$sidecar_dir/lib/" 2>&1 || true
  fi
}

# Best-effort fetch of the latest successful sidecar-ci artefact from
# github.com/jonpepler/kerbcast. Skips silently if `gh` isn't installed
# / not authed / no successful run yet, so first-time-on-a-fresh-clone
# users with no gh setup just keep the existing binary (or get a
# "place it manually" warning from build_kerbcast's caller).
fetch_kerbcast_sidecar() {
  # Takes the sidecar *directory* (not the binary path), the CI artefact
  # is a binary + sibling lib/ with bundled ffmpeg .so files, and the
  # plugin's LD_LIBRARY_PATH prepend expects them as siblings on disk.
  local dest_dir="$1"
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh CLI not installed: skipping sidecar fetch"
    return 0
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "gh CLI not authed: skipping sidecar fetch (run 'gh auth login')"
    return 0
  fi

  local kerbcast_repo="$HOME/personal/kerbcast"
  if [ ! -d "$kerbcast_repo/.git" ]; then
    echo "kerbcast repo not at $kerbcast_repo: skipping sidecar fetch"
    return 0
  fi

  echo "=== fetching latest sidecar-ci artefact ==="
  local run_id
  # Most recent successful sidecar-ci run on main, JSON-pluck the id.
  run_id="$(
    perl -e 'alarm shift; exec @ARGV' 30 \
      gh -R jonpepler/kerbcast run list \
        --workflow=sidecar-ci.yml \
        --branch main \
        --status success \
        --limit 1 \
        --json databaseId \
        --jq '.[0].databaseId' 2>/dev/null
  )"
  if [ -z "$run_id" ]; then
    echo "no successful sidecar-ci run found, skipping fetch"
    return 0
  fi
  echo "fetching from run $run_id"

  local tmpdir
  tmpdir="$(mktemp -d)"
  if perl -e 'alarm shift; exec @ARGV' 90 \
       gh -R jonpepler/kerbcast run download "$run_id" \
         -n kerbcast-sidecar-linux-x64-dev \
         -D "$tmpdir" >/dev/null 2>&1; then
    if [ -f "$tmpdir/kerbcast-sidecar" ]; then
      mkdir -p "$dest_dir"
      cp "$tmpdir/kerbcast-sidecar" "$dest_dir/kerbcast-sidecar"
      chmod +x "$dest_dir/kerbcast-sidecar"

      # Replace the bundled lib/ wholesale so stale .so files from a
      # previous run don't accumulate (e.g. ffmpeg minor-version bump
      # leaving libavcodec.so.60 alongside .so.61).
      if [ -d "$tmpdir/lib" ]; then
        rm -rf "$dest_dir/lib"
        cp -R "$tmpdir/lib" "$dest_dir/lib"
        [ -f "$tmpdir/build-info.txt" ] && cp "$tmpdir/build-info.txt" "$dest_dir/build-info.txt"
        echo "deployed sidecar + lib/ from CI run $run_id"
        [ -f "$dest_dir/build-info.txt" ] && cat "$dest_dir/build-info.txt"
      else
        echo "warning: artefact has kerbcast-sidecar but no lib/, older CI run before bundling landed?"
        echo "deployed sidecar (no lib/) from CI run $run_id"
      fi
    else
      echo "warning: artefact downloaded but no kerbcast-sidecar inside"
    fi
  else
    echo "warning: sidecar artefact download failed; keeping existing binary"
  fi
  rm -rf "$tmpdir"
}

build_gonogo() {
  local proj="$ROOT/mod/Gonogo.KSP/Gonogo.KSP.csproj"
  local out_dir="$ROOT/mod/Gonogo.KSP/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/Gonogo/Plugins"
  if [ ! -f "$proj" ]; then
    echo "Gonogo.KSP csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building Gonogo.KSP ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/Gonogo.dll" ]; then
    echo "Gonogo.dll not produced (missing at $out_dir/Gonogo.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # Gonogo.dll + every net472-flavored Sitrep.*.dll dep copied alongside it
  # by CopyLocalLockFileAssemblies (Sitrep.Host/Core/Transport/Contract):
  # deploy the whole set, no ILRepack single-file merge yet.
  local deployed=()
  local dll
  for dll in "$out_dir"/Gonogo.dll "$out_dir"/Sitrep.*.dll; do
    [ -f "$dll" ] || continue
    cp "$dll" "$install_dir/"
    deployed+=("$(basename "$dll")")
  done
  echo "=== deployed to $install_dir ==="
  printf '  %s\n' "${deployed[@]}"
  ls -la "$install_dir"
}

build_gonogoscansatuplink() {
  local proj="$ROOT/mod/GonogoScansatUplink/GonogoScansatUplink.csproj"
  local out_dir="$ROOT/mod/GonogoScansatUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoScansatUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoScansatUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoScansatUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoScansatUplink.dll" ]; then
    echo "GonogoScansatUplink.dll not produced (missing at $out_dir/GonogoScansatUplink.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoScansatUplink.dll AND GonogoScansatUplink.Contract.dll: the
  # uplink-types-out-of-core plan split the five Scan* payload types
  # (ScanningVesselEntry/ScanSensorEntry/ScanTrackColor/ScanScienceEntry/
  # ScanAnomalyEntry) into their own contract-slice project (Private="true",
  # the default, so `dotnet build` DOES copy it into $out_dir, unlike the
  # references below). Sitrep.Contract.dll (provided by GonogoCore) and
  # SCANsat.dll/SCANsat.Unity.dll (provided by the user's SCANsat install) are
  # reference-only (Private="false") and must NOT be copied here - see
  # .superpowers/sdd/uplink-packaging-pattern.md. Applies the deploy-script
  # lesson the MechJeb pilot's build_gonogomechjebuplink fixed (and
  # build_gonogoavionicsuplink/build_gonogokerbcastuplink applied from day
  # one): a single-DLL copy here would silently drop the Contract.dll from the
  # deployed GameData folder and break the mod at KSP load.
  cp "$out_dir/GonogoScansatUplink.dll" "$install_dir/"
  if [ ! -f "$out_dir/GonogoScansatUplink.Contract.dll" ]; then
    echo "GonogoScansatUplink.Contract.dll not produced (missing at $out_dir/GonogoScansatUplink.Contract.dll)"
    return 4
  fi
  cp "$out_dir/GonogoScansatUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

build_gonogorealantennasuplink() {
  local proj="$ROOT/mod/GonogoRealAntennasUplink/GonogoRealAntennasUplink.csproj"
  local out_dir="$ROOT/mod/GonogoRealAntennasUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoRealAntennasUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoRealAntennasUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoRealAntennasUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoRealAntennasUplink.dll" ]; then
    echo "GonogoRealAntennasUplink.dll not produced (missing at $out_dir/GonogoRealAntennasUplink.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoRealAntennasUplink.dll AND GonogoRealAntennasUplink.Contract.dll: the
  # uplink-types-out-of-core plan split this Uplink's three wire payload types
  # into their own contract-slice project (Private="true", the default, so
  # `dotnet build` DOES copy it into $out_dir, unlike the reference below).
  # Sitrep.Contract.dll (provided by GonogoCore) stays reference-only
  # (Private="false") and must NOT be copied here - see
  # .superpowers/sdd/uplink-packaging-pattern.md. RealAntennas itself is never a
  # compile-time reference (reflection-only, see the csproj header comment), so
  # there's no RA DLL to exclude here either. This is the same deploy-script
  # lesson the earlier relocations' build functions record: a single-DLL copy
  # here would silently drop the Contract.dll from the deployed GameData folder
  # and break the mod at KSP load, with nothing in the build going red.
  cp "$out_dir/GonogoRealAntennasUplink.dll" "$install_dir/"
  if [ ! -f "$out_dir/GonogoRealAntennasUplink.Contract.dll" ]; then
    echo "GonogoRealAntennasUplink.Contract.dll not produced (missing at $out_dir/GonogoRealAntennasUplink.Contract.dll)"
    return 4
  fi
  cp "$out_dir/GonogoRealAntennasUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

build_gonogokosuplink() {
  local proj="$ROOT/mod/GonogoKosUplink/GonogoKosUplink.csproj"
  local out_dir="$ROOT/mod/GonogoKosUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoKosUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoKosUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoKosUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoKosUplink.dll" ]; then
    echo "GonogoKosUplink.dll not produced (missing at $out_dir/GonogoKosUplink.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoKosUplink.dll AND GonogoKosUplink.Contract.dll: the
  # uplink-types-out-of-core plan split the eleven kOS payload/command-arg types
  # into their own contract-slice project (Private="true", the default, so
  # `dotnet build` DOES copy it into $out_dir, unlike the references below).
  # Sitrep.*.dll (provided by GonogoCore) and kOS.dll/kOS.Safe.dll/0Harmony.dll
  # (provided by the user's kOS + Harmony installs) stay reference-only
  # (Private="false") and must NOT be copied here - see
  # .superpowers/sdd/uplink-packaging-pattern.md. This is the same deploy-script
  # lesson the earlier relocations' build functions record: a single-DLL copy
  # here would silently drop the Contract.dll from the deployed GameData folder
  # and break the mod at KSP load, with nothing in the build going red.
  cp "$out_dir/GonogoKosUplink.dll" "$install_dir/"
  if [ ! -f "$out_dir/GonogoKosUplink.Contract.dll" ]; then
    echo "GonogoKosUplink.Contract.dll not produced (missing at $out_dir/GonogoKosUplink.Contract.dll)"
    return 4
  fi
  cp "$out_dir/GonogoKosUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

build_gonogomechjebuplink() {
  local proj="$ROOT/mod/GonogoMechJebUplink/GonogoMechJebUplink.csproj"
  local out_dir="$ROOT/mod/GonogoMechJebUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoMechJebUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoMechJebUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoMechJebUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoMechJebUplink.dll" ]; then
    echo "GonogoMechJebUplink.dll not produced (missing at $out_dir/GonogoMechJebUplink.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoMechJebUplink.dll AND GonogoMechJebUplink.Contract.dll: the
  # uplink-types-out-of-core pilot split MechJebAscentArgs/MechJebNoArgs into
  # their own contract-slice project (Private="true", the default, so
  # `dotnet build` DOES copy it into $out_dir, unlike the two references
  # below). Sitrep.Contract.dll (provided by GonogoCore) and MechJeb2.dll
  # (provided by the user's MechJeb2 install) are reference-only
  # (Private="false") and must NOT be copied here - see
  # .superpowers/sdd/uplink-packaging-pattern.md. This is the first Uplink
  # with a second self-owned deployable DLL; the next relocated Uplink's
  # build_<name> function needs the same two-line copy.
  cp "$out_dir/GonogoMechJebUplink.dll" "$install_dir/"
  if [ ! -f "$out_dir/GonogoMechJebUplink.Contract.dll" ]; then
    echo "GonogoMechJebUplink.Contract.dll not produced (missing at $out_dir/GonogoMechJebUplink.Contract.dll)"
    return 4
  fi
  cp "$out_dir/GonogoMechJebUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

build_gonogoavionicsuplink() {
  local proj="$ROOT/mod/GonogoAvionicsUplink/GonogoAvionicsUplink.csproj"
  local out_dir="$ROOT/mod/GonogoAvionicsUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoAvionicsUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoAvionicsUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoAvionicsUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoAvionicsUplink.dll" ]; then
    echo "GonogoAvionicsUplink.dll not produced (missing at $out_dir/GonogoAvionicsUplink.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoAvionicsUplink.dll AND GonogoAvionicsUplink.Contract.dll: the
  # uplink-types-out-of-core plan split AvionicsStatus into its own
  # contract-slice project (Private="true", the default, so `dotnet build`
  # DOES copy it into $out_dir, unlike the reference below). Sitrep.Contract.dll
  # (provided by GonogoCore) is reference-only (Private="false") and must NOT
  # be copied here - see .superpowers/sdd/uplink-packaging-pattern.md. Applies
  # the deploy-script lesson the MechJeb pilot's build_gonogomechjebuplink
  # fixed: a single-DLL copy here would silently drop the Contract.dll from
  # the deployed GameData folder and break the mod at KSP load.
  cp "$out_dir/GonogoAvionicsUplink.dll" "$install_dir/"
  if [ ! -f "$out_dir/GonogoAvionicsUplink.Contract.dll" ]; then
    echo "GonogoAvionicsUplink.Contract.dll not produced (missing at $out_dir/GonogoAvionicsUplink.Contract.dll)"
    return 4
  fi
  cp "$out_dir/GonogoAvionicsUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

build_gonogokerbcastuplink() {
  local proj="$ROOT/mod/GonogoKerbcastUplink/GonogoKerbcastUplink.csproj"
  local out_dir="$ROOT/mod/GonogoKerbcastUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoKerbcastUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoKerbcastUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoKerbcastUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoKerbcastUplink.dll" ]; then
    echo "GonogoKerbcastUplink.dll not produced (missing at $out_dir/GonogoKerbcastUplink.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoKerbcastUplink.dll AND GonogoKerbcastUplink.Contract.dll: the
  # uplink-types-out-of-core plan split KerbcastCameraEntry/
  # KerbcastSetFieldOfViewArgs/KerbcastSetPanArgs into their own contract-slice
  # project (Private="true", the default, so `dotnet build` DOES copy it into
  # $out_dir, unlike the reference below). Sitrep.Contract.dll (provided by
  # GonogoCore) is reference-only (Private="false") and must NOT be copied
  # here - see .superpowers/sdd/uplink-packaging-pattern.md. Applies the
  # deploy-script lesson the MechJeb pilot's build_gonogomechjebuplink fixed
  # (and build_gonogoavionicsuplink applied from day one): a single-DLL copy
  # here would silently drop the Contract.dll from the deployed GameData
  # folder and break the mod at KSP load.
  cp "$out_dir/GonogoKerbcastUplink.dll" "$install_dir/"
  if [ ! -f "$out_dir/GonogoKerbcastUplink.Contract.dll" ]; then
    echo "GonogoKerbcastUplink.Contract.dll not produced (missing at $out_dir/GonogoKerbcastUplink.Contract.dll)"
    return 4
  fi
  cp "$out_dir/GonogoKerbcastUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

build_gonogokerbalismuplink() {
  local proj="$ROOT/mod/GonogoKerbalismUplink/GonogoKerbalismUplink.csproj"
  local out_dir="$ROOT/mod/GonogoKerbalismUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoKerbalismUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoKerbalismUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoKerbalismUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoKerbalismUplink.dll" ]; then
    echo "GonogoKerbalismUplink.dll not produced (missing at $out_dir/GonogoKerbalismUplink.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoKerbalismUplink.dll AND GonogoKerbalismUplink.Contract.dll: the
  # uplink-types-out-of-core plan split the fifteen kerbalism payload types into
  # their own contract-slice project (Private="true", the default, so
  # `dotnet build` DOES copy it into $out_dir, unlike the reference below).
  # Sitrep.Contract.dll (provided by GonogoCore) is reference-only
  # (Private="false") and must NOT be copied here, and Kerbalism.dll is never
  # referenced at all (this uplink reaches Kerbalism entirely by runtime
  # reflection) - see .superpowers/sdd/uplink-packaging-pattern.md. Applies the
  # deploy-script lesson the MechJeb pilot's build_gonogomechjebuplink fixed: a
  # single-DLL copy here would silently drop the Contract.dll from the deployed
  # GameData folder and break the mod at KSP load.
  cp "$out_dir/GonogoKerbalismUplink.dll" "$install_dir/"
  if [ ! -f "$out_dir/GonogoKerbalismUplink.Contract.dll" ]; then
    echo "GonogoKerbalismUplink.Contract.dll not produced (missing at $out_dir/GonogoKerbalismUplink.Contract.dll)"
    return 4
  fi
  cp "$out_dir/GonogoKerbalismUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

build_gonogoprincipiauplink() {
  local proj="$ROOT/mod/GonogoPrincipiaUplink/GonogoPrincipiaUplink.csproj"
  local out_dir="$ROOT/mod/GonogoPrincipiaUplink/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoPrincipiaUplink/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoPrincipiaUplink csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoPrincipiaUplink ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoPrincipiaUplink.dll" ]; then
    echo "GonogoPrincipiaUplink.dll not produced (missing at $out_dir/GonogoPrincipiaUplink.dll)"
    return 4
  fi
  if [ ! -f "$out_dir/GonogoPrincipiaUplink.Contract.dll" ]; then
    echo "GonogoPrincipiaUplink.Contract.dll not produced (missing at $out_dir/GonogoPrincipiaUplink.Contract.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  # GonogoPrincipiaUplink.dll AND GonogoPrincipiaUplink.Contract.dll, the same
  # two-DLL shape as the RealAntennas and Kerbalism uplinks. The Contract slice
  # holds this Uplink's own wire payloads and nothing else in the mod deploys
  # it, so it takes the default Private and lands in $out_dir. Sitrep.Contract
  # (provided by gonogo-core) stays reference-only and must NOT be copied here,
  # and no Principia assembly is ever referenced at all: every Principia member
  # is reached by reflection, so there is nothing of Principia's to exclude.
  cp "$out_dir/GonogoPrincipiaUplink.dll" "$install_dir/"
  cp "$out_dir/GonogoPrincipiaUplink.Contract.dll" "$install_dir/"
  {
    echo "version=$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo unknown)"
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "build_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$install_dir/build-info.txt"

  # Prove the bytes that landed are the ones we meant, rather than trusting that
  # `cp` copied a DLL holding this slice's code. Every symbol below is a specific
  # claim about the deployed file, each with the control that proves the reader
  # could have seen it: without one, a scan that reads nothing at all reports the
  # same clean run as a scan that read everything. See the script's own header
  # for why both encodings are counted.
  #
  #   PrincipiaGravityModelSource  the n-body gravity registration, whose absence
  #                                is why the live rig still reported Analytic
  #   PrincipiaLayoutProbe         the burn-editor struct-layout round-trip probe
  #   principia.plan.arm           a UTF-16LE-only string literal, so the second
  #                                encoding leg is exercised on every deploy and
  #                                cannot rot into a UTF-8-only scan
  #   Reinforced.Typings           an Uplink must never carry the codegen
  #                                dependency (uplink-packaging-pattern.md §3);
  #                                a leak of it once hid a dispatch bug for a
  #                                month
  #   kOS.Safe                     a type-level kOS.Safe dependency inside an
  #                                Uplink assembly drops the whole plugin at KSP
  #                                load, so assert it is not reachable from here
  # `|| rc=$?` rather than a bare call then `$?`: this script runs under
  # `set -e`, which would abort the function on the failing exit before the code
  # could be read, and a deploy that dies silently at its own verification step
  # is worse than one with no verification at all.
  echo "=== verifying deployed bytes ==="
  local uplink_rc=0
  local contract_rc=0
  python3 "$ROOT/scripts/verify_deployed_symbols.py" \
    "$install_dir/GonogoPrincipiaUplink.dll" \
    --control mscorlib \
    --require PrincipiaGravityModelSource \
    --require PrincipiaLayoutProbe \
    --require principia.plan.arm \
    --absent Reinforced.Typings \
    --absent kOS.Safe || uplink_rc=$?
  python3 "$ROOT/scripts/verify_deployed_symbols.py" \
    "$install_dir/GonogoPrincipiaUplink.Contract.dll" \
    --control mscorlib \
    --require PrincipiaPlan \
    --require PrincipiaPlannedBurn \
    --require PrincipiaFlightPlan \
    --absent Reinforced.Typings || contract_rc=$?
  if [ "$uplink_rc" -ne 0 ] || [ "$contract_rc" -ne 0 ]; then
    echo "deployed DLLs failed verification (uplink=$uplink_rc contract=$contract_rc)"
    return 5
  fi

  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

# The Deck-only dev tooling mini-mod. Never shipped in a CKAN/SpaceDock
# release, so it has no build-info stamp and no Contract dll: a single
# assembly referencing only KSP/Unity (see GonogoDevTools.csproj).
build_devtools() {
  local proj="$ROOT/mod/GonogoDevTools/GonogoDevTools.csproj"
  local out_dir="$ROOT/mod/GonogoDevTools/bin/Release"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/GonogoDevTools/Plugins"
  if [ ! -f "$proj" ]; then
    echo "GonogoDevTools csproj not found at $proj"
    return 3
  fi
  if [ ! -d "$ROOT/local_docs/syncthing/kspdata/GameData" ]; then
    echo "kspdata GameData not found under $ROOT/local_docs/syncthing/kspdata"
    return 3
  fi
  echo "=== building GonogoDevTools ==="
  perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
    dotnet build "$proj" -c Release --nologo -v minimal
  if [ ! -f "$out_dir/GonogoDevTools.dll" ]; then
    echo "GonogoDevTools.dll not produced (missing at $out_dir/GonogoDevTools.dll)"
    return 4
  fi
  mkdir -p "$install_dir"
  cp "$out_dir/GonogoDevTools.dll" "$install_dir/"
  echo "=== deployed to $install_dir ==="
  ls -la "$install_dir"
}

print_help() {
  grep -E '^#' "$0" | sed 's/^# \?//'
}

case "${1:-help}" in
  decompile)
    shift
    decompile "$@"
    ;;
  dump)
    shift
    dump "$@"
    ;;
  findtype)
    shift
    findtype "$@"
    ;;
  members)
    shift
    members "$@"
    ;;
  body)
    shift
    body "$@"
    ;;
  build)
    shift
    case "${1:-}" in
      ocisly)
        shift
        build_ocisly "$@"
        ;;
      kerbcast) build_kerbcast ;;
      gonogo) build_gonogo ;;
      gonogoscansatuplink) build_gonogoscansatuplink ;;
      gonogorealantennasuplink) build_gonogorealantennasuplink ;;
      gonogokosuplink) build_gonogokosuplink ;;
      gonogomechjebuplink) build_gonogomechjebuplink ;;
      gonogoavionicsuplink) build_gonogoavionicsuplink ;;
      gonogokerbcastuplink) build_gonogokerbcastuplink ;;
      gonogokerbalismuplink) build_gonogokerbalismuplink ;;
      gonogoprincipiauplink) build_gonogoprincipiauplink ;;
      devtools) build_devtools ;;
      *)
        echo "usage: gonogo_claude_tools.sh build <target>"
        echo "  targets: ocisly [--baseline], kerbcast, gonogo, gonogoscansatuplink, gonogorealantennasuplink, gonogokosuplink, gonogomechjebuplink, gonogoavionicsuplink, gonogokerbcastuplink, gonogokerbalismuplink, gonogoprincipiauplink, devtools"
        exit 2
        ;;
    esac
    ;;
  help|--help|-h)
    print_help
    ;;
  *)
    echo "unknown subcommand: $1"
    echo "run with no args for help"
    exit 2
    ;;
esac
