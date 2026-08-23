#!/usr/bin/env python3
"""Answers questions about a Principia build by loading it, in its own process.

Separate from the game deliberately. Principia keeps process-global state (its
journal recorder, its logging flags, a reopened stderr), so a second instance
inside KSP would share them with the one the player is flying. A child process
shares nothing, and the container KSP runs in already hosts one such child, so
this is a shape the platform is known to support rather than a hope.

Python rather than a compiled binary because the pressure-vessel container has
python3 with ctypes and has neither mono nor dotnet. That was measured on the rig
rather than assumed.

Speaks one JSON object per line on stdin, answers one per line on stdout. A line
protocol rather than a socket because the parent already has the pipes, and
because a crash then closes the stream instead of leaving a caller waiting on a
port that will never answer.
"""

import ctypes
import json
import sys


def _fail(reason):
    return {"ok": False, "reason": reason}


def cpuid_feature_flags(library_path):
    """Whether THIS machine reports AVX and FMA, read through Principia's own export.

    This is the question the worker exists to answer first. Principia's loader
    selects its build on the FMA bit, so a caller deciding whether a worker can
    reproduce the game's arithmetic needs the bit as the GAME HOST sees it. Read
    anywhere else it answers a different question in the shape of the right one.

    Chosen as the handshake because it touches nothing: it takes two out
    parameters, reads CPUID, and returns. No plugin, no save, no global state.
    """
    try:
        library = ctypes.CDLL(library_path)
    except OSError as error:
        return _fail("The build could not be loaded: {}".format(error))

    try:
        entry = library.principia__GetCPUIDFeatureFlags
    except AttributeError:
        return _fail(
            "This build does not export principia__GetCPUIDFeatureFlags, so it is "
            "either not Principia or not a build this worker understands."
        )

    entry.restype = None
    entry.argtypes = [ctypes.POINTER(ctypes.c_bool), ctypes.POINTER(ctypes.c_bool)]
    has_avx = ctypes.c_bool(False)
    has_fma = ctypes.c_bool(False)
    entry(ctypes.byref(has_avx), ctypes.byref(has_fma))

    return {
        "ok": True,
        "hasAvx": bool(has_avx.value),
        "hasFma": bool(has_fma.value),
    }


HANDLERS = {"cpuidFeatureFlags": cpuid_feature_flags}


def handle(request):
    kind = request.get("kind")
    handler = HANDLERS.get(kind)
    if handler is None:
        return _fail("Unknown request kind: {!r}".format(kind))
    library_path = request.get("libraryPath")
    if not library_path:
        return _fail("No library path was given, so there is nothing to load.")
    return handler(library_path)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError as error:
            reply = _fail("The request was not JSON: {}".format(error))
        else:
            try:
                reply = handle(request)
            except Exception as error:  # noqa: BLE001 - a worker must not die on one bad ask
                # Reported rather than raised. A worker that exits on a bad request
                # takes every later request with it, and the parent sees a closed
                # pipe where it asked a question.
                reply = _fail("The request failed: {}".format(error))
        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
