import { readingOf, type TopicReading } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  NULL_DISPLAY,
  Row,
  RowName,
  speakQuantity,
  Text,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Contribution } from "./flow";
import { ROW_EFF } from "./styles";

type FlowSign = "pos" | "neg" | "zero";

// A zero flow is neutral, not green: a shadowed panel is idle, not producing.
function flowSign(flow: number): FlowSign {
  if (Math.abs(flow) < 1e-9) return "zero";
  if (flow > 0) return "pos";
  return "neg";
}

const FLOW_TONE = { pos: "go", neg: "warn", zero: "neutral" } as const;

/** One part's flow of the focused resource, with its efficiency against nominal where both are known. */
export function ContributionRow({
  contribution,
  currency,
}: {
  contribution: Contribution;
  /** The `vessel.parts` read this row's numbers came off. */
  currency: TopicReading<unknown>;
}) {
  const { partTitle, flow, flowKnown, nominalFlow } = contribution;
  const sign = flowSign(flow);
  // No efficiency without a measured flow.
  const eff =
    flowKnown && typeof nominalFlow === "number" && Math.abs(nominalFlow) > 1e-9
      ? Math.abs(flow / nominalFlow)
      : null;
  return (
    <Row>
      <RowName>{partTitle}</RowName>
      {eff !== null && (
        <Tooltip
          text={`${speakQuantity(value("%", eff * 100), { decimals: 0 })} of nominal`}
          focusable
        >
          <span style={ROW_EFF}>
            <Unit
              value={readingOf(currency, () => value("%", eff * 100))}
              decimals={0}
            />
          </span>
        </Tooltip>
      )}
      <Tooltip
        text={flowKnown ? undefined : "No flow reading for this part"}
        focusable
      >
        <Text
          tone={FLOW_TONE[sign]}
          level={sign === "zero" ? "faint" : undefined}
        >
          {flowKnown
            ? `${sign === "pos" ? "+" : ""}${flow.toFixed(2)}`
            : NULL_DISPLAY}
        </Text>
      </Tooltip>
    </Row>
  );
}
