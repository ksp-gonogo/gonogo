import { value } from "@ksp-gonogo/sitrep-sdk";
import { Button, Unit } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import styled from "styled-components";
import { type HeldSince, heldFigure } from "./heldFigure";
import { fmtCountdown, fmtDays } from "./labels";
import { ListWrap, SectionHead } from "./layout";
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
              <WindowRow
                type="button"
                $selected={isSel}
                aria-expanded={isSel}
                onClick={() => onSelect(w.index)}
              >
                <ColWait>{fmtCountdown(w.waitSeconds)}</ColWait>
                <ColDv>
                  <Unit value={value("m/s", w.deltaV)} />
                </ColDv>
                <ColTof>{fmtDays(w.transferTimeSec)}</ColTof>
              </WindowRow>
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

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const ListItem = styled.li`
  display: flex;
  flex-direction: column;
`;

const WindowRow = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--gap-section);
  align-items: center;
  width: 100%;
  text-align: left;
  padding: var(--inset-window-row);
  background: ${({ $selected }) =>
    $selected ? "var(--color-surface-raised)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "var(--color-accent-fg)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover {
    border-color: var(--color-border-strong);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ColWait = styled.span`
  color: var(--color-text-primary);
`;

const ColDv = styled.span`
  color: var(--color-text-muted);
`;

const ColTof = styled.span`
  color: var(--color-text-dim);
`;

const Expander = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding: var(--inset-window-expander);
`;

const ExpRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: var(--gap-section);
`;

const ExpLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
`;

const ExpValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
`;
