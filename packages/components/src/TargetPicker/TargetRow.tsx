import type { TargetListEntry } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Row, Spinner, Unit } from "@ksp-gonogo/ui-kit";
import { entrySubtitle } from "./entries";
import { EntryName, RowDistance, RowMain, RowSubtitle, RowTag } from "./styles";

/** One pickable roster row: name and subtitle, range, and a spinner while its set awaits the readback. */
export function TargetRow({
  entry,
  isPending,
  onPick,
}: Readonly<{
  entry: TargetListEntry;
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
        {entry.distance === undefined ? (
          NULL_DISPLAY
        ) : (
          <Unit value={entry.distance} />
        )}
      </RowDistance>
      {isPending && <Spinner ariaLabel="Setting target" />}
      {!isPending && entry.isCurrent && <RowTag>TARGET</RowTag>}
    </Row>
  );
}
