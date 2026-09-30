import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { HeldFigure } from "./HeldMark";
import { MODELLED_TO_SCET, modelledBeyondReceived } from "./readingCurrency";
import { standsApart, writtenAs, writtenQuantity } from "./standsApart";
import { Unit } from "./Unit";

const ModelledAlongside__Figure = styled.span`
  margin-left: 0.6em;
  color: var(--color-text-muted);
`;

/**
 * Props for {@link ModelledAlongside} with a `Value` pair: a modelled quantity beside the quantity observed, drawn through {@link Unit}.
 *
 * @category Unit
 */
export interface ModelledQuantityAlongsideProps<UnitSymbol extends string> {
  /** The observation the caller has drawn just before this. */
  observed: Value<UnitSymbol> | null | undefined;
  /** The model's figure; nothing is drawn without one. */
  modelled: Value<UnitSymbol> | null | undefined;
  write?: undefined;
}

/**
 * Props for {@link ModelledAlongside} with any other figure: a modelled figure beside the figure observed, both written by `write`.
 *
 * @category Unit
 */
export interface ModelledFigureAlongsideProps<Figure> {
  /** The observation the caller has drawn just before this, written by `write`. */
  observed: Figure | null | undefined;
  /** The model's figure; nothing is drawn without one. */
  modelled: Figure | null | undefined;
  /** How the caller writes the observation, which is how the modelled figure is written and compared. */
  write: (figure: Figure) => string;
}

/**
 * A modelled figure drawn beside the observation it was carried from, never in
 * its place, with the modelled mark. The caller draws the observation first.
 *
 * Drawn only where the figure stands apart from the observation at the
 * precision both are drawn (see {@link standsApart}), so a model that agrees
 * with what was received to the last place drawn is not repeated. A `Value`
 * pair is drawn through {@link Unit}; anything else goes through `write`.
 *
 * @category Unit
 */
export function ModelledAlongside<UnitSymbol extends string>(
  props: ModelledQuantityAlongsideProps<UnitSymbol>,
): ReactNode;
export function ModelledAlongside<Figure>(
  props: ModelledFigureAlongsideProps<Figure>,
): ReactNode;
export function ModelledAlongside({
  observed,
  modelled,
  write,
}:
  | ModelledFigureAlongsideProps<unknown>
  | ModelledQuantityAlongsideProps<string>) {
  if (modelled === null || modelled === undefined) return null;
  if (write === undefined) {
    const quantity = modelled as Value<string>;
    if (!standsApart(observed as Value<string>, quantity, writtenQuantity()))
      return null;
    return (
      <ModelledMark>
        <Unit value={quantity} />
      </ModelledMark>
    );
  }
  if (!standsApart(observed, modelled, writtenAs(write))) return null;
  return <ModelledMark>{write(modelled)}</ModelledMark>;
}

function ModelledMark({ children }: { children: ReactNode }) {
  return (
    <ModelledAlongside__Figure data-modelled-alongside="">
      <HeldFigure data-held="" caption={MODELLED_TO_SCET}>
        {children}
      </HeldFigure>
    </ModelledAlongside__Figure>
  );
}

/**
 * A reading's observation through {@link Unit}, followed by the model's figure
 * with the modelled mark where the model reaches past the received edge to a
 * figure that reads apart from it. Shorthand for a {@link Unit} followed by a
 * {@link ModelledAlongside} fed from {@link modelledBeyondReceived}.
 *
 * @category Unit
 */
export function ReckonedUnit<UnitSymbol extends string>({
  value,
}: {
  value: Reading<Value<UnitSymbol>>;
}) {
  return (
    <>
      <Unit value={value} />
      <ModelledAlongside
        observed={value.value}
        modelled={modelledBeyondReceived(value)}
      />
    </>
  );
}
