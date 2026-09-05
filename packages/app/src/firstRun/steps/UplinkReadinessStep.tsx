import {
  Badge,
  EmptyState,
  Stack,
  StatusIndicator,
  Text,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { ConnectionRow, Name } from "../../settings/SitrepConnection";
import { UplinkIdentityBlock } from "../../uplinks/UplinkIdentityBlock";
import { UplinkIntegrityDetail } from "../../uplinks/UplinkIntegrityDetail";
import {
  type UplinkReadinessEntry,
  useUplinkReadiness,
} from "../useUplinkReadiness";

/**
 * The count line, the one thing here worth announcing when it changes. A
 * contract refusal gets its own clause rather than only a row, because it used
 * to be the state with no surface at all: nine Uplinks refused for a stale
 * contract were absent from the roster entirely, and an operator read that as
 * nine capabilities that simply did not exist.
 */
function summarise(entries: readonly UplinkReadinessEntry[]): string {
  const installed = entries.filter((entry) => entry.installed);
  const loaded = installed.filter((entry) => entry.state === "loaded");
  const refused = installed.filter(
    (entry) => entry.state === "contract-mismatch",
  );
  const noun = installed.length === 1 ? "Uplink has" : "Uplinks have";
  const line = `${loaded.length} of ${installed.length} installed ${noun} a loaded client`;
  return refused.length === 0
    ? line
    : `${line}; ${refused.length} refused for a contract mismatch`;
}

/**
 * The step that answers "are the Uplinks I installed actually working". One row
 * per Uplink, each carrying a reading rather than an instruction: there is
 * nothing for the app to offer an operator whose client did not load, because
 * an Uplink's client ships with the Uplink and is fetched from the mod's own
 * declaration, not from anywhere this screen could reach.
 */
export function UplinkReadinessStep() {
  const { entries, waitingForMod } = useUplinkReadiness();

  /*
   * The count is a claim about what the mod reports installed, so it waits for
   * the mod. Rows do not: a client loaded in an earlier session is already a
   * reading, and holding it back behind a connection would hide it.
   */
  return (
    <Stack gap="sm">
      {waitingForMod ? (
        <StatusIndicator tone="neutral" pulse="fast" live>
          Waiting for the mod to report its Uplinks
        </StatusIndicator>
      ) : (
        <Text tone="muted" size="sm" role="status" aria-live="polite">
          {summarise(entries)}
        </Text>
      )}
      {entries.length > 0 && (
        <RowList>
          {entries.map((entry) => (
            <UplinkReadinessRow key={entry.id} entry={entry} />
          ))}
        </RowList>
      )}
      {!waitingForMod && entries.length === 0 && (
        <EmptyState>No Uplinks reported by the mod</EmptyState>
      )}
    </Stack>
  );
}

/**
 * The reason under a row, where there is one. A quarantine carries the loader's
 * own refusal text; an Uplink the mod calls unavailable carries the mod's,
 * verbatim. Every other state has nothing to add and adds nothing.
 */
function reasonFor(entry: UplinkReadinessEntry): string | null {
  if (entry.state === "quarantined") return entry.outcome?.reason ?? null;
  if (entry.state === "unavailable") return entry.modReason;
  return null;
}

/**
 * The refusal, said in full: which contract this Uplink was built for and which
 * one the mod running now speaks. Two version numbers rather than a verdict,
 * because the operator's next move follows from the gap: a build of the Uplink
 * against the core they have. Nothing here is an instruction, the app has no
 * way to fetch that build.
 */
function ContractMismatchDetail({
  entry,
}: Readonly<{ entry: UplinkReadinessEntry }>) {
  const { declaredContract, coreContract } = entry;
  if (!declaredContract || !coreContract) return null;

  return (
    <Text tone="muted" size="sm">
      Built for contract {declaredContract.major}.{declaredContract.minor}; this
      mod speaks {coreContract.major}.{coreContract.minor}. The mod refused it,
      so none of its channels or commands are running.
    </Text>
  );
}

function UplinkReadinessRow({
  entry,
}: Readonly<{ entry: UplinkReadinessEntry }>) {
  /*
   * Only an Uplink the loader got far enough to describe has an identity to
   * show. The roster arrives over `system.uplinkHealth`, which carries no name,
   * author or repo, so a row for an installed Uplink whose client never loaded
   * has nothing declared beyond the id and version already in its heading.
   */
  const identity = entry.outcome?.identity;
  const reason = reasonFor(entry);

  return (
    <RowItem>
      <ConnectionRow>
        <Name>{entry.name}</Name>
        {entry.version && (
          <Text tone="faint" size="xs">
            v{entry.version}
          </Text>
        )}
        <ReadinessReading state={entry.state} />
      </ConnectionRow>
      {identity && <UplinkIdentityBlock identity={identity} />}
      {entry.state === "contract-mismatch" && (
        <ContractMismatchDetail entry={entry} />
      )}
      {reason && (
        <Text tone="muted" size="sm">
          {reason}
        </Text>
      )}
      {entry.outcome?.integrity && (
        <UplinkIntegrityDetail failure={entry.outcome.integrity} />
      )}
    </RowItem>
  );
}

function ReadinessReading({
  state,
}: Readonly<{ state: UplinkReadinessEntry["state"] }>) {
  switch (state) {
    case "loaded":
      return <Badge severity="nominal">Client loaded</Badge>;
    case "loading":
      return (
        <StatusIndicator tone="neutral" pulse="fast">
          Client loading
        </StatusIndicator>
      );
    case "quarantined":
      return <StatusIndicator tone="nogo">Client quarantined</StatusIndicator>;
    case "contract-mismatch":
      return (
        <StatusIndicator tone="nogo">
          Refused: contract mismatch
        </StatusIndicator>
      );
    case "unavailable":
      return (
        <StatusIndicator tone="nogo">Mod reports unavailable</StatusIndicator>
      );
    case "no-client":
      return <StatusIndicator tone="warn">No client loaded</StatusIndicator>;
  }
}

const RowList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
`;

const RowItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;
