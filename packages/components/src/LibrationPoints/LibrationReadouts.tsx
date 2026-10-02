import type {
  LibrationAnswer,
  LibrationOffset,
} from "@ksp-gonogo/sitrep-client";
import { staticValue, type Tone, value } from "@ksp-gonogo/sitrep-sdk";
import { Row, RowName, Text, Unit } from "@ksp-gonogo/ui-kit";
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
  craftHeldSince,
  catalogueHeldSince,
}: Readonly<{
  answer: LibrationAnswer;
  offset: LibrationOffset | null;
  /** Whether there is a craft orbit of now at all, observed or modelled. */
  hasCraft: boolean;
  /** When the craft's orbit was last observed, while only a model places it. */
  craftHeldSince: HeldSince;
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
      {hasCraft && (
        <CraftOffsetRows offset={offset} heldSince={craftHeldSince} />
      )}
    </>
  );
}

function CraftOffsetRows({
  offset,
  heldSince,
}: Readonly<{ offset: LibrationOffset | null; heldSince: HeldSince }>) {
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
          <Unit
            value={heldFigure(value("m", offset.distanceMetres), heldSince)}
          />
        </Text>
      </Row>
    </>
  );
}
