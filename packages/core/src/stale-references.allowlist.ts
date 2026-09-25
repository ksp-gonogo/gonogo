/**
 * Comments naming a file the tree does not have, keyed `file -> reference`,
 * with how many times each appears.
 *
 * SHRINK-ONLY. Lower or delete an entry once its comment points at a file that
 * exists; never add or raise one, since a new entry means new code just wrote a
 * promise nothing keeps. See `styleguide-stale-references.test.ts`.
 */
export const STALE_REFERENCE_DEBT: Record<string, number> = {
  "mod/sitrep-sdk/src/media/delayed-playout-buffer.block-colour.test.ts -> DelayedPlayoutBuffer.test.ts": 2,
  "mod/sitrep-sdk/src/media/delayed-playout-buffer.test.ts -> CameraFeed.test.tsx": 1,
  "mod/sitrep-sdk/src/media/encoded-frame-delay.test.ts -> frameDelay.pacing.test.ts": 1,
  "mod/sitrep-sdk/src/media/encoded-frame-delay.test.ts -> frameDelay.test.ts": 2,
  "mod/sitrep-sdk/src/media/frame-delay.block-colour.test.ts -> DelayedPlayoutBuffer.blockColour.test.ts": 1,
  "mod/sitrep-sdk/src/media/frame-delay.pacing.test.ts -> frameDelay.test.ts": 1,
  "mod/sitrep-sdk/src/media/frame-delay.pacing.test.ts -> worker/presentationPacer.test.ts": 1,
  "mod/sitrep-sdk/src/media/worker/time-base.ts -> timeBase.test.ts": 1,
  "packages/app/src/__tests__/analytics-consent-peer.test.ts -> peer-host-service.test.ts": 1,
  "packages/app/src/__tests__/peer-broadcast-benchmark.test.ts -> peer-host-service.test.ts": 1,
  "packages/app/src/__tests__/scansat-coverage-roundtrip.test.tsx -> CoveragePanel/index.tsx:96": 1,
  "packages/app/src/telemetry/PeerTransport.test.ts -> WebSocketTransport.test.ts": 1,
  "packages/components/src/LandingStatus/descentLayers.test.ts -> DescentEnvelope.test.tsx": 1,
  "packages/components/src/MapView/stream.test.tsx -> maneuver-legacy.test.ts": 1,
  "packages/components/src/PowerSystems/dual-run.test.tsx -> Targeting/dual-run.test.tsx": 1,
  "packages/components/src/SystemView/projection.integration.test.tsx -> readFrame.integration.test.tsx": 1,
  "packages/core/src/uplink-boundary.allowlist.ts -> flag.test.ts": 3,
  "packages/core/src/uplink-boundary.allowlist.ts -> loaderState.test.ts": 1,
  "packages/core/src/uplink-boundary.allowlist.ts -> map-command.test.ts": 1,
  "packages/sitrep-client/src/timeline-store.test.ts -> map-topic.rawFieldResolution.fixture.test.ts": 1,
  "packages/sitrep-client/src/vessel-state-mapping.coverage.test.ts -> mapTopic.coverage.test.ts": 1,
};
