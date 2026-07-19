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
 * Volumes probed for the `/`-picker's live listing — the Archive (where
 * scripts are normally authored/saved) and the CPU's own local hard drive
 * (where the picker's "copy local & run" toggle lands a copy, so an
 * already-copied script shows up too). Probed independently — a CPU with
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
  /** Human hint for the empty state — no CPU tag, no connection, or a dispatch error's message. `null` once a listing has loaded (even an empty one). */
  hint: string | null;
}

const IDLE: KosScriptListingResult = { paths: [], loading: false, hint: null };

/**
 * Live drive listing for the `/`-script picker (kos-terminal-script-picker,
 * hub-wizard-kos Phase 1 increment (b)) — dispatches the resurrected
 * `KOS_FILES_SCRIPT` ("list" op) via the surviving `KosDataSource.
 * executeScript` RPC for each of `LISTED_VOLUMES`, merges the FILE (not
 * directory) entries, and filters to `*.ks`/`*.ksm` — the only RUNPATH-able
 * kinds. This is the "raw executeScript" RPC-shaped one-shot case
 * (per-call args, request/response), NOT the centralised `kos.compute.*`
 * feed pattern — a directory listing is neither passive telemetry nor a
 * fixed no-args interval script, so it stays outside that registry by
 * design (see the repo CLAUDE.md's "when to use this vs raw executeScript"
 * section).
 *
 * Lazy + single-shot: does nothing until `enabled` is true (the terminal
 * only passes `true` once the `/`-picker is actually open AND no static
 * `scriptPaths` config already supplies a list), and fetches at most once
 * per `(coreId, cpuTag)` pair — reopening the picker within the same
 * session reuses the cached result rather than re-dispatching. Degrades
 * gracefully (empty `paths` + a `hint`, never a thrown error) on a
 * tagless CPU, no telemetry stream mounted, or a dispatch/timeout error —
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
  // for, so re-opening the picker doesn't re-dispatch — see the doc
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
        hint: "This CPU has no tagname yet — waiting on kos.processors.",
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
      let anyOk = false;
      let lastError: string | null = null;
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          lastError =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          continue;
        }
        anyOk = true;
        const { volume, data } = outcome.value;
        for (const entry of parseListing(data)) {
          if (entry.isDir) continue;
          if (!SCRIPT_FILE_RE.test(entry.name)) continue;
          paths.push(`${volume}/${entry.name}`);
        }
      }
      setResult({
        paths,
        loading: false,
        hint: anyOk
          ? null
          : (lastError ?? "Could not reach the CPU for a script listing."),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, coreId, cpuTag]);

  return result;
}

function parseListing(data: KosData): KosFileEntry[] {
  const raw = data.listing;
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as KosFileEntry[]) : [];
  } catch {
    return [];
  }
}
