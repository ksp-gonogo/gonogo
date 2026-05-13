#!/usr/bin/env bash
# gonogo_claude_tools.sh — purpose-scoped helpers Claude Code can invoke
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
#       (method bodies, field initialisers, the lot) — no signature
#       filter. Same Tier 1/2/3 fallback as decompile. Use when you need
#       to see what a method actually does, not just its signature.
#
#   members <Type> [<Type>...]
#       Lists every public member (field / property / method) inside
#       a type by line-range scan of the cached full disassembly.
#       Unlike `decompile`, has no per-type cap — useful for large
#       classes like KSP's `Part` (5000+ lines) where the 80-line
#       decompile filter truncates before reaching the interesting
#       fields. Output is one member per line, in source order. Falls
#       back to findtype for namespaced lookups; you can pass either
#       `Part` or `Strategies.Strategy`.
#
#   body <Type> <Method>
#       Print one method's body from the cached disassembly. Pairs
#       with `members` — use `members` to spot a method by signature,
#       then `body` to see what it actually does. Returns the first
#       overload that matches by name; if you have overloads, use
#       `dump` instead. Detects the matching close-brace by indent
#       level (ilspycmd output is consistently formatted).
#
#   build telemachus
#       Build the Telemachus fork at local_docs/telemachus-fork/Telemachus/
#       and copy the resulting Telemachus.dll into the synced
#       kspdata GameData/Telemachus/Plugins/ directory.
#
#   tele read <key1> [<key2>...]
#       GET /telemachus/datalink with each key as a `?k=k` pair against
#       the running KSP install. Pretty-prints JSON when possible. The
#       host is hard-coded — script can't pivot to a different target.
#
#   tele action <key[args]>
#       GET /telemachus/datalink with a single bracketed action key —
#       URL-encodes the brackets so curl doesn't choke. Used for write
#       paths like alarm.add[Test,5475,KillWarp,Yes] or tech.unlock[start].
#
#   tele subscribe <key1> [<key2>...]
#       Open a WebSocket to /datalink and subscribe to the given keys.
#       Streams each frame with a timestamp prefix so you can see value
#       transitions in real time. Default rate 1000ms. Requires websocat
#       (brew install websocat). Ctrl-C to stop.
#
#   help
#       Print this comment block.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DLL="$ROOT/local_docs/syncthing/kspdata/KSP_Data/Managed/Assembly-CSharp.dll"
ILSPYCMD="$HOME/.dotnet/tools/ilspycmd"
DECOMPILE_TIMEOUT_S=60
BUILD_TIMEOUT_S=300
TELE_HOST="http://192.168.86.33:8085"
TELE_TIMEOUT_S=15

# Internal: resolve a type name to its full ilspycmd dump using a
# three-tier strategy. Sets these globals on success:
#   _RT_RAW          — the full ilspycmd textual output for the type
#   _RT_SOURCE_DLL   — absolute path of the DLL that owned the type
#   _RT_RESOLVED_FQN — empty if the bare name worked; the FQN if Tier 3
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

  # Tier 1: Assembly-CSharp.dll — almost every gameplay type lives here.
  # `|| true` keeps `set -e` from killing the script when ilspycmd exits
  # non-zero on a type-not-found miss.
  _RT_RAW="$(perl -e 'alarm shift; exec @ARGV' "$DECOMPILE_TIMEOUT_S" \
    "$ILSPYCMD" "$DLL" -t "$t" 2>/dev/null || true)"
  if [ -n "$_RT_RAW" ]; then
    _RT_SOURCE_DLL="$DLL"
    return 0
  fi

  # Tier 2: walk the other Managed/ DLLs until one yields a non-empty
  # result. Bare name only — namespaced types fall through to Tier 3.
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

  # Tier 3: bare-name lookups all missed. Type might be namespaced —
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
#   _RANGE_FILE  — cache file the type lives in
#   _RANGE_LO    — first line number (the class/interface/struct/enum line)
#   _RANGE_HI    — last line number, exclusive (next top-level type, or file end)
#   _RANGE_DLL   — basename of the originating DLL
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
    # indent level — that's the exclusive upper bound. Picking
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
    echo "  at 80 lines — `members` has no per-type cap."
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
    # listing — use a separate `members` call to inspect them).
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

build_telemachus() {
  local fork="$ROOT/local_docs/telemachus-fork/Telemachus"
  local install_dir="$ROOT/local_docs/syncthing/kspdata/GameData/Telemachus/Plugins"
  if [ ! -d "$fork" ]; then
    echo "Telemachus fork not found at $fork"
    return 3
  fi
  if [ ! -d "$install_dir" ]; then
    echo "kspdata GameData/Telemachus/Plugins not found at $install_dir"
    return 3
  fi
  echo "=== building Telemachus fork ==="
  (
    cd "$fork"
    perl -e 'alarm shift; exec @ARGV' "$BUILD_TIMEOUT_S" \
      dotnet build -c Release --nologo -v minimal
  )
  # Output may be under bin/Release/<tfm>/ depending on csproj —
  # search for a Telemachus.dll modified in the last 5 minutes under
  # any Release/ path inside the fork.
  local out_dll
  out_dll="$(find "$fork/bin" -type f -name Telemachus.dll -path '*/Release/*' -mmin -5 2>/dev/null | head -1)"
  if [ -z "$out_dll" ] || [ ! -f "$out_dll" ]; then
    echo "Telemachus.dll not produced (no fresh match under $fork/bin/)"
    return 4
  fi
  cp "$out_dll" "$install_dir/Telemachus.dll"
  echo "=== installed ==="
  ls -la "$install_dir/Telemachus.dll"
}

