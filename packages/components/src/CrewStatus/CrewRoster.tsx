import { AugmentSlot } from "@ksp-gonogo/core";
import {
  Card,
  EmptyState,
  FramedDisplay,
  Inline,
  type ReadoutTone,
  Stack,
  Truncate,
  WidgetMeters,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/** Avatar cell bounds. Sized off the roster's measured width, not the viewport, since a tile's width has no fixed relation to the window. */
const AVATAR_CELL_MIN_PX = 36;
const AVATAR_CELL_MAX_PX = 56;
/** Fraction of the measured roster width the avatar cell targets before clamping. */
const AVATAR_CELL_WIDTH_FRACTION = 0.2;
/** Seed width until the first measurement lands: the default 6-column width, so first paint is mid-range. */
export const AVATAR_MEASURE_SEED = { w: 232, h: 0 };

export function avatarCellSizePx(containerWidthPx: number): number {
  return Math.round(
    Math.min(
      AVATAR_CELL_MAX_PX,
      Math.max(
        AVATAR_CELL_MIN_PX,
        containerWidthPx * AVATAR_CELL_WIDTH_FRACTION,
      ),
    ),
  );
}

export function renderRoster({
  known,
  crewCount,
  names,
  avatarSizePx,
  avatarBound,
  rowToneByName,
  omitCardFor,
  suppressNameFor,
}: {
  known: boolean;
  crewCount: number | undefined;
  names: string[];
  avatarSizePx: number;
  /** Reserve the leading avatar cell: an augment that can render is bound to `crew-status.avatar`. */
  avatarBound: boolean;
  rowToneByName: ReadonlyMap<string, ReadoutTone>;
  /** Skip this row's Card entirely: the EVA header already named this
   *  kerbal and nothing else is bound to their row. */
  omitCardFor?: string;
  /** Keep this row's Card, but drop its name text: the EVA header already
   *  named this kerbal, and the Card still has other content to show. */
  suppressNameFor?: string;
}): React.ReactNode {
  if (!known) return <EmptyState>Waiting for telemetry...</EmptyState>;

  // Only conclude "Unmanned" once the headcount itself has arrived; capacity can land first.
  if (crewCount === undefined) {
    return <EmptyState>Waiting for telemetry...</EmptyState>;
  }

  if (crewCount === 0) {
    return <EmptyState>Unmanned, no kerbals aboard</EmptyState>;
  }

  const rosterListStyle = {
    listStyle: "none",
    margin: "var(--gap-related-comfortable) 0 0",
    padding: 0,
    /* Wider than the gap inside each Card, so rows read as separate surfaces. */
    gap: "var(--gap-section)",
  } as const;

  if (names.length === 0) {
    return (
      <Stack as="ul" style={rosterListStyle}>
        <EmptyState>
          {crewCount} aboard, names unavailable. Crew names can be withheld when
          the vessel is out of CommNet range
        </EmptyState>
      </Stack>
    );
  }

  return (
    <Stack as="ul" style={rosterListStyle}>
      {names.map((name, index) => {
        if (name === omitCardFor) return null;
        const suppressName = name === suppressNameFor;
        return (
          <Card
            as="li"
            key={name}
            tone={rowToneByName.get(name)}
            // The row's identity for assistive tech while its visible name is suppressed.
            aria-label={suppressName ? name : undefined}
            /* The avatar is a visual, so it sits in a framed left aside; the aside sets the frame's corner. */
            left={
              avatarBound ? (
                <CrewAvatarCell
                  sizePx={avatarSizePx}
                  slot={
                    <div style={AVATAR_LAYER_STYLE}>
                      <div style={{ width: "100%", height: "100%" }}>
                        <AugmentSlot
                          name="crew-status.avatar"
                          props={{ crewName: name, crewIndex: index }}
                        />
                      </div>
                    </div>
                  }
                />
              ) : undefined
            }
          >
            {/* Composed in the body, not via `title`, so the avatar aside sits beside the name rather than under it. The name's `flex: 1 1 auto` lets a trailing badge wrap instead of truncating it. */}
            <Card.TitleRow
              right={
                <Inline>
                  <AugmentSlot
                    name="crew-status.row-badges"
                    props={{ crewName: name, crewIndex: index }}
                  />
                </Inline>
              }
            >
              {!suppressName && (
                <Card.Title>
                  <Truncate style={NAME_FLEX_STYLE}>{name}</Truncate>
                </Card.Title>
              )}
            </Card.TitleRow>
            <WidgetMeters row={name} style={CREW_METERS_STYLE} />
          </Card>
        );
      })}
    </Stack>
  );
}

// The augment slot layer fills the avatar cell and centres its content.
const AVATAR_LAYER_STYLE = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

/** Lets a trailing badge wrap rather than shrinking the name into an ellipsis. */
const NAME_FLEX_STYLE = { flex: "1 1 auto" } as const;

/** Indents a row's contributed meters under the kerbal's name, and keeps a gap
 *  before the next roster row. Carried on the stack itself rather than on a
 *  wrapper here, so a kerbal with no meters leaves no padding behind. */
const CREW_METERS_STYLE = {
  paddingBottom: "var(--gap-crew-meters)",
  paddingLeft: "var(--indent-row)",
} as const;

/** Framed square for the avatar augment; `position: relative` so the slot layer fills it. */
function CrewAvatarCell({
  slot,
  sizePx,
}: Readonly<{ slot: ReactNode; sizePx: number }>) {
  return (
    <FramedDisplay
      data-testid="crew-avatar-cell"
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: `${sizePx}px`,
        height: `${sizePx}px`,
      }}
    >
      {slot}
    </FramedDisplay>
  );
}
