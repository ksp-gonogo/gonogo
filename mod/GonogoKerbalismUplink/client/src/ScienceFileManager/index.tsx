import type {
  ExperimentEntry,
  Reading,
  SlotProps,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  ActionButton,
  Badge,
  Cluster,
  Section,
  Stack,
  ToggleButton,
  Unit,
  usePanelDelay,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import {
  type KerbalismScienceExperimentExt,
  readKerbalismScienceExperimentExt,
} from "../science";
import { KERBALISM } from "../uplink";

/**
 * How long an armed destructive control (Delete/Dump) stays armed before it
 * quietly disarms, same window AstronautComplex's Hire/Fire buttons use.
 */
const ARM_TIMEOUT_MS = 4000;

/** The file and/or sample entry a subject holds, joined out of the raw
 *  `science.experiments` array. Either may be absent; a subject that has
 *  been fully transmitted keeps only its sample (and vice versa). */
interface DriveEntries {
  file?: KerbalismScienceExperimentExt;
  sample?: KerbalismScienceExperimentExt;
}

/**
 * Joins Kerbalism's drive rows against one Aboard subject. Aboard groups by
 * SUBJECT; the drive itself is per FILE/SAMPLE, so a subject with both still
 * shows as two `science.experiments` entries sharing the same `subjectId`,
 * distinguished by `kind`.
 */
/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function findDriveEntries(
  experiments: ExperimentEntry[] | undefined,
  subjectId: string,
): DriveEntries {
  const out: DriveEntries = {};
  if (!experiments) return out;
  for (const entry of experiments) {
    if (entry.subjectId !== subjectId) continue;
    const ext = readKerbalismScienceExperimentExt(entry);
    if (!ext) continue;
    if (ext.kind === "file") out.file = ext;
    else if (ext.kind === "sample") out.sample = ext;
  }
  return out;
}

/**
 * Arm-then-confirm button for an irreversible verb (Delete/Dump): first
 * click arms a go-toned "Confirm" that auto-disarms after
 * {@link ARM_TIMEOUT_MS}, mirroring AstronautComplex's Fire button. Shared
 * by both destructive controls below rather than duplicated per verb.
 */
function DestructiveButton({
  label,
  armedLabel,
  ariaLabel,
  confirmAriaLabel,
  onConfirm,
}: {
  label: string;
  armedLabel: string;
  ariaLabel: string;
  confirmAriaLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <ActionButton
        type="button"
        onClick={() => setArmed(true)}
        aria-label={ariaLabel}
      >
        {label}
      </ActionButton>
    );
  }
  return (
    <ActionButton
      type="button"
      tone="go"
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
      aria-label={confirmAriaLabel}
    >
      {armedLabel}
    </ActionButton>
  );
}

/** Per-drive capacity/slots readout: the stock model has no concept of
 *  either, so this is enrichment Kerbalism alone can show. Reads off
 *  whichever entry carries the fields (file and sample on the same subject
 *  normally share one drive, so either suffices). */
function DriveCapacity({ ext }: { ext: KerbalismScienceExperimentExt }) {
  const hasStorage =
    ext.storageCapacityMB !== undefined && ext.storageUsedMB !== undefined;
  const hasSlots =
    ext.sampleSlotsTotal !== undefined && ext.sampleSlotsUsed !== undefined;
  if (!hasStorage && !hasSlots) return null;
  return (
    <Value size="xs" tone="muted">
      Drive{" "}
      {hasStorage && (
        <>
          <Unit value={ext.storageUsedMB} /> /{" "}
          <Unit value={ext.storageCapacityMB} />
        </>
      )}
      {hasStorage && hasSlots && " · "}
      {hasSlots && (
        <>
          <Unit value={ext.sampleSlotsUsed} />/
          <Unit value={ext.sampleSlotsTotal} /> slots
        </>
      )}
    </Value>
  );
}

/**
 * The `science-data.aboard-row` augment: Kerbalism's File Manager, one
 * instance per Aboard subject. Joins its own `science.experiments` read
 * against the row's `subjectId` (the base widget hands over identity only,
 * never the drive data itself, matching `crew-status.survival`'s pattern),
 * and renders the applicable verbs per kind: a file gets Send (reversible,
 * reflects `sendFlagged`) and Delete (irreversible); a sample gets Analyze
 * (reversible, reflects the `analyze` flag), Dump (irreversible), and Move
 * to lab (one-shot, disabled when no lab part is aboard to relocate onto).
 *
 * Renders nothing when the subject backs neither a file nor a sample (a
 * stock-only subject, or one Kerbalism has already fully consumed).
 */
