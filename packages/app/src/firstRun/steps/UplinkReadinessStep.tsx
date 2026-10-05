import { CommandBlock } from "@ksp-gonogo/ui";
import { Badge, Stack, StatusIndicator, Text } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { ConnectionRow, Name } from "../../settings/SitrepConnection";
import { StatusList, UplinkHealthReport } from "../../settings/UplinkStatus";
import { UplinkIdentityBlock } from "../../uplinks/UplinkIdentityBlock";
import { UplinkIntegrityDetail } from "../../uplinks/UplinkIntegrityDetail";
import { uplinksCheck } from "../checks";
import { runs, say } from "../copy";
import { CKAN_UPLINK_FILTER } from "../setupGuide";
import {
  type UplinkReadinessEntry,
  useUplinkReadiness,
} from "../useUplinkReadiness";
import { Hint, Prose, StepCheck } from "./StepParts";

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
  const summary = say("uplinks.summary", {
    loaded: loaded.length,
    installed: installed.length,
  });
  return refused.length === 0
    ? summary
    : say("uplinks.summaryRefused", { summary, refused: refused.length });
}

/**
 * The step that answers "are the Uplinks I installed actually working". One row
 * per Uplink, each carrying the health the Uplink reports for itself and
 * whether its client loaded here. The camera Uplink is a row like any other,
 * so there is no camera check anywhere else in the flow.
 *
 * Nothing on a row is an instruction: an Uplink's client ships with the Uplink
 * and is fetched from the mod's own declaration, not from anywhere this screen
 * could reach.
 */
export function UplinkReadinessStep() {
  const readiness = useUplinkReadiness();
  const { entries, waitingForMod } = readiness;
  const check = uplinksCheck(readiness);
  const installed = entries.filter((entry) => entry.installed);

  /*
   * The count is a claim about what the mod reports installed, so it waits for
   * the mod. Rows do not: a client loaded in an earlier session is already a
   * reading, and holding it back behind a connection would hide it.
   */
  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("uplinks.intro")}
      </Text>
      <CommandBlock
        command={CKAN_UPLINK_FILTER}
        label={say("uplinks.searchLabel")}
      />
      <Text level="muted" size="sm">
        <Prose runs={runs("uplinks.install")} />
      </Text>
      <StepCheck check={check} />
      {!waitingForMod && installed.length > 0 && (
        <Text level="muted" size="sm">
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
      {waitingForMod && (
        <Hint>
          <span>{say("uplinks.hint.waiting")}</span>
        </Hint>
      )}
      {check.state === "attention" && (
        <Hint>
          <span>{say("uplinks.hint.attention")}</span>
        </Hint>
      )}
    </Stack>
  );
}

/**
 * The loader's own refusal text under a quarantined row. An Uplink the mod
 * calls unavailable needs nothing here: its health report already carries the
 * mod's reason, verbatim.
 */
function reasonFor(entry: UplinkReadinessEntry): string | null {
  return entry.state === "quarantined" ? (entry.outcome?.reason ?? null) : null;
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
    <Text level="muted" size="sm">
      {say("uplinks.row.contractMismatch", {
        declared: `${declaredContract.major}.${declaredContract.minor}`,
        core: `${coreContract.major}.${coreContract.minor}`,
      })}
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
        {!entry.rosterEntry && entry.version && (
          <Text level="faint" size="xs">
            {say("uplinks.row.version", { version: entry.version })}
          </Text>
        )}
        <ReadinessReading state={entry.state} />
      </ConnectionRow>
      {/* The Uplink's own report of its health: state, what it says about it, and the facts it lists. */}
      {entry.rosterEntry && (
        <StatusList>
          <UplinkHealthReport entry={entry.rosterEntry} />
        </StatusList>
      )}
      {identity && <UplinkIdentityBlock identity={identity} />}
      {entry.state === "contract-mismatch" && (
        <ContractMismatchDetail entry={entry} />
      )}
      {reason && (
        <Text level="muted" size="sm">
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
      return <Badge tone="go">{say("uplinks.row.loaded")}</Badge>;
    case "loading":
      return (
        <StatusIndicator tone="neutral" pulse="fast">
          {say("uplinks.row.loading")}
        </StatusIndicator>
      );
    case "quarantined":
      return (
        <StatusIndicator tone="nogo">
          {say("uplinks.row.quarantined")}
        </StatusIndicator>
      );
    case "contract-mismatch":
      return (
        <StatusIndicator tone="nogo">
          {say("uplinks.row.refused")}
        </StatusIndicator>
      );
    case "unavailable":
      return (
        <StatusIndicator tone="nogo">
          {say("uplinks.row.unavailable")}
        </StatusIndicator>
      );
    case "no-client":
      return (
        <StatusIndicator tone="warn">
          {say("uplinks.row.noClient")}
        </StatusIndicator>
      );
  }
}

const RowList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const RowItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;
