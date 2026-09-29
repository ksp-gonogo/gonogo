/**
 * Files carrying a forbidden punctuation dash, with how many each has.
 *
 * SHRINK-ONLY. Entries may be lowered or removed, never added or raised. A new
 * entry means new code just wrote the character, which is the thing the gate
 * exists to stop; use ordinary punctuation instead.
 *
 * Most of what is here is a NUMERIC RANGE rather than prose punctuation
 * (`0-100`, `30-60 s`, `49160-49170`). It is still the wrong character: an
 * ASCII hyphen reads identically in a monospace editor, survives every
 * encoding, and does not need this list.
 *
 * Regenerate after a cleanup with:
 *
 *   node scripts/punctuation-dash-debt.mjs --update
 *
 * See `styleguide-punctuation-dashes.test.ts` for what the gate does with these
 * numbers and `punctuation-dashes.scan.ts` for which characters are forbidden
 * and which two are deliberately not.
 */
export const PUNCTUATION_DASH_DEBT: Record<string, number> = {
  "CLAUDE.md": 1,
  "docs/DEPLOYMENT.md": 2,
  "docs/NETWORKING.md": 1,
  "mod/Gonogo.KSP/KspRoboticsActuator.cs": 1,
  "mod/Sitrep.Host.IntegrationTests/TestUplinks.cs": 1,
  "mod/Sitrep.Host/ChannelEngine.cs": 2,
  "mod/Sitrep.Host/RoboticsCommandProvider.cs": 4,
  "packages/app/src/peer/PeerClientService.ts": 1,
  "packages/app/src/peer/PeerHostService.ts": 5,
  "packages/app/src/peer/RetryPolicy.ts": 1,
  "packages/app/src/peer/stationPeerId.ts": 1,
  "packages/components/src/CurrentOrbit/__fixtures__/circular-lko-stopped-arriving.json": 1,
  "packages/components/src/CurrentOrbit/__fixtures__/circular-lko.json": 1,
  "packages/components/src/LandingStatus/carried-altitude.test.tsx": 1,
  "packages/components/src/Targeting/__fixtures__/approach-closing-stopped-arriving.json": 1,
  "packages/components/src/Targeting/__fixtures__/approach-closing.json": 1,
  "packages/components/src/Twr/index.tsx": 1,
  "packages/data/src/FlightsManager/ChaptersEditor.tsx": 1,
  "packages/logger/src/index.ts": 1,
  "packages/serial/src/SerialDevicesMenu/CalibrateWizard.tsx": 1,
  "packages/serial/src/SerialDevicesMenu/DeviceTypeEditor.tsx": 1,
  "packages/serial/src/SerialDevicesMenu/ProtocolReferenceModal.tsx": 3,
  "packages/serial/src/seeds.ts": 1,
  "packages/uplink-tools/src/render/docs.ts": 1,
  "packages/uplink-tools/src/render/wire.test.ts": 2,
  "packages/uplink-tools/src/render/wire.ts": 4,
  "scripts/decode-bug-report.mjs": 1,
};
