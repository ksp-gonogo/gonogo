import type { HeldGrade } from "@ksp-gonogo/sitrep-client";
import {
  Badge,
  Cluster,
  MissionDate,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Arrival } from "./arrivals";

/** How many arrivals the widget lists; the wire keeps more. */
export const ARRIVALS_SHOWN = 5;

/**
 * The results the vessel has sent that have reached the command centre, newest
 * first, each with the instant its last packet left the vessel. A result is
 * listed only once it has arrived here, so nothing appears before the signal
 * delay has passed. Renders nothing when none has arrived.
 */
export function ArrivalsSection({
  arrivals,
  heldGrade,
}: {
  arrivals: Arrival[] | null;
  /** `science.transmissions` stopped arriving: the list is the last one received. */
  heldGrade: HeldGrade | undefined;
}) {
  if (arrivals === null || arrivals.length === 0) return null;
  return (
    <Stack as="ul" aria-label="Transmissions that have arrived">
      {arrivals.slice(0, ARRIVALS_SHOWN).map((arrival) => (
        <li key={arrival.key}>
          <Cluster justify="start" wrap>
            <Text size="sm">{arrival.title ?? "Science result"}</Text>
            <Badge tone={heldGrade === undefined ? "go" : "neutral"} size="sm">
              Arrived
            </Badge>
            {arrival.size !== null && (
              <Text level="muted" size="xs">
                <Unit value={arrival.size} decimals={1} />
              </Text>
            )}
            <Text level="muted" size="xs">
              Left the vessel <MissionDate value={arrival.leftAt} />
              {arrival.sendTime !== null && (
                <>
                  {" "}
                  after <Unit value={arrival.sendTime} /> of sending
                </>
              )}
            </Text>
          </Cluster>
        </li>
      ))}
    </Stack>
  );
}
