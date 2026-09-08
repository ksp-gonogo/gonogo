import { useEffect, useRef, useState } from "react";
import { kosSource } from "../dataSource/kos";
import type { KosData } from "../shared/kos-data-parser";
import { hashKosScript } from "./hashKosScript";
import {
  KOS_FILES_SCRIPT,
  KOS_FILES_SCRIPT_NAME,
  type KosFileEntry,
} from "./scriptListingScript";

const SCRIPT_VERSION = hashKosScript(KOS_FILES_SCRIPT);

/**
 * Volumes probed for the `/`-picker's live listing, the Archive (where
 * scripts are normally authored/saved) and the CPU's own local hard drive
 * (where the picker's "copy local & run" toggle lands a copy, so an
 * already-copied script shows up too). Probed independently, a CPU with
 * no local drive installed rejects `1:` but that must not sink the
 * Archive listing.
 */
const LISTED_VOLUMES = ["0:", "1:"];

/** Only these are RUNPATH-able; a directory or an unrelated file (`.txt`,
 * a `.ver` sidecar) would just error out of kOS if picked. */
const SCRIPT_FILE_RE = /\.(ks|ksm)$/i;

export interface KosScriptListingResult {
  paths: string[];
  loading: boolean;
  /**
   * Human hint for the empty state: no CPU tag, no connection, a dispatch
   * error's message, or a reply whose listing could not be read. `null` only
   * once at least one volume has returned a listing we could READ, even an
   * empty one.
   */
  hint: string | null;
}

const IDLE: KosScriptListingResult = { paths: [], loading: false, hint: null };

/**
 * Live drive listing for the `/`-script picker: dispatches the resurrected
 * `KOS_FILES_SCRIPT` ("list" op) via the surviving `KosDataSource.
 * executeScript` RPC for each of `LISTED_VOLUMES`, merges the FILE (not
 * directory) entries, and filters to `*.ks`/`*.ksm`: the only RUNPATH-able
 * kinds. This is the RPC-shaped one-shot case (per-call args,
 * request/response), which is the only kOS read pattern that still exists:
 * the centralised `kos.compute.*` feed and the `registerKosScript` registry
 * behind it were deleted with the widgets that consumed them. A directory
 * listing would not have belonged there anyway, being neither passive
 * telemetry nor a fixed no-args interval script.
 *
 * Lazy + single-shot: does nothing until `enabled` is true (the terminal
 * only passes `true` once the `/`-picker is actually open AND no static
 * `scriptPaths` config already supplies a list), and fetches at most once
 * per `(coreId, cpuTag)` pair, reopening the picker within the same
 * session reuses the cached result rather than re-dispatching. Degrades
 * gracefully (empty `paths` + a `hint`, never a thrown error) on a
 * tagless CPU, no telemetry stream mounted, or a dispatch/timeout error,
 * `executeScript` itself is the thing flagged unverified-in-source for
 * this environment (`KosExtension.Ksp.cs:335-340`), so every failure mode
 * here is a "show a hint" path, never a crash.
 */
export function useKosScriptListing(
  coreId: number,
  cpuTag: string | undefined,
  enabled: boolean,
): KosScriptListingResult {
  const [result, setResult] = useState<KosScriptListingResult>(IDLE);
  // Tracks the (coreId, cpuTag) pair a fetch has already been kicked off
  // for, so re-opening the picker doesn't re-dispatch; see the doc
  // comment above. Reset (by identity) whenever coreId/cpuTag actually
  // change, via the dependency array below rather than manual comparison.
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const fetchKey = `${coreId}:${cpuTag ?? ""}`;
    if (fetchedForRef.current === fetchKey) return;
    fetchedForRef.current = fetchKey;

    if (!cpuTag) {
      setResult({
        paths: [],
        loading: false,
        hint: "This CPU has no tagname yet: waiting on kos.processors.",
      });
      return;
    }

    let cancelled = false;
    setResult({ paths: [], loading: true, hint: null });

    Promise.allSettled(
      LISTED_VOLUMES.map((volume) =>
        kosSource
          .executeScript(cpuTag, KOS_FILES_SCRIPT_NAME, ["list", volume], {
            body: KOS_FILES_SCRIPT,
            version: SCRIPT_VERSION,
          })
          .then((data) => ({ volume, data })),
      ),
    ).then((settled) => {
      if (cancelled) return;
      const paths: string[] = [];
      // "A volume answered with a listing we could READ", which is not the
      // same as "the RPC resolved". A reply whose listing will not parse
      // resolved perfectly well and still tells us nothing about what is on
      // the drive, so counting it as an outcome left `hint` null and the
      // picker drew "No scripts found" over an unread reply.
      let anyReadable = false;
      let dispatchProblem: string | null = null;
      let unreadableProblem: string | null = null;
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          dispatchProblem =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          continue;
        }
        const { volume, data } = outcome.value;
        const entries = parseListing(data);
        if (entries === null) {
          unreadableProblem = `${volume} replied, but its file listing could not be read.`;
          continue;
        }
        anyReadable = true;
        for (const entry of entries) {
          if (entry.isDir) continue;
          if (!SCRIPT_FILE_RE.test(entry.name)) continue;
          paths.push(`${volume}/${entry.name}`);
        }
      }
      setResult({
        paths,
        loading: false,
        // An unreadable reply is the sharper signal and is preferred over a
        // volume that simply is not there: `1:` rejecting is the ordinary
        // case for a CPU with no local drive, and it lands last.
        hint: anyReadable
          ? null
          : (unreadableProblem ??
            dispatchProblem ??
            "Could not reach the CPU for a script listing."),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, coreId, cpuTag]);

  return result;
}

/**
 * The entries the reply reported, or NULL when the reply carried no listing
 * we could read: no `listing` field, a `listing` that will not parse, or one
 * that parses to something other than an array.
 *
 * Null and `[]` are different answers and the caller renders them
 * differently. `[]` means the drive has no files on it; null means the CPU
 * said something we could not interpret, which is not evidence about the
 * drive at all. Collapsing the two into `[]` is what let the picker claim a
 * volume was empty on the strength of a reply it had failed to parse.
 */
function parseListing(data: KosData): KosFileEntry[] | null {
  const raw = data.listing;
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as KosFileEntry[]) : null;
  } catch {
    return null;
  }
}
