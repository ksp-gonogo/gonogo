import { type HeldGrade, useViewUt } from "@ksp-gonogo/sitrep-client";
import type { Reading, TargetListEntry, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  HeldFigure,
  heldWord,
  NULL_DISPLAY,
  Row,
  Spinner,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { entrySubtitle } from "./entries";
import { knowledgeCaption, seenAsItIs, unchangedSinceHeard } from "./knowledge";
import { EntryName, RowDistance, RowMain, RowSubtitle, RowTag } from "./styles";

/** One pickable roster row: name and subtitle, range, and a spinner while its set awaits the readback. */
export function TargetRow({
  entry,
  distance,
  listHeld,
  isPending,
  onPick,
}: Readonly<{
  entry: TargetListEntry;
  /** The entry's range as a reading of the roster, so a held roster marks it. */
  distance: Reading<Value<"m">> | undefined;
  /** The grade the roster is held at while it has stopped arriving, so a row with no range of its own still says so. */
  listHeld?: HeldGrade;
  isPending: boolean;
  onPick: (entry: TargetListEntry) => void;
}>) {
  const subtitle = entrySubtitle(entry);
  return (
    <Row
      as="button"
      interactive
      type="button"
      selected={entry.isCurrent}
      onClick={() => onPick(entry)}
    >
      <RowMain>
        <EntryName>{entry.name}</EntryName>
        {subtitle && <RowSubtitle>{subtitle}</RowSubtitle>}
      </RowMain>
      <RowDistance>
        {seenAsItIs(entry) ? (
          <SeenRange entry={entry} distance={distance} />
        ) : (
          <KnownOnly entry={entry} distance={distance} listHeld={listHeld} />
        )}
      </RowDistance>
      {isPending && <Spinner ariaLabel="Setting target" />}
      {!isPending && entry.isCurrent && <RowTag>TARGET</RowTag>}
    </Row>
  );
}

/** The range to a craft the active one sees, off the roster itself. */
function SeenRange({
  entry,
  distance,
}: Readonly<{
  entry: TargetListEntry;
  distance: Reading<Value<"m">> | undefined;
}>) {
  return entry.distance === undefined ? (
    NULL_DISPLAY
  ) : (
    <Unit value={distance} />
  );
}

/**
 * A craft the active one only knows of. It has no measured range, since a
 * range is something the craft measures. Where the orbit it was last heard or
 * sighted on can be carried to now, the range that orbit gives stands in its
 * place under the modelled mark; where it cannot, the held mark stands alone.
 * Either way the words on hover and in the spoken name say how old the
 * knowledge is and how it came, and open with the list's own grade where the
 * list itself has stopped arriving: what the craft knew is then as old as the
 * list. The clock is read here and not in the list, so only these rows follow
 * it.
 */
function KnownOnly({
  entry,
  distance,
  listHeld,
}: Readonly<{
  entry: TargetListEntry;
  distance: Reading<Value<"m">> | undefined;
  listHeld: HeldGrade | undefined;
}>) {
  const viewUt = useViewUt();
  const known = knowledgeCaption(entry, viewUt);
  const caption =
    listHeld !== undefined && known !== null
      ? `${heldWord(listHeld)}. ${known}`
      : known;
  const reckoned =
    distance?.reckoning.status === "available"
      ? distance.reckoning.modelled
      : undefined;
  if (reckoned == null || !reckoned.isFinite()) {
    return (
      <HeldFigure
        kind={
          unchangedSinceHeard(entry) && listHeld === undefined
            ? "modelled"
            : "held"
        }
        caption={caption}
      >
        {NULL_DISPLAY}
      </HeldFigure>
    );
  }
  return (
    <HeldFigure
      kind="modelled"
      caption={`${caption}. Range reckoned along that orbit`}
    >
      <Unit value={reckoned} />
    </HeldFigure>
  );
}
