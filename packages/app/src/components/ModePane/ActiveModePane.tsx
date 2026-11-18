import { type ModeDefinition, useModes } from "@ksp-gonogo/core";
import { useCallback, useEffect, useState } from "react";
import { ModePane } from "./ModePane";

/* Each mode's own hook answers whether it is on, so each runs in a component of its own. */
function ModeWatch({
  mode,
  report,
}: {
  mode: ModeDefinition;
  report: (id: string, active: boolean) => void;
}) {
  const active = mode.useActive();
  useEffect(() => report(mode.id, active), [mode.id, active, report]);
  return null;
}

/**
 * The pane and Timeline of the mode that is on: of every registered mode
 * whose `useActive` answers true, the one with the lowest `order`. Draws
 * nothing for a mode with no sections and no Timeline.
 */
export function ActiveModePane({
  titleFor,
}: {
  titleFor: (mode: ModeDefinition) => string;
}) {
  const modes = useModes();
  const [active, setActive] = useState<Readonly<Record<string, boolean>>>({});
  const report = useCallback((id: string, on: boolean) => {
    setActive((prev) => (prev[id] === on ? prev : { ...prev, [id]: on }));
  }, []);
  const mode = modes.find((m) => active[m.id] === true);
  return (
    <>
      {modes.map((m) => (
        <ModeWatch key={m.id} mode={m} report={report} />
      ))}
      {mode ? (
        <ModePane key={mode.id} mode={mode} title={titleFor(mode)} />
      ) : null}
    </>
  );
}
