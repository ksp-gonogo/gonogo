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
  Badge,
  Cluster,
  CommandButton,
  Section,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import {
  type KerbalismScienceExperimentExt,
  readKerbalismScienceExperimentExt,
} from "../science";
import { KERBALISM } from "../uplink";

/** The file and/or sample entry a subject holds, joined out of the raw
 *  `science.experiments` array. Either may be absent; a subject that has
 *  been fully transmitted keeps only its sample (and vice versa). */
interface DriveEntries {
  file?: KerbalismScienceExperimentExt;
  sample?: KerbalismScienceExperimentExt;
}

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
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * Joins Kerbalism's drive rows against one Aboard subject. Aboard groups by
 * SUBJECT; the drive itself is per FILE/SAMPLE, so a subject with both still
 * shows as two `science.experiments` entries sharing the same `subjectId`,
 * distinguished by `kind`.
 */
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

/** Per-drive capacity/slots readout: the stock model has no concept of
 *  either, so this is enrichment Kerbalism alone can show. Reads off
 *  whichever entry carries the fields (file and sample on the same subject
 *  normally share one drive, so either suffices). */
function DriveCapacity({ ext }: { ext: KerbalismScienceExperimentExt }) {
  /* `!= null`, not `!== undefined`: the mod writes an unread figure as JSON
     null and the key stays on the wire, so the strict-undefined form let a null
     through and rendered "Drive  / " with two empty readouts. */
  const hasStorage = ext.storageCapacityMB != null && ext.storageUsedMB != null;
  const hasSlots = ext.sampleSlotsTotal != null && ext.sampleSlotsUsed != null;
  if (!hasStorage && !hasSlots) return null;
  return (
    <Text size="xs" tone="muted">
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
    </Text>
  );
}

const UNREAD_FLAG_TITLE =
  "Kerbalism did not report this flag, so its current state is unknown";

/**
 * A reversible flag's three states, and the desired next state to send.
 *
 * `!flag` reads an UNREAD `bool?` as false, so a file whose send flag failed to
 * read got a button labelled "Send" that dispatched `flag: true`: if the file
 * was in fact already queued, the press re-affirmed the queue instead of
 * cancelling it. Both flags come off reflection that returns null on failure
 * (`Drive.GetFileSend`, `Sample.analyze`), so a null is "we could not read it",
 * never "it is off".
 *
 * An unread flag therefore disables the control rather than guessing a
 * direction, on the same terms as `ShipSystems`' `unknown` process state.
 */
function flagState(flag: boolean | null | undefined): {
  read: boolean;
  on: boolean;
  next: boolean;
} {
  if (flag == null) return { read: false, on: false, next: false };
  return { read: true, on: flag, next: !flag };
}

/**
 * The `science-data.aboard-row` augment: Kerbalism's File Manager, one
 * instance per Aboard subject. Joins its own `science.experiments` read
 * against the row's `subjectId` (the base widget hands over identity only,
 * never the drive data itself, matching `crew-status.row-badges`'s pattern),
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
  const send = flagState(file?.sendFlagged);
  const analyze = flagState(sample?.analyze);

  return (
    <Section
      style={{ paddingLeft: "var(--space-12)" }}
      aria-label="Kerbalism file manager"
    >
      {file && (
        <Stack gap="xs">
          <Cluster gap="xs" wrap justify="start">
            {file.dataSizeMB != null && (
              <Text size="xs">
                <Unit value={file.dataSizeMB} />
              </Text>
            )}
            {file.transmitRateMBps?.isPositive() && (
              <Text size="xs" tone="muted">
                <Unit value={file.transmitRateMBps} />
              </Text>
            )}
            {file.transmitting === true && (
              <Badge
                severity="nominal"
                size="sm"
                role="status"
                aria-live="polite"
              >
                Transmitting
              </Badge>
            )}
            {/* Derived from `transmitRate`, so it is null whenever that read
                failed. Drawing nothing there claimed "not transmitting". */}
            {file.transmitting == null && (
              <Badge severity="warning" size="sm">
                Transmit unknown
              </Badge>
            )}
          </Cluster>
          <Cluster gap="xs" wrap justify="start">
            <CommandButton
              size="sm"
              tone="go"
              handle={sendCmd}
              args={{ subjectId, flag: send.next }}
              commandLabel={send.on ? "Cancel send" : "Send"}
              active={send.on}
              disabled={!send.read}
              title={send.read ? undefined : UNREAD_FLAG_TITLE}
              label={send.read ? (send.on ? "Queued" : "Send") : "Unknown"}
              pendingLabel={send.on ? "Cancelling..." : "Queueing..."}
              aria-label={
                send.read
                  ? send.on
                    ? "Cancel send for file"
                    : "Send file"
                  : "Send file (send flag could not be read)"
              }
            />
            <CommandButton
              size="sm"
              handle={deleteCmd}
              args={{ subjectId }}
              commandLabel="Delete file"
              label="Delete"
              confirmLabel="Confirm"
              confirmTone="nogo"
              pendingLabel="Deleting..."
              aria-label="Delete file"
              confirmAriaLabel="Confirm delete file"
            />
          </Cluster>
        </Stack>
      )}
      {sample && (
        <Stack gap="xs">
          <Cluster gap="xs" wrap justify="start">
            {sample.sampleMass != null && (
              <Text size="xs">
                <Unit value={sample.sampleMass} />
              </Text>
            )}
          </Cluster>
          <Cluster gap="xs" wrap justify="start">
            <CommandButton
              size="sm"
              tone="go"
              handle={analyzeCmd}
              args={{ subjectId, flag: analyze.next }}
              commandLabel={analyze.on ? "Cancel analyze" : "Analyze"}
              active={analyze.on}
              disabled={!analyze.read}
              title={analyze.read ? undefined : UNREAD_FLAG_TITLE}
              label={
                analyze.read
                  ? analyze.on
                    ? "Analyzing"
                    : "Analyze"
                  : "Unknown"
              }
              pendingLabel={analyze.on ? "Cancelling..." : "Flagging..."}
              aria-label={
                analyze.read
                  ? analyze.on
                    ? "Cancel analyze for sample"
                    : "Flag sample for analysis"
                  : "Flag sample for analysis (analyze flag could not be read)"
              }
            />
            <CommandButton
              size="sm"
              handle={moveCmd}
              args={{ subjectId }}
              commandLabel="Move to lab"
              label="Move to lab"
              pendingLabel="Moving..."
              disabled={!hasLab}
              title={hasLab ? undefined : "No lab part aboard this vessel"}
              aria-label={
                hasLab
                  ? "Move sample to lab"
                  : "Move sample to lab (no lab part aboard this vessel)"
              }
            />
            <CommandButton
              size="sm"
              handle={dumpCmd}
              args={{ subjectId }}
              commandLabel="Dump sample"
              label="Dump"
              confirmLabel="Confirm"
              confirmTone="nogo"
              pendingLabel="Dumping..."
              aria-label="Dump sample"
              confirmAriaLabel="Confirm dump sample"
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

export { findDriveEntries, ScienceDataAboardRowAugment };
