import type { CarriedCurrency } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  CommandButton,
  type CommandButtonHandle,
  Inline,
  Row,
  Stack,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { StrategyCost } from "./AvailableRow";
import { StrategyName } from "./styles";
import type { Strategy } from "./types";

/** The widget is drawn short below this many rows; a tall tile has room for the full cards. */
export const SHORT_BELOW_ROWS = 7;

/** What the one badge on a short row says: the strategy's state, with the game's own reason where it has one. */
export type ShortState =
  | { kind: "active" }
  | { kind: "available" }
  | { kind: "unchecked"; reason: string }
  | { kind: "locked"; reason: string };

export interface ShortRowProps {
  strategy: Strategy;
  state: ShortState;
  expanded: boolean;
  onToggleExpanded: () => void;
  funds: number | null;
  reputation: number | null;
  science: number | null;
  rosterFrom: readonly CarriedCurrency[];
  factor: number;
  activateCmd: CommandButtonHandle;
  deactivateCmd: CommandButtonHandle;
  /** True when the screen's own body carries the verbs, so the row draws neither button nor price. */
  drawsOwnActions: boolean;
  /** The details a press on the name opens: the effects, the blurb and the factor slider. */
  details: ReactNode;
}

/**
 * One strategy on one line: its name, its state and the one action it offers.
 * Everything else (the effects, the blurb, the factor slider) is a press on the
 * name away.
 */
export function ShortRow({
  strategy: s,
  state,
  expanded,
  onToggleExpanded,
  funds,
  reputation,
  science,
  rosterFrom,
  factor,
  activateCmd,
  deactivateCmd,
  drawsOwnActions,
  details,
}: Readonly<ShortRowProps>) {
  const offersActivate =
    state.kind === "available" || state.kind === "unchecked";
  const badge = (() => {
    switch (state.kind) {
      case "active":
        // A Deactivate button already says it is active; the badge is for a row with no verb.
        return drawsOwnActions ? <Badge tone="go">ACTIVE</Badge> : null;
      case "available":
        return null;
      case "unchecked":
        return (
          <Tooltip
            text={state.reason || "Eligibility could not be read"}
            focusable
          >
            <Badge tone="warn">UNCHECKED</Badge>
          </Tooltip>
        );
      case "locked":
        return (
          <Tooltip text={state.reason} focusable>
            <Badge>LOCKED</Badge>
          </Tooltip>
        );
    }
  })();
  return (
    <Stack as="li" style={{ listStyle: "none" }}>
      <Row as="div" wrap>
        <Row.Name>
          <StrategyName
            type="button"
            variant="text"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
          >
            {s.title}
          </StrategyName>
        </Row.Name>
        <Inline>
          {badge}
          {offersActivate && !drawsOwnActions && (
            <StrategyCost
              strategy={s}
              funds={funds}
              reputation={reputation}
              science={science}
              rosterFrom={rosterFrom}
              factor={factor}
            />
          )}
        </Inline>
      </Row>
      {!drawsOwnActions && offersActivate && (
        <CommandButton
          size="sm"
          handle={activateCmd}
          args={{ strategyId: s.id, factor }}
          commandLabel={`Activate ${s.title}`}
          label="Activate"
          confirmLabel="Confirm activate"
          pendingLabel="Activating..."
        />
      )}
      {!drawsOwnActions && state.kind === "active" && (
        <CommandButton
          size="sm"
          handle={deactivateCmd}
          args={{ strategyId: s.id }}
          commandLabel={`Deactivate ${s.title}`}
          label="Deactivate"
          confirmLabel="Confirm deactivate"
          confirmTone="nogo"
          pendingLabel="Deactivating..."
          title="Deactivate this strategy"
        />
      )}
      {expanded && details}
    </Stack>
  );
}