function ScienceDataAboardRowAugment({
  subjectId,
}: SlotProps<"science-data.aboard-row">) {
  // A drive's file list is a fact: it changes when an experiment runs or a file is
  // moved, and a quiet link cannot have moved one. Before this the raw `Reading`
  // reached `findDriveEntries` and threw "experiments is not iterable", which `tsc`
  // could not see because that helper takes `unknown`.
  const experiments = stillTrue(useTelemetry("science.experiments"), undefined);
  const labs = stillTrue(useTelemetry("science.lab"), undefined);

  // Every command is dispatched from this row regardless of which verbs it
  // ends up rendering, so all five hooks (and their panel-delay handles)
  // stay unconditional: an early `return null` below must come AFTER them.
  const sendCmd = useCommand("kerbalism.file.send");
  const deleteCmd = useCommand("kerbalism.file.delete");
  const analyzeCmd = useCommand("kerbalism.sample.analyze");
  const dumpCmd = useCommand("kerbalism.sample.dump");
  const moveCmd = useCommand("kerbalism.sample.moveToLab");
  usePanelDelay(sendCmd);
  usePanelDelay(deleteCmd);
  usePanelDelay(analyzeCmd);
  usePanelDelay(dumpCmd);
  usePanelDelay(moveCmd);

  const { file, sample } = findDriveEntries(experiments, subjectId);
  if (!file && !sample) return null;

  // At least one lab part is aboard: the best client-side proxy for "a
  // lab-capable destination exists" (the wire carries no per-drive
  // adjacency; the live handler resolves the actual destination and fails
  // soft if none has room). With no lab aboard at all there is nothing to
  // relocate onto, so the control is disabled rather than dispatched to
  // fail every time.
  const hasLab = (labs?.length ?? 0) > 0;
  const driveExt = file ?? sample;

  return (
    <Section
      style={{ paddingLeft: "var(--space-12)" }}
      aria-label="Kerbalism file manager"
    >
      {file && (
        <Stack gap="xs">
          <Cluster gap="xs" wrap justify="start">
            {file.dataSizeMB !== undefined && (
              <Value size="xs">
                <Unit value={file.dataSizeMB} />
              </Value>
            )}
            {file.transmitRateMBps !== undefined &&
              file.transmitRateMBps.magnitude > 0 && (
                <Value size="xs" tone="muted">
                  <Unit value={file.transmitRateMBps} />
                </Value>
              )}
            {file.transmitting && (
              <Badge
                severity="nominal"
                size="sm"
                role="status"
                aria-live="polite"
              >
                Transmitting
              </Badge>
            )}
          </Cluster>
          <Cluster gap="xs" wrap justify="start">
            <ToggleButton
              size="sm"
              tone="go"
              active={file.sendFlagged === true}
              onClick={() =>
                void sendCmd.send(
                  { subjectId, flag: !file.sendFlagged },
                  { label: file.sendFlagged ? "Cancel send" : "Send" },
                )
              }
              aria-label={
                file.sendFlagged ? "Cancel send for file" : "Send file"
              }
            >
              {file.sendFlagged ? "Queued" : "Send"}
            </ToggleButton>
            <DestructiveButton
              label="Delete"
              armedLabel="Confirm"
              ariaLabel="Delete file"
              confirmAriaLabel="Confirm delete file"
              onConfirm={() =>
                void deleteCmd.send({ subjectId }, { label: "Delete file" })
              }
            />
          </Cluster>
        </Stack>
      )}
      {sample && (
        <Stack gap="xs">
          <Cluster gap="xs" wrap justify="start">
            {sample.sampleMass !== undefined && (
              <Value size="xs">
                <Unit value={sample.sampleMass} />
              </Value>
            )}
          </Cluster>
          <Cluster gap="xs" wrap justify="start">
            <ToggleButton
              size="sm"
              tone="go"
              active={sample.analyze === true}
              onClick={() =>
                void analyzeCmd.send(
                  { subjectId, flag: !sample.analyze },
                  { label: sample.analyze ? "Cancel analyze" : "Analyze" },
                )
              }
              aria-label={
                sample.analyze
                  ? "Cancel analyze for sample"
                  : "Flag sample for analysis"
              }
            >
              {sample.analyze ? "Analyzing" : "Analyze"}
            </ToggleButton>
            <ActionButton
              type="button"
              disabled={!hasLab}
              title={hasLab ? undefined : "No lab part aboard this vessel"}
              onClick={() =>
                void moveCmd.send({ subjectId }, { label: "Move to lab" })
              }
              aria-label={
                hasLab
                  ? "Move sample to lab"
                  : "Move sample to lab (no lab part aboard this vessel)"
              }
            >
              Move to lab
            </ActionButton>
            <DestructiveButton
              label="Dump"
              armedLabel="Confirm"
              ariaLabel="Dump sample"
              confirmAriaLabel="Confirm dump sample"
              onConfirm={() =>
                void dumpCmd.send({ subjectId }, { label: "Dump sample" })
              }
            />
          </Cluster>
        </Stack>
      )}
      {driveExt && <DriveCapacity ext={driveExt} />}
    </Section>
  );
}

registerAugment({
  id: "science-data-aboard-row-file-manager",
  augments: "science-data.aboard-row",
  component: ScienceDataAboardRowAugment,
  requires: "kerbalism",
  owner: KERBALISM,
});

export { DestructiveButton, findDriveEntries, ScienceDataAboardRowAugment };
