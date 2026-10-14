import { AugmentSlot } from "@ksp-gonogo/core";
import type { UseCommandResult } from "@ksp-gonogo/sitrep-client";
import type { CatalogEntry } from "@ksp-gonogo/sitrep-sdk";
import {
  type CommandButtonHandle,
  SelectableRow,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useEffect } from "react";
import { ArmedButton } from "./ArmedButton";
import { CrewPicker } from "./CrewPicker";
import { type CrewMember, crewReading } from "./crew";
import { FlyVesselMenu } from "./FlyVesselMenu";
import {
  type LaunchSiteEntry,
  occupancyText,
  padBodyName,
  padKindLabel,
} from "./pads";
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
  SectionLabel,
} from "./styles";

interface PadSectionProps {
  pads: readonly LaunchSiteEntry[];
  activePad: LaunchSiteEntry | undefined;
  onPickPad: (name: string) => void;
  /** Names of the bodies away from the home world, by `trackingStation.bodies` index. */
  awayBodies: ReadonlyMap<number, string>;
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
  /** Too narrow for a pad's name and its occupancy on one line, so the occupancy sits beneath. */
  narrow: boolean;
  launchCmd: CommandButtonHandle & Pick<UseCommandResult, "check">;
  recoverCmd: CommandButtonHandle;
  revertEditorCmd: CommandButtonHandle;
  switchCmd: CommandButtonHandle;
  /** The fleet the operator can fly from here, none when the roster has not arrived. */
  flyable: readonly CatalogEntry[];
  slotContext: LaunchDirectorSlotContext;
}

/**
 * The pads, and what the operator can do with the one they have opened. A pad
 * an Uplink knows more about says so through `launch-director.pad`; an open
 * pad's picker is the craft list narrowed to this site's editor.
 */
export function PadSection(props: PadSectionProps) {
  const {
    pads,
    activePad,
    onPickPad,
    awayBodies,
    funds,
    slotContext,
    flyable,
    switchCmd,
    narrow,
  } = props;
  return (
    <>
      {flyable.length > 0 && (
        <FlyVesselMenu vessels={flyable} switchCmd={switchCmd} />
      )}
      <SectionLabel>Pads</SectionLabel>
      {pads.length === 0 ? (
        <EmptyNote>No launch sites reported</EmptyNote>
      ) : (
        <PadList>
          {pads.map((site) => {
            const expanded = site.name === activePad?.name;
            const bodyName = padBodyName(site, awayBodies);
            return (
              <PadCard key={site.name}>
                <SelectableRow
                  layout={narrow ? "stack" : "split"}
                  gap="related"
                  selectedLook="outline"
                  data-pad-row
                  selected={expanded}
                  onClick={() => onPickPad(site.name)}
                >
                  <PadMeta>
                    <PadName>{site.displayName}</PadName>
                    <PadDetails>
                      {padKindLabel(site.facility)}
                      {bodyName ? ` · ${bodyName}` : ""}
                      {site.isStock === false ? " · Modded" : ""}
                    </PadDetails>
                    {site.latitude && site.longitude && (
                      <PadDetails>
                        <Unit value={site.latitude} decimals={2} />{" "}
                        <Unit value={site.longitude} decimals={2} />
                      </PadDetails>
                    )}
                  </PadMeta>
                  <PadOccupancy $occupied={site.occupied} $stacked={narrow}>
                    {occupancyText(site)}
                  </PadOccupancy>
                </SelectableRow>
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
    // The craft on a runway came from the SPH; anything else is taken to be a pad's VAB craft.
    const editor = site.facility === "SPH" ? "SPH" : "VAB";
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
        <ArmedButton
          bindAs="revert-to-editor"
          kind="revert"
          handle={revertEditorCmd}
          args={{ editor: editor.toLowerCase() }}
          commandLabel={`Revert to ${editor}`}
          label={`Revert to ${editor}`}
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
    ? padCraft.find((s) => s.file === selectedShip)
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
            <LaunchAction
              handle={launchCmd}
              args={{
                shipName: ship.file,
                facility: launchFacilityArg(ship),
                site: site.name,
                crew: manifest,
              }}
              shipName={ship.name}
              crewCount={manifest.length}
            />
          </LaunchControls>
        </PadColumn>
      )}
    </CraftAndCrew>
  );
}

/**
 * The launch control. It asks the mod whether this launch would be refused
 * whenever the craft, the pad or the crew changes, so a centre that may not
 * launch from this pad sees the control dark with the mod's reason before it
 * presses anything.
 */
function LaunchAction({
  handle,
  args,
  shipName,
  crewCount,
}: {
  handle: PadSectionProps["launchCmd"];
  args: { shipName: string; facility: string; site: string; crew: string[] };
  shipName: string;
  crewCount: number;
}) {
  const { check } = handle;
  const choice = JSON.stringify(args);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the choice, serialised, is the trigger
  useEffect(() => {
    void check?.(args);
  }, [check, choice]);
  return (
    <ArmedButton
      bindAs="launch"
      kind="launch"
      handle={handle}
      args={args}
      commandLabel={`Launch ${shipName}`}
      label={
        crewCount > 0
          ? `Launch ${shipName} (${crewCount} crew)`
          : `Launch ${shipName} unmanned`
      }
      confirmLabel="Confirm launch"
      pendingLabel="Launching..."
    />
  );
}
