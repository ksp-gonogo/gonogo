#!/bin/sh
# Prints the test projects mod/Gonogo.sln declares, one csproj path per line
# relative to mod/, and fails unless they are exactly the projects ci.yml's `mod`
# job hand-lists in its `projects=( ... )` array.
#
# Both lists can omit a project without a sound: the array when someone forgets
# to edit it, the parse when its pattern stops matching (a dot before `Tests`
# dropped Sitrep.Host.IntegrationTests and left ten projects looking complete).
# Neither can check itself, so each checks the other. A solution that yields no
# test project is an error, since a run over nothing reports success.
#
# Used by scripts/mod-job-gate.sh and by the `mod` job itself, so the parse and
# the comparison exist once.
set -u

ROOT="$(git rev-parse --show-toplevel)"
SLN="$ROOT/mod/Gonogo.sln"
CI_YML="$ROOT/.github/workflows/ci.yml"

projects="$(sed -n 's/^Project(.*) = "[^"]*", "\([^"]*Tests\.csproj\)".*/\1/p' "$SLN" | tr -d '\r' | tr '\\' '/')"
if [ -z "$projects" ]; then
  echo "✖ mod/Gonogo.sln declares no test project. Either the solution moved or" >&2
  echo "  this parse stopped matching it; a run that finds nothing to test reports" >&2
  echo "  success, so this is an error rather than an empty pass." >&2
  exit 1
fi

ci_projects="$(sed -n '/^ *projects=(/,/^ *)/p' "$CI_YML" |
  sed -n 's/^ *\([A-Za-z0-9._]*Tests\) *$/\1/p' | sort)"
sln_projects="$(echo "$projects" | sed 's|.*/||; s|\.csproj$||' | sort)"
if [ "$ci_projects" != "$sln_projects" ]; then
  echo "✖ mod/Gonogo.sln and ci.yml's \`mod\` job disagree about which projects to test." >&2
  echo "  mod/Gonogo.sln: $(echo "$sln_projects" | tr '\n' ' ')" >&2
  echo "  ci.yml:         $(echo "$ci_projects" | tr '\n' ' ')" >&2
  echo "  A project named by one and not the other is gated by that one alone." >&2
  exit 1
fi

echo "$projects"
