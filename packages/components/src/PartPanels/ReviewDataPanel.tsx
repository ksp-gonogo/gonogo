import { useTelemetry } from "@ksp-gonogo/core";
import { useCommand, useTransmissions } from "@ksp-gonogo/sitrep-client";
import {
  type PartPanelProps,
  type ScienceTransmission,
  stillTrue,
} from "@ksp-gonogo/sitrep-sdk";
import { EmptyState, Stack, useRailEntry } from "@ksp-gonogo/ui-kit";
import { EMPTY_INSTRUMENTS, parseInstruments } from "../Experiments/parse";
import { ScienceExperimentRow } from "../Experiments/ScienceExperimentRow";
import { heldGrade } from "../shared/heldGrade";

const INSTRUMENT_LIST = {
  listStyle: "none",
  margin: 0,
  padding: 0,
} as const;

/** The instruments on one part, with the same controls the Experiments widget gives them. */
export function ReviewDataPanel({ partId }: Readonly<PartPanelProps>) {
  const reading = useTelemetry("science.instruments");
  const instruments = parseInstruments(stillTrue(reading, EMPTY_INSTRUMENTS));
  const deployCmd = useCommand("science.experiment.deploy");
  const transmitCmd = useCommand("science.experiment.transmit");
  const startCmd = useCommand("science.experiment.start");
  const stopCmd = useCommand("science.experiment.stop");
  const transmissions = useTransmissions();
  useRailEntry(transmissions);

  if (instruments === null) {
    return <EmptyState>Awaiting instrument telemetry</EmptyState>;
  }
  const onPart = instruments.filter((inst) => String(inst.partId) === partId);
  if (onPart.length === 0)
    return <EmptyState>No results on this part</EmptyState>;

  const onTransmitted = (t: ScienceTransmission) =>
    transmissions.expect({
      label: t.title || t.subjectId,
      subject: t.subjectId,
      sentAt: t.startedAt.plus(t.streamSeconds),
    });

  return (
    <Stack as="ul" style={INSTRUMENT_LIST}>
      {onPart.map((inst) => (
        <ScienceExperimentRow
          key={inst.expId}
          instrument={inst}
          underPart
          deployCmd={deployCmd}
          startCmd={startCmd}
          stopCmd={stopCmd}
          transmitCmd={transmitCmd}
          onTransmitted={onTransmitted}
          heldGrade={heldGrade(reading)}
        />
      ))}
    </Stack>
  );
}