tele_read() {
  if [ "$#" -lt 1 ]; then
    echo "usage: gonogo_claude_tools.sh tele read <key1> [<key2>...]"
    return 2
  fi
  local q=""
  for k in "$@"; do
    q="${q:+$q&}${k}=${k}"
  done
  local url="${TELE_HOST}/telemachus/datalink?${q}"
  # Tempfile pattern: keeps curl/jq non-zero exits from tripping set -e
  # before the no-response branch can print.
  local tmp
  tmp="$(mktemp)"
  perl -e 'alarm shift; exec @ARGV' "$TELE_TIMEOUT_S" \
    curl -s "$url" > "$tmp" 2>/dev/null || true
  local body
  body="$(cat "$tmp")"
  rm -f "$tmp"
  if [ -z "$body" ]; then
    echo "(no response — KSP / Telemachus not running?)"
    return 4
  fi
  # Pretty-print if jq or python json is available; else raw.
  if command -v jq >/dev/null 2>&1; then
    echo "$body" | jq .
  elif command -v python3 >/dev/null 2>&1; then
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
  else
    echo "$body"
  fi
}

tele_action() {
  if [ "$#" -lt 1 ]; then
    echo "usage: gonogo_claude_tools.sh tele action <key[args]>"
    return 2
  fi
  local raw="$1"
  # URL-encode square brackets and spaces — Telemachus parses commas
  # inside the brackets itself, so commas stay raw. Spaces appear in
  # arg values like "Auto-Saved Ship" and curl rejects raw-space URLs.
  local enc="${raw//\[/%5B}"
  enc="${enc//\]/%5D}"
  enc="${enc// /%20}"
  local url="${TELE_HOST}/telemachus/datalink?${enc}=${enc}"
  # Use a temp file so curl/jq exit codes don't propagate to set -e
  # before the no-response branch can print. Curl sees no response on
  # connection failure → empty file → handled below.
  local tmp
  tmp="$(mktemp)"
  perl -e 'alarm shift; exec @ARGV' "$TELE_TIMEOUT_S" \
    curl -s "$url" > "$tmp" 2>/dev/null || true
  local body
  body="$(cat "$tmp")"
  rm -f "$tmp"
  if [ -z "$body" ]; then
    echo "(no response — KSP / Telemachus not running?)"
    return 4
  fi
  if command -v jq >/dev/null 2>&1; then
    echo "$body" | jq .
  elif command -v python3 >/dev/null 2>&1; then
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
  else
    echo "$body"
  fi
}

tele_subscribe() {
  if [ "$#" -lt 1 ]; then
    echo "usage: gonogo_claude_tools.sh tele subscribe <key1> [<key2>...]"
    return 2
  fi
  if ! command -v websocat >/dev/null 2>&1; then
    echo "websocat not installed — brew install websocat"
    return 5
  fi
  local rate_ms=1000
  # Build the JSON array of keys: ["k1","k2",...]
  local keys_json="["
  local first=1
  for k in "$@"; do
    if [ $first -eq 0 ]; then keys_json="${keys_json},"; fi
    keys_json="${keys_json}\"${k}\""
    first=0
  done
  keys_json="${keys_json}]"
  # `+` adds to persistent subscriptions (streams every tick at the
  # configured rate). `run` is a one-shot — fires once and gets cleared,
  # which is NOT what `tele subscribe` wants. The difference matters:
  # with `run` the initial frame populates and every subsequent tick
  # is an empty diff because nothing is actually subscribed.
  local payload="{\"+\":${keys_json},\"rate\":${rate_ms}}"
  # http://host:port → ws://host:port  (and https → wss in the future)
  local ws_url="${TELE_HOST/http:/ws:}/datalink"
  echo "ws_url:  $ws_url"
  echo "payload: $payload"
  echo "---"
  # Prepend the subscribe payload to stdin, then keep stdin open. websocat's
  # -n flag prevents it from closing on stdin EOF — we just want a one-way
  # subscribe and a continuous stream back. Each frame is one line; the
  # python tail timestamps + compact-prints each frame, which gives us
  # cross-platform millisecond timestamps (BSD `date` lacks `%N`) and one
  # frame per line for grep/tail/awk-friendly downstream piping.
  printf '%s\n' "$payload" \
    | websocat -n -t "$ws_url" \
    | python3 -u -c '
import json, sys, time
for line in sys.stdin:
    line = line.rstrip()
    if not line:
        continue
    try:
        compact = json.dumps(json.loads(line), separators=(",", ":"))
    except Exception:
        compact = line
    t = time.time()
    ts = time.strftime("%H:%M:%S", time.localtime(t)) + f".{int(t*1000)%1000:03d}"
    print(f"{ts} {compact}", flush=True)
'
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
      telemachus) build_telemachus ;;
      *)
        echo "usage: gonogo_claude_tools.sh build <target>"
        echo "  targets: telemachus"
        exit 2
        ;;
    esac
    ;;
  tele)
    shift
    case "${1:-}" in
      read)
        shift
        tele_read "$@"
        ;;
      action)
        shift
        tele_action "$@"
        ;;
      subscribe)
        shift
        tele_subscribe "$@"
        ;;
      *)
        echo "usage: gonogo_claude_tools.sh tele {read|action|subscribe} ..."
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
