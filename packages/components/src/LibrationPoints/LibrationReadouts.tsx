import type {
  LibrationAnswer,
  LibrationOffset,
} from "@ksp-gonogo/sitrep-client";
import { type Tone, value } from "@ksp-gonogo/sitrep-sdk";
import { Row, RowName, Text, Unit } from "@ksp-gonogo/ui-kit";

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
}: Readonly<{ answer: LibrationAnswer; offset: LibrationOffset | null }>) {
  return (
    <>
      <Row>
        <RowName>Separation</RowName>
        <Text>
          <Unit value={value("m", answer.frame?.unitLength ?? 0)} />
        </Text>
      </Row>
      <Row>
        <RowName>Mass ratio</RowName>
        <Text>
          {/* The only parameter the five positions depend on. */}
          <Unit value={value("%", answer.massRatio * 100)} decimals={3} />
        </Text>
      </Row>
      <CraftOffsetRows offset={offset} />
    </>
  );
}

function CraftOffsetRows({
  offset,
}: Readonly<{ offset: LibrationOffset | null }>) {
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
          <Unit value={value("m", offset.distanceMetres)} />
        </Text>
      </Row>
    </>
  );
}
