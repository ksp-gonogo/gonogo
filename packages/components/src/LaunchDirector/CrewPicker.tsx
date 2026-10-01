import {
  Cluster,
  ReadoutCaption,
  SelectableRow,
  Stack,
} from "@ksp-gonogo/ui-kit";
import {
  CREW_GRID_MIN_ROWS,
  type CrewMember,
  crewChipDetail,
  crewChipTitle,
  crewReading,
  crewTally,
} from "./crew";
import {
  CrewDisclosure,
  CrewGrid,
  CrewName,
  CrewTrait,
  SectionLabel,
} from "./styles";

/** The roster for the picked craft; only a kerbal who can fly today is selectable. */
export function CrewPicker({
  crew,
  selectedCrew,
  manifestSize,
  onToggleCrew,
  rows,
}: {
  crew: CrewMember[] | null;
  selectedCrew: ReadonlySet<string>;
  /** The selection the launch would actually seat. */
  manifestSize: number;
  onToggleCrew: (name: string) => void;
  /** The tile's height in grid rows; decides whether the crew grid stands open. */
  rows: number;
}) {
  if (crew === null) {
    return (
      <>
        <SectionLabel>Crew</SectionLabel>
        {/* The roster's own absence, said out loud; nothing to fold, so no expander. */}
        <ReadoutCaption>Roster: no reading</ReadoutCaption>
      </>
    );
  }
  const open = rows >= CREW_GRID_MIN_ROWS;
  return (
    /* The tally is the expander's own label; `key` re-seats the fold when a resize crosses the threshold. */
    <CrewDisclosure
      key={open ? "open" : "folded"}
      variant="inline"
      panelHeight="auto"
      defaultOpen={open}
      label={
        <SectionLabel>
          Crew
          {crewTally(crew, manifestSize)}
        </SectionLabel>
      }
    >
      <CrewGrid $compact={!open}>
        {crew.map((k) => {
          const reading = crewReading(k);
          const selectable = reading === "available";
          return (
            <SelectableRow
              key={k.name}
              /* Named, so a render scene can select a specific kerbal. */
              data-crew-chip={k.name}
              selected={selectedCrew.has(k.name)}
              aria-disabled={!selectable}
              title={crewChipTitle(k, reading)}
              onClick={() => {
                if (!selectable) return;
                onToggleCrew(k.name);
              }}
            >
              {/* Compact puts name and reason on one line; the reason is never truncated, so the compact track is wider. */}
              {open ? (
                <Stack gap="caption">
                  <CrewName>{k.name}</CrewName>
                  {/* The reason is a fact off the wire and belongs on screen. */}
                  <CrewTrait>{crewChipDetail(k, reading)}</CrewTrait>
                </Stack>
              ) : (
                <Cluster align="baseline" wrap gap="related-compact">
                  <CrewName>{k.name}</CrewName>
                  <CrewTrait>{crewChipDetail(k, reading)}</CrewTrait>
                </Cluster>
              )}
            </SelectableRow>
          );
        })}
      </CrewGrid>
    </CrewDisclosure>
  );
}
