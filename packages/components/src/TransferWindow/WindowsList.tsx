import { value } from "@ksp-gonogo/sitrep-sdk";
import { Button, SelectableRow, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { type HeldSince, heldFigure } from "../shared/heldFigure";
import { fmtCountdown, fmtDays } from "./labels";
import {
  ColDv,
  ColTof,
  ColWait,
  Expander,
  ExpLabel,
  ExpRow,
  ExpValue,
  List,
  ListItem,
  ListWrap,
  SectionHead,
} from "./styles";
import type { TransferWindowEntry } from "./transferData";

export function WindowsList({
  windows,
  selectedIndex,
  onSelect,
  orbitHeldSince,
  destPicker,
  createAlarm,
}: {
  windows: TransferWindowEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Ejection figures come from the parking orbit, so they hold with it. */
  orbitHeldSince: HeldSince;
  /** The destination select, on this section's heading line: it scopes THIS list. */
  destPicker: ReactNode;
  createAlarm: ((w: TransferWindowEntry) => void) | null;
}) {
  return (
    <ListWrap>
      <SectionHead>{destPicker}</SectionHead>
      <List>
        {windows.map((w) => {
          const isSel = w.index === selectedIndex;
          return (
            <ListItem key={w.index}>
              <SelectableRow
                layout="split"
                gap="section"
                selected={isSel}
                selectedLook="outline"
                aria-expanded={isSel}
                onClick={() => onSelect(w.index)}
              >
                <ColWait>{fmtCountdown(w.waitSeconds)}</ColWait>
                <ColDv>
                  <Unit value={value("m/s", w.deltaV)} />
                </ColDv>
                <ColTof>{fmtDays(w.transferTimeSec)}</ColTof>
              </SelectableRow>
              {isSel && (
                <Expander>
                  <ExpRow>
                    <ExpLabel>Departs</ExpLabel>
                    <ExpValue>+{fmtDays(w.waitSeconds)}</ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Arrives</ExpLabel>
                    <ExpValue>
                      +{fmtDays(w.waitSeconds + w.transferTimeSec)}
                    </ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Transfer time</ExpLabel>
                    <ExpValue>{fmtDays(w.transferTimeSec)}</ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Ejection Δv</ExpLabel>
                    <ExpValue>
                      <Unit
                        value={heldFigure(
                          value("m/s", w.ejectionDeltaV),
                          orbitHeldSince,
                        )}
                        decimals={0}
                      />
                    </ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Ejection angle</ExpLabel>
                    <ExpValue>
                      <Unit
                        value={value("°", w.ejectionAngleDeg)}
                        decimals={0}
                      />{" "}
                      to prograde
                    </ExpValue>
                  </ExpRow>
                  {createAlarm && (
                    <Button type="button" onClick={() => createAlarm(w)}>
                      Set window alarm
                    </Button>
                  )}
                </Expander>
              )}
            </ListItem>
          );
        })}
      </List>
    </ListWrap>
  );
}
