import { NULL_DISPLAY, Row, RowName, Text, Tooltip } from "@ksp-gonogo/ui-kit";

/** Why a draw figure reads as unknown: it is taken from the stored charge, which does not move while the batteries are full or empty. */
export const UNKNOWN_DRAW_TEXT =
  "Draw is read from the change in stored charge, which does not move while the batteries are full or empty";

/**
 * The electric charge the batteries lose that no part reports a draw for, as
 * one row after the consumers. With no figure it shows the unknown mark and
 * says why: the total draw is read from the stored charge, which does not move
 * while the batteries are full or empty.
 */
export function OtherDrawRow({
  draw,
}: Readonly<{
  /** The unattributed draw in EC per second as a positive figure, or null when it cannot be known. */
  draw: number | null;
}>) {
  return (
    <Row>
      <RowName>Other</RowName>
      {draw === null ? (
        <Tooltip text={UNKNOWN_DRAW_TEXT} focusable>
          <Text level="faint" aria-label="Other draw unknown">
            {NULL_DISPLAY}
          </Text>
        </Tooltip>
      ) : (
        <Text
          tone={draw > 0 ? "warn" : "neutral"}
          level={draw > 0 ? undefined : "faint"}
        >
          {draw > 0 ? "-" : ""}
          {draw.toFixed(2)}
        </Text>
      )}
    </Row>
  );
}
