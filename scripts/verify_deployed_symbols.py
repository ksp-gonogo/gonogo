#!/usr/bin/env python3
"""Assert that a deployed assembly really contains the code it is supposed to.

A deploy script that copies a stale DLL, or copies nothing at all and reports
success anyway, is this repo's recurring defect. The copy itself is easy to get
right; what is hard is telling a deployed-and-correct artefact from a
deployed-and-empty one, because both produce a build that exits 0. This reads
the deployed bytes and counts the symbols we expect to find in them.

Why bytes and not `strings`: a managed assembly holds names in two encodings
and a scan that sees only one reads as "absent" for half of what is there.
Type, method and field names live UTF-8 in the metadata #Strings heap; string
LITERALS live UTF-16LE in #US. So a topic name like "principia.plan.arm" is
findable only in UTF-16LE, and macOS `strings -el` returns nothing for
everything, which makes a missing symbol and a broken probe indistinguishable.
Both encodings are counted here and both counts are printed.

Three kinds of assertion, because a check that cannot fail cannot pass either:

  --require   must be present. The actual question being asked.
  --control   must be present, and is known to be present in ANY assembly of
              this kind. It proves the reader works: if the control comes back
              zero, the file could not be read or is not the format we think,
              and every --require zero is uninformative rather than a failure.
              Reported as BLIND, distinct from a real absence.
  --absent    must NOT be present. Proves the probe can express a negative:
              a reader that answers "found" for everything would pass every
              --require and is caught here.

Exit codes: 0 all assertions held, 1 a --require or --absent failed,
2 the control failed (BLIND), 3 the file could not be read.
"""

import argparse
import sys
from pathlib import Path


def count(haystack: bytes, needle: str) -> tuple[int, int]:
    """Occurrences of needle as UTF-8 and as UTF-16LE."""
    return (
        haystack.count(needle.encode("utf-8")),
        haystack.count(needle.encode("utf-16-le")),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dll", type=Path)
    ap.add_argument("--require", action="append", default=[], metavar="SYMBOL")
    ap.add_argument("--control", action="append", default=[], metavar="SYMBOL")
    ap.add_argument("--absent", action="append", default=[], metavar="SYMBOL")
    args = ap.parse_args()

    try:
        data = args.dll.read_bytes()
    except OSError as exc:
        print(f"UNREADABLE {args.dll}: {exc}")
        return 3

    print(f"scanning {args.dll} ({len(data)} bytes)")
    verdict = 0

    for symbol in args.control:
        utf8, utf16 = count(data, symbol)
        total = utf8 + utf16
        print(f"  control {symbol!r}: utf-8={utf8} utf-16le={utf16}")
        if total == 0:
            print(f"BLIND: control {symbol!r} not found, the scan proves nothing")
            verdict = 2

    if verdict == 2:
        return 2

    for symbol in args.require:
        utf8, utf16 = count(data, symbol)
        total = utf8 + utf16
        status = "ok" if total else "MISSING"
        print(f"  require {symbol!r}: utf-8={utf8} utf-16le={utf16} {status}")
        if total == 0:
            verdict = 1

    for symbol in args.absent:
        utf8, utf16 = count(data, symbol)
        total = utf8 + utf16
        status = "PRESENT" if total else "ok"
        print(f"  absent  {symbol!r}: utf-8={utf8} utf-16le={utf16} {status}")
        if total:
            verdict = 1

    print("verdict: pass" if verdict == 0 else f"verdict: FAIL ({verdict})")
    return verdict


if __name__ == "__main__":
    sys.exit(main())
