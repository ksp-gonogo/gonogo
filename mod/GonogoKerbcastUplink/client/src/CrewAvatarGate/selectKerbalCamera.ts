import { CameraKind, type CameraState } from "@ksp-gonogo/kerbcast";

/**
 * Find the live kerbal face camera for a crew member, by NAME.
 *
 * kerbcast's name-rekey fix (2026-07-23, `local_docs/inbox/...diagnosed-
 * rekey-on-name-no-krpc-needed.md`) makes `cameraName` the kerbal's stable
 * identity for a `kind: Kerbal` camera: `kerbalPersistentId` looked stable
 * but actually changes seat<->EVA (KSP mints a fresh `persistentID` on EVA),
 * so it is the WRONG key. `cameraName` (the kerbal's full name, e.g.
 * "Jebediah Kerman") stays constant across seat/EVA transitions and is
 * unique in the roster: and it is also the only identity CrewManifest's
 * `vessel.crew` roster carries (no kerbal id crosses the Sitrep contract),
 * so it is the sole correlation key available on either side.
 *
 * Returns `null` when no kerbal camera exists for this name (mod not
 * installed, kerbal not seated/on EVA, or facecams not yet connected), the
 * caller falls back to CrewManifest's bullet in that case.
 */
export function selectKerbalCamera(
  cameras: readonly CameraState[],
  crewName: string,
): CameraState | null {
  return (
    cameras.find(
      (c) => c.kind === CameraKind.Kerbal && c.cameraName === crewName,
    ) ?? null
  );
}
