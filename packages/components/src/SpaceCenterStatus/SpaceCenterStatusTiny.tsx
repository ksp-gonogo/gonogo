import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  NULL_DISPLAY,
  Panel,
  Section,
  speakQuantity,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import { FundsDrain, reportsFundsDrain } from "../shared/FundsDrain";
import { TinyDrain, TinyFunds, TinyFundsUnit, TinyPad } from "./styles";

export interface SpaceCenterStatusTinyProps {
  careerFunds: number | null;
  netFunds: number | null;
  heldFunds: boolean;
  fundsReading: UnitValue<"funds">;
  padOccupied: boolean | null | undefined;
  padLine: string;
}

export function SpaceCenterStatusTiny({
  careerFunds,
  netFunds,
  heldFunds,
  fundsReading,
  padOccupied,
  padLine,
}: SpaceCenterStatusTinyProps) {
  return (
    <Panel
      panelTitle="KSC"
      fitToSize
      sections={
        <Section>
          {careerFunds !== null ? (
            <TinyFunds
              title={speakQuantity(value("funds", careerFunds), {
                decimals: 0,
              })}
            >
              {formatTinyFunds(Math.round(careerFunds))}
              <TinyFundsUnit>f</TinyFundsUnit>
              {/* At this size the drain arrives as how long the balance lasts. */}
              {reportsFundsDrain(netFunds) && (
                <TinyDrain>
                  <FundsDrain
                    funds={careerFunds}
                    netPerDay={netFunds}
                    compact
                  />
                </TinyDrain>
              )}
            </TinyFunds>
          ) : (
            <TinyFunds>
              {heldFunds ? (
                <Unit value={fundsReading} decimals={0} />
              ) : (
                NULL_DISPLAY
              )}
            </TinyFunds>
          )}
          <TinyPad
            $occupied={padOccupied === true}
            title={padLine}
            role="img"
            aria-label={padLine}
          >
            {/* "PAD CLEAR" is the same claim as the line above, in two words. */}
            {padWord(padOccupied)}
          </TinyPad>
        </Section>
      }
    />
  );
}

function padWord(padOccupied: boolean | null | undefined): string {
  if (padOccupied === true) return "PAD ACTIVE";
  if (padOccupied === false) return "PAD CLEAR";
  return "PAD UNKNOWN";
}

// Whole-number k/M so the string stays 3-4 chars in the narrowest box; the full value is in `title`.
function formatTinyFunds(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toFixed(0);
}
