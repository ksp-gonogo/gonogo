import type {
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  useLatestValue,
  useStream,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  FormActions,
  Input,
  Panel,
  PanelTitle,
  PrimaryButton,
  Select,
  Spinner,
  Unit,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import type { KosProcessorInfo } from "../__generated__/contract";
import { kosSource } from "../dataSource/kos";
import { isKosScriptError } from "../shared/KosScriptError";
import type { KosData } from "../shared/kos-data-parser";
import { KOS } from "../uplink";
import { parseScriptArgs } from "./args";

interface KosScriptTriggerConfig {
  /**
   * Tagname of the CPU to run on. When set and present in the live
   * `kos.processors` list it pins the target; the in-widget CPU selector is
   * hidden. Left blank, the widget auto-targets the sole CPU or offers a
   * picker when several are present.
   */
  cpuName?: string;
  /** Script path pre-filled into the path field (free-text, e.g. `0:/boot.ks`). */
  scriptPath?: string;
}

/**
 * The outcome of the most recent dispatch. A kOS run rides the telemetry
 * stream like everything else, so the result only arrives after the full
 * round-trip: `running` holds for exactly that long (the widget never fakes
 * an instant result), then resolves to `ok` with the parsed [KOSDATA] fields
 * or `error` with the message. `scriptFault` distinguishes a script-author
 * fault (explicit [KOSERROR] / a kOS runtime exception) from a transport /
 * dispatch error, mirroring `KosDataSource`'s own `KosScriptError` split.
 */
type RunState =
  | { status: "idle" }
  | { status: "running"; cpu: string }
  | { status: "ok"; cpu: string; data: KosData }
  | { status: "error"; cpu: string; message: string; scriptFault: boolean };

/**
 * Resolve which CPU tagname the widget will dispatch to. An explicit
 * in-widget pick wins; then a config-pinned `cpuName` (only if it is
 * actually present in the live list); then, when exactly one runnable CPU
 * exists, that sole CPU. Returns null when the choice is still ambiguous
 * (several CPUs, none picked) or nothing runnable has appeared yet.
 */
export function resolveSelectedTag(
  runnable: readonly KosProcessorInfo[],
  cpuName: string | undefined,
  picked: string | null,
): string | null {
  const tags = runnable
    .map((p) => p.tag)
    .filter((t): t is string => Boolean(t));
  if (picked !== null && tags.includes(picked)) return picked;
  if (cpuName && tags.includes(cpuName)) return cpuName;
  if (tags.length === 1) return tags[0];
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function KosScriptTriggerComponent({
  config,
}: Readonly<ComponentProps<KosScriptTriggerConfig>>) {
  // Only CPUs that carry a tagname are dispatchable: `executeScript` resolves
  // its target by tag, so an untagged CPU has no address to run on.
  const processors = useStream<KosProcessorInfo[]>("kos.processors") ?? [];
  const runnable = useMemo(
    () =>
      processors.filter((p): p is KosProcessorInfo & { tag: string } =>
        Boolean(p.tag),
      ),
    [processors],
  );

  const [pickedTag, setPickedTag] = useState<string | null>(null);
  const selectedTag = resolveSelectedTag(runnable, config?.cpuName, pickedTag);

  const [scriptPath, setScriptPath] = useState(config?.scriptPath ?? "");
  const [argsText, setArgsText] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });

  // Guards against a stale dispatch (an earlier run that resolves after a
  // newer one was started) clobbering the latest result, and against a
  // setState after unmount.
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The one-way signal delay, if the comms model is publishing one. Read via
  // `useLatestValue` (comms.delay is TrueNow command-centre bookkeeping, not a
  // reveal-gated stream): surfaced as a round-trip readout so the operator
  // understands why the result is a wait, not an instant reply.
  const commsDelay = useLatestValue<{ oneWaySeconds: number | null }>(
    "comms.delay",
  );
  const oneWay = commsDelay?.oneWaySeconds ?? null;

  const noCpu = runnable.length === 0;
  const trimmedPath = scriptPath.trim();
  const canRun =
    !noCpu &&
    selectedTag !== null &&
    trimmedPath !== "" &&
    run.status !== "running";

  const pathId = useId();
  const argsId = useId();
  const cpuId = useId();

  const dispatch = () => {
    if (!canRun || selectedTag === null) return;
    const cpu = selectedTag;
    const args = parseScriptArgs(argsText);
    const id = ++runIdRef.current;
    setRun({ status: "running", cpu });
    kosSource.executeScript(cpu, trimmedPath, args).then(
      (data) => {
        if (!mountedRef.current || runIdRef.current !== id) return;
        setRun({ status: "ok", cpu, data });
      },
      (err: unknown) => {
        if (!mountedRef.current || runIdRef.current !== id) return;
        setRun({
          status: "error",
          cpu,
          message: errorMessage(err),
          scriptFault: isKosScriptError(err),
        });
      },
    );
  };

  return (
    <Panel>
      <PanelTitle>kOS SCRIPT TRIGGER</PanelTitle>
      <Body>
        <Field>
          <FieldLabel htmlFor={cpuId}>CPU</FieldLabel>
          {noCpu ? (
            <NoCpuNotice id={cpuId} role="status" aria-live="polite">
              No kOS CPU available. Boot a kOS processor in flight, and check
              the telemetry stream is connected.
            </NoCpuNotice>
          ) : config?.cpuName || runnable.length === 1 ? (
            <StaticCpu id={cpuId}>{selectedTag}</StaticCpu>
          ) : (
            <Select
              id={cpuId}
              value={selectedTag ?? ""}
              onChange={(e) => setPickedTag(e.target.value || null)}
            >
              <option value="" disabled>
                Select a CPU…
              </option>
              {runnable.map((p) => (
                <option key={p.coreId} value={p.tag}>
                  {p.tag}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor={pathId}>Script path</FieldLabel>
          <Input
            id={pathId}
            type="text"
            value={scriptPath}
            onChange={(e) => setScriptPath(e.target.value)}
            placeholder="e.g. 0:/deltav.ks"
          />
          <FieldHint>Path to the kerboscript on the CPU's volume.</FieldHint>
        </Field>

        <Field>
          <FieldLabel htmlFor={argsId}>Arguments</FieldLabel>
          <Input
            id={argsId}
            type="text"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder="e.g. 100 true"
          />
          <FieldHint>
            Optional, space-separated. Numbers and true/false are passed typed,
            anything else as a string.
          </FieldHint>
        </Field>

        <FormActions>
          <PrimaryButton type="button" onClick={dispatch} disabled={!canRun}>
            {run.status === "running" ? "Running…" : "Run"}
          </PrimaryButton>
          {oneWay !== null && oneWay > 0 && (
            <RoundTrip aria-label="Signal round-trip">
              round-trip ~
              <Unit value={value("s", 2 * oneWay)} scale="never" decimals={1} />
            </RoundTrip>
          )}
        </FormActions>

        <ResultRegion role="status" aria-live="polite">
          {run.status === "running" && (
            <Running>
              <Spinner size={14} />
              <span>Running on {run.cpu}, awaiting the round-trip result…</span>
            </Running>
          )}
          {run.status === "ok" && (
            <Result>
              <Badge tone="go">OK</Badge>
              <ResultFields data={run.data} />
            </Result>
          )}
          {run.status === "error" && (
            <Result>
              <Badge tone="nogo">
                {run.scriptFault ? "Script error" : "Dispatch error"}
              </Badge>
              <ErrorText>{run.message}</ErrorText>
            </Result>
          )}
        </ResultRegion>
      </Body>
    </Panel>
  );
}

function ResultFields({ data }: { data: KosData }) {
  const entries = Object.entries(data);
  if (entries.length === 0)
    return <FieldsEmpty>No fields returned.</FieldsEmpty>;
  return (
    <Fields>
      {entries.map(([key, val]) => (
        <FieldRowLine key={key}>
          <FieldKey>{key}</FieldKey>
          <FieldValue>{String(val)}</FieldValue>
        </FieldRowLine>
      ))}
    </Fields>
  );
}

function KosScriptTriggerConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosScriptTriggerConfig>>) {
  const [cpuName, setCpuName] = useState(config?.cpuName ?? "");
  const [scriptPath, setScriptPath] = useState(config?.scriptPath ?? "");

  const candidate = useMemo<KosScriptTriggerConfig>(
    () => ({
      cpuName: cpuName.trim() ? cpuName.trim() : undefined,
      scriptPath: scriptPath.trim() ? scriptPath.trim() : undefined,
    }),
    [cpuName, scriptPath],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="kos-trigger-cpu">Pin to CPU</FieldLabel>
        <Input
          id="kos-trigger-cpu"
          type="text"
          value={cpuName}
          onChange={(e) => setCpuName(e.target.value)}
          placeholder="e.g. lander"
        />
        <FieldHint>
          Tagname of the kOS CPU to run on. Leave blank to auto-target when
          there is one CPU, or pick from the list when there are several.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="kos-trigger-path">Default script path</FieldLabel>
        <Input
          id="kos-trigger-path"
          type="text"
          value={scriptPath}
          onChange={(e) => setScriptPath(e.target.value)}
          placeholder="e.g. 0:/deltav.ks"
        />
        <FieldHint>
          Pre-fills the path field. The operator can still edit it.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

registerComponent<KosScriptTriggerConfig>({
  id: "kos-script-trigger",
  name: "kOS Script Trigger",
  description:
    "Run a kerboscript on a kOS CPU: pick the CPU, path, and args, dispatch over the Uplink, and see the correlated result or error inline.",
  tags: ["kos", "control"],
  defaultSize: { w: 10, h: 9 },
  minSize: { w: 6, h: 7 },
  openConfigOnAdd: false,
  component: KosScriptTriggerComponent,
  configComponent: KosScriptTriggerConfigComponent,
  // The CPU discovery channel this widget picks its target from. Same
  // under-declaration the terminal beside it carried: the app carries
  // `kos.processors` by default so nothing broke, while the declaration a
  // stream-status badge and a render harness both derive from said the widget
  // needed no data at all, and it rendered its no-CPU notice forever.
  dataRequirements: ["kos.processors"],
  defaultConfig: {},
  owner: KOS,
});

export { KosScriptTriggerComponent };

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  min-height: 0;
`;

const NoCpuNotice = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
`;

const StaticCpu = styled.div`
  font-family: monospace;
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
`;

const RoundTrip = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const ResultRegion = styled.div`
  min-height: 0;
`;

const Running = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-8);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
`;

const Result = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
`;

const Fields = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const FieldRowLine = styled.div`
  display: flex;
  gap: var(--space-8);
  font-family: monospace;
  font-size: var(--font-size-sm);
`;

const FieldKey = styled.span`
  color: var(--color-text-muted);
`;

const FieldValue = styled.span`
  color: var(--color-text-primary);
  word-break: break-all;
`;

const FieldsEmpty = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
`;

const ErrorText = styled.div`
  font-family: monospace;
  font-size: var(--font-size-sm);
  color: var(--color-status-nogo-fg);
  word-break: break-word;
`;
