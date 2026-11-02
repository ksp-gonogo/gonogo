import { Button, Tooltip } from "@ksp-gonogo/ui-kit";
import { LEVEL_NAMES } from "./LensStack";
import type { RendezvousLevel } from "./levels";

export interface LevelDotsProps {
  /** The levels the target passes through, in the order the view zooms. */
  levels: readonly RendezvousLevel[];
  /** The level the large circle is at. */
  current: RendezvousLevel;
  /** Called with the level the operator picks. */
  onSelect: (level: RendezvousLevel) => void;
}

/**
 * A row of small dots at the foot of the view, one for each level, the filled
 * one for the level the large circle is at. Each is a button named for its
 * level, so the operator can step to a level by hand with the keyboard or a
 * pointer. Useful for moving between the circles when the view's own choice is
 * not the one wanted. Used by the Rendezvous widget.
 */
export function LevelDots({
  levels,
  current,
  onSelect,
}: Readonly<LevelDotsProps>) {
  return (
    <fieldset
      aria-label="Rendezvous level"
      style={{
        border: 0,
        margin: 0,
        padding: 0,
        minWidth: 0,
        display: "flex",
        justifyContent: "center",
        gap: "var(--gap-related-compact)",
      }}
    >
      {levels.map((level) => {
        const on = level === current;
        return (
          <Tooltip key={level} text={LEVEL_NAMES[level]}>
            <Button
              variant="text"
              size="sm"
              aria-label={`${LEVEL_NAMES[level]} level`}
              aria-current={on ? "step" : undefined}
              onClick={() => onSelect(level)}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "block",
                  width: 8,
                  height: 8,
                  borderRadius: "var(--radius-circle)",
                  boxSizing: "border-box",
                  backgroundColor: on
                    ? "var(--color-accent-fg)"
                    : "transparent",
                  border: on ? "none" : "1px solid var(--color-text-faint)",
                }}
              />
            </Button>
          </Tooltip>
        );
      })}
    </fieldset>
  );
}
