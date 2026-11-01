import styled from "styled-components";
import { useActiveCentres } from "../components/VantageControl";
import { vantageLabels } from "../components/vantageLabels";

/**
 * The name of the command centre a GO/NO-GO poll belongs to, as the vantage
 * picker names it. Draws nothing until the centre and its name are known.
 */
export function PollCentreName({ centre }: { centre: string | null }) {
  const { active } = useActiveCentres();
  const name = centre ? vantageLabels(active).get(centre) : undefined;
  if (!name) return null;
  return (
    <PollCentreName__Text>
      <PollCentreName__Label>Poll at</PollCentreName__Label> {name}
    </PollCentreName__Text>
  );
}

const PollCentreName__Label = styled.span`
  text-transform: uppercase;
`;

const PollCentreName__Text = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  white-space: nowrap;
`;
