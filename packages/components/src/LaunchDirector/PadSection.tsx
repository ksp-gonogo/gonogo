import { AugmentSlot } from "@ksp-gonogo/core";
import type { CommandButtonHandle } from "@ksp-gonogo/ui-kit";
import { ArmedButton } from "./ArmedButton";
import { CrewPicker } from "./CrewPicker";
import { type CrewMember, crewReading } from "./crew";
import { type LaunchSiteEntry, occupancyText, padKindLabel } from "./pads";
import { ShipPicker } from "./ShipPicker";
import { launchFacilityArg, type SavedShip } from "./ships";
import type { LaunchDirectorSlotContext } from "./slots";
import {
  CraftAndCrew,
  EmptyNote,
  LaunchControls,
  PadActions,
  PadAside,
  PadCard,
  PadColumn,
  PadDetail,
  PadDetails,
  PadList,
  PadMeta,
  PadName,
  PadOccupancy,
  PadRowButton,
  SectionLabel,
} from "./styles";

interface PadSectionProps {
  pads: readonly LaunchSiteEntry[];
  activePad: LaunchSiteEntry | undefined;
  onPickPad: (name: string) => void;
  padCraft: readonly SavedShip[];
  /** False while the saved-craft list has never arrived, which is not an empty pad. */
  craftKnown: boolean;
  crew: CrewMember[] | null;
  selectedShip: string | null;
  onSelectShip: (name: string | null) => void;
  selectedCrew: ReadonlySet<string>;
  onToggleCrew: (name: string) => void;
  fundsAvailable: number;
  funds: number | undefined;
  /** The tile's height in grid rows; decides whether the crew grid stands open. */
  rows: number;
  /** Wide and short, so the pad's craft and crew sit side by side. */
  letterbox: boolean;
  launchCmd: CommandButtonHandle;
  recoverCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  slotContext: LaunchDirectorSlotContext;
}

/**
 * The pads, and what the operator can do with the one they have opened. A pad
 * an Uplink knows more about says so through `launch-director.pad`; an open
 * pad's picker is the craft list narrowed to this site's editor.
 */
export function PadSection(props: PadSectionProps) {
  const { pads, activePad, onPickPad, funds, slotContext } = props;
  return (
    <>
      <SectionLabel>Pads</SectionLabel>
      {pads.length === 0 ? (
        <EmptyNote>No launch sites reported</EmptyNote>
      ) : (
        <PadList>
          {pads.map((site) => {
            const expanded = site.name === activePad?.name;
            return (
              <PadCard key={site.name}>
                <PadRowButton
                  type="button"
                  data-pad-row
                  $selected={expanded}
                  aria-pressed={expanded}
                  onClick={() => onPickPad(site.name)}
                >
                  <PadMeta>
                    <PadName>{site.displayName}</PadName>
                    <PadDetails>
                      {padKindLabel(site.facility)}
                      {site.body && site.body !== "Kerbin"
                        ? ` · ${site.body}`
                        : ""}
                    </PadDetails>
                  </PadMeta>
                  <PadOccupancy $occupied={site.occupied}>
                    {occupancyText(site)}
                  </PadOccupancy>
                </PadRowButton>
                <PadAside>
                  <AugmentSlot
                    name="launch-director.pad"
                    props={{
                      siteName: site.name,
                      displayName: site.displayName,
                      editorFacility: site.facility,
                      occupied: site.occupied,
                      occupantName: site.occupantName,
                      expanded,
                      funds,
                    }}
                  />
                </PadAside>
                {expanded && (
                  <PadDetail>
                    <OpenPad {...props} site={site} />
                  </PadDetail>
                )}
              </PadCard>
            );
          })}
        </PadList>
      )}
      {/* Pre-launch checklist augments. */}
      <AugmentSlot name="launch-director.preflight" props={slotContext} />
    </>
  );
}

/** What the opened pad offers: act on the vessel standing on it, or pick a craft and crew to launch. */
function OpenPad({
  site,
  padCraft,
  craftKnown,
  crew,
  selectedShip,
  onSelectShip,
  selectedCrew,
  onToggleCrew,
  fundsAvailable,
  rows,
  letterbox,
  launchCmd,
  recoverCmd,
  revertEditorCmd,
}: PadSectionProps & { site: LaunchSiteEntry }) {
  if (site.occupied === true) {
    return (
      /* Both commands act on the one vessel KSP has at PRELAUNCH. */
      <PadActions>
        <ArmedButton
          bindAs="recover"
          kind="recover"
          handle={recoverCmd}
          commandLabel="Recover"
          label="Recover"
          confirmLabel="Confirm recover"
          pendingLabel="Recovering..."
        />
        {/* Reverts to VAB: the widget cannot tell which editor the pad's craft came from. */}
        <ArmedButton
          bindAs="revertToEditor"
          kind="revert"
          handle={revertEditorCmd}
          args={{ editor: "vab" }}
          commandLabel="Revert to VAB"
          label="Revert to VAB"
          confirmLabel="Confirm revert"
          pendingLabel="Reverting..."
        />
      </PadActions>
    );
  }
  if (!craftKnown) {
    return <EmptyNote>Awaiting saved-craft telemetry</EmptyNote>;
  }
  if (padCraft.length === 0) {
    return (
      <EmptyNote>
        No saved craft for this {padKindLabel(site.facility).toLowerCase()}
      </EmptyNote>
    );
  }
  const ship = selectedShip
    ? padCraft.find((s) => s.name === selectedShip)
    : undefined;
  /**
   * The selection minus anyone the roster no longer calls available: the mod
   * skips a name it cannot seat without refusing, so "(3 crew)" could fly two.
   */
  const manifest = (crew ?? [])
    .filter((k) => crewReading(k) === "available" && selectedCrew.has(k.name))
    .map((k) => k.name);
  return (
    <CraftAndCrew $sideBySide={letterbox && ship != null}>
      <ShipPicker
        padCraft={padCraft}
        selectedShip={selectedShip}
        onSelectShip={onSelectShip}
        fundsAvailable={fundsAvailable}
      />
      {ship && (
        <PadColumn>
          <CrewPicker
            crew={crew}
            selectedCrew={selectedCrew}
            manifestSize={manifest.length}
            onToggleCrew={onToggleCrew}
            rows={rows}
          />
          <LaunchControls>
            <ArmedButton
              bindAs="launch"
              kind="launch"
              handle={launchCmd}
              args={{
                shipName: ship.name,
                facility: launchFacilityArg(ship),
                site: site.name,
                crew: manifest,
              }}
              commandLabel={`Launch ${ship.name}`}
              label={
                manifest.length > 0
                  ? `Launch ${ship.name} (${manifest.length} crew)`
                  : `Launch ${ship.name} unmanned`
              }
              confirmLabel="Confirm launch"
              pendingLabel="Launching..."
            />
          </LaunchControls>
        </PadColumn>
      )}
    </CraftAndCrew>
  );
}
