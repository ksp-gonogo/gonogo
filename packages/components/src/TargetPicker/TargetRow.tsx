import { useViewUt } from "@ksp-gonogo/sitrep-client";
import type { Reading, TargetListEntry, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  HeldFigure,
  NULL_DISPLAY,
  Row,
  Spinner,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { entrySubtitle } from "./entries";
import { knowledgeCaption, seenAsItIs } from "./knowledge";
import { EntryName, RowDistance, RowMain, RowSubtitle, RowTag } from "./styles";

/** One pickable roster row: name and subtitle, range, and a spinner while its set awaits the readback. */
export function TargetRow({
  entry,
  distance,
  isPending,
  onPick,
}: Readonly<{
  entry: TargetListEntry;
  /** The entry's range as a reading of the roster, so a held roster marks it. */
  distance: Reading<Value<"m">> | undefined;
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
          <KnownOnly entry={entry} />
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
 * A craft the active one only knows of. It has no range to quote, since a
 * range is something the craft measures, so the place a range would be takes
 * the held mark, with how old the knowledge is and how it came on hover and
 * in the spoken name. The clock is read here and not in the list, so only
 * these rows follow it.
 */
function KnownOnly({ entry }: Readonly<{ entry: TargetListEntry }>) {
  const viewUt = useViewUt();
  return (
    <HeldFigure caption={knowledgeCaption(entry, viewUt)}>
      {NULL_DISPLAY}
    </HeldFigure>
  );
}
