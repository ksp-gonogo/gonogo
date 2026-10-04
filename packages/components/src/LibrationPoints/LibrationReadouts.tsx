import type {
  LibrationAnswer,
  LibrationOffset,
} from "@ksp-gonogo/sitrep-client";
import { staticValue, type Tone, value } from "@ksp-gonogo/sitrep-sdk";
import {
  type ReckoningMarking,
  Row,
  RowName,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { type HeldSince, heldFigure } from "../shared/heldFigure";

/** Not stationkeeping carries no state, so it recedes through the `muted` level the rows pass alongside. */
const KEEPING_TONE: Record<LibrationOffset["keeping"], Tone> = {
  "on-station": "go",
  drifting: "warn",
  elsewhere: "neutral",
};

const KEEPING_WORDS = {
  "on-station": "holding station",
  drifting: "drifting off station",
  elsewhere: "not stationkeeping on it",
} as const;

/** The pair's separation and mass ratio, then where the craft sits against its nearest point. */
export function LibrationReadouts({
  answer,
  offset,
  hasCraft,
  craftMarking,
  catalogueHeldSince,
}: Readonly<{
  answer: LibrationAnswer;
  offset: LibrationOffset | null;
  /** Whether there is a craft orbit of now at all, observed or modelled. */
  hasCraft: boolean;
  /** The mark the craft's orbit gives the figures derived from it. */
  craftMarking: ReckoningMarking | null;
  /** When the catalogue was last a reading of now; the pair's separation follows its orbit. */
  catalogueHeldSince: HeldSince;
}>) {
  return (
    <>
      <Row>
        <RowName>Separation</RowName>
        <Text>
          <Unit
            value={heldFigure(
              value("m", answer.frame?.unitLength ?? 0),
              catalogueHeldSince,
            )}
          />
        </Text>
      </Row>
      <Row>
        <RowName>Mass ratio</RowName>
        <Text>
          {/* The only parameter the five positions depend on, and a function of two body masses alone. */}
          <Unit value={staticValue("%", answer.massRatio * 100)} decimals={3} />
        </Text>
      </Row>
      {/* With no orbit of now there is no craft to place, so there is nothing to say about one. */}
      {hasCraft && <CraftOffsetRows offset={offset} marking={craftMarking} />}
    </>
  );
}

function CraftOffsetRows({
  offset,
  marking,
}: Readonly<{
  offset: LibrationOffset | null;
  marking: ReckoningMarking | null;
}>) {
  if (offset === null) {
    return (
      <Row>
        <RowName>Craft</RowName>
        <Text level="muted">not placeable in this frame</Text>
      </Row>
    );
  }
  return (
    <>
      <Row>
        <RowName>Nearest</RowName>
        <Text tone={KEEPING_TONE[offset.keeping]} level="muted">
          {offset.nearest} · {KEEPING_WORDS[offset.keeping]}
        </Text>
      </Row>
      <Row>
        <RowName>Off station</RowName>
        <Text tone={KEEPING_TONE[offset.keeping]} level="muted">
          <Unit value={value("m", offset.distanceMetres)} marked={marking} />
        </Text>
      </Row>
    </>
  );
}
