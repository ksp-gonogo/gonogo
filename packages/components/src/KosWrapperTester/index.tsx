import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { logger, registerComponent } from "@gonogo/core";
import { hashKosScript, useKosWidget } from "@gonogo/data";
import {
  CheckIcon,
  CloseIcon,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  Panel,
  PanelTitle,
  PrimaryButton,
  ScrollArea,
} from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { KosCpuPicker } from "../kos/KosCpuPicker";

interface KosWrapperTesterConfig {
  /** kOS CPU tagname. Required — widget stays in an empty state until set. */
  cpu?: string;
  /** Where the wrapper writes its generated test script on the kOS volume. */
  scriptPath?: string;
}

const DEFAULT_SCRIPT_PATH = "0:/widget_scripts/wrapper_test.ks";

interface Attempt {
  at: number;
  expected: number;
  observed: number | null;
  versionSent: string;
  durationMs: number | null;
  error: string | null;
}

/**
 * Generate a fresh kerboscript whose body embeds `value` as a literal —
 * so changing the random seed changes the body text, which changes the
 * hash, which forces the wrapper to rewrite the on-volume `.ks`.
 *
 * The script emits `[KOSDATA]value=<n>[/KOSDATA]`. Round-tripping the
 * generated `value` through RUNPATH proves the wrapper wrote the *new*
 * body and not a stale one.
 */
function buildTestScript(value: number): string {
  return [
    `// gonogo wrapper-tester payload — value=${value}`,
    `LOCAL value IS ${value}.`,
    `PRINT "[KOSDATA]value=" + value + "[/KOSDATA]".`,
    "",
  ].join("\n");
}

function randomValue(): number {
  // 6-digit positive int — small enough to read at a glance, big enough
  // that two consecutive presses are essentially never the same value.
  return Math.floor(Math.random() * 900_000) + 100_000;
}

function KosWrapperTesterComponent({
  config,
}: Readonly<ComponentProps<KosWrapperTesterConfig>>) {
  const cpu = config?.cpu ?? "";
  const scriptPath = config?.scriptPath ?? DEFAULT_SCRIPT_PATH;

  const [seed, setSeed] = useState<number>(() => randomValue());
  const [history, setHistory] = useState<Attempt[]>([]);
  const dispatchStartRef = useRef<number | null>(null);

  const body = useMemo(() => buildTestScript(seed), [seed]);
  const version = useMemo(() => hashKosScript(body), [body]);

  const { data, error, running, lastGoodAt, dispatch } = useKosWidget({
    cpu,
    script: scriptPath,
    args: [],
    mode: "command",
    managed: { body, version },
  });

  // Record completed attempts. We log when either `data` or `error`
  // changes after a dispatch — both end the in-flight call.
  const lastSeenAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastGoodAt !== null && lastGoodAt !== lastSeenAtRef.current) {
      lastSeenAtRef.current = lastGoodAt;
      const observed =
        typeof data?.value === "number" ? (data.value as number) : null;
      const startedAt = dispatchStartRef.current;
      const duration = startedAt !== null ? lastGoodAt - startedAt : null;
      dispatchStartRef.current = null;
      logger.info("kos-wrapper-tester: dispatch returned", {
        expected: seed,
        observed,
        match: observed === seed,
        durationMs: duration,
      });
      setHistory((h) =>
        [
          {
            at: lastGoodAt,
            expected: seed,
            observed,
            versionSent: version,
            durationMs: duration,
            error: null,
          },
          ...h,
        ].slice(0, 8),
      );
    }
  }, [lastGoodAt, data, seed, version]);

  const lastErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      lastErrorRef.current = error;
      const startedAt = dispatchStartRef.current;
      const duration = startedAt !== null ? Date.now() - startedAt : null;
      dispatchStartRef.current = null;
      setHistory((h) =>
        [
          {
            at: Date.now(),
            expected: seed,
            observed: null,
            versionSent: version,
            durationMs: duration,
            error: error.message,
          },
          ...h,
        ].slice(0, 8),
      );
    }
  }, [error, seed, version]);

  // Setting a flag here and dispatching from a useEffect tied to `seed` so
  // the wrapper sends the FRESH body/version. queueMicrotask fires before
  // React's render commit, which means useKosWidget's managedRef still
  // points at the previous render's body+version — the wrapper would see
  // matching hashes and skip the rewrite, RUNing the old file.
  const regenPendingRef = useRef(false);
  const onRegenAndRun = () => {
    regenPendingRef.current = true;
    setSeed(randomValue());
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `seed` is the trigger; dispatch reads the fresh body/version via useKosWidget's refs once render has committed
  useEffect(() => {
    if (!regenPendingRef.current) return;
    regenPendingRef.current = false;
    dispatchStartRef.current = Date.now();
    dispatch();
  }, [seed, dispatch]);

  const onRunAgain = () => {
    dispatchStartRef.current = Date.now();
    dispatch();
  };

  const latest = history[0] ?? null;
  const matchClass: "match" | "miss" | "pending" = latest
    ? latest.error
      ? "miss"
      : latest.observed === latest.expected
        ? "match"
        : "miss"
    : "pending";

  return (
    <Panel>
      <PanelTitle>WRAPPER TESTER</PanelTitle>
      {!cpu ? (
        <Hint>
          Set a CPU tagname in the widget config to start exercising the
          wrapper.
        </Hint>
      ) : (
        <>
          <Row>
            <PrimaryButton onClick={onRegenAndRun} disabled={running}>
              Regenerate &amp; run
            </PrimaryButton>
            <GhostButton onClick={onRunAgain} disabled={running}>
              Run again (no regen)
            </GhostButton>
            {running && <RunStatus>dispatching…</RunStatus>}
          </Row>

          <Meta>
            <MetaRow>
              <MetaLabel>Path</MetaLabel>
              <MetaValue>
                <code>{scriptPath}</code>
              </MetaValue>
            </MetaRow>
            <MetaRow>
              <MetaLabel>Seed</MetaLabel>
              <MetaValue>{seed}</MetaValue>
            </MetaRow>
            <MetaRow>
              <MetaLabel>Version</MetaLabel>
              <MetaValue>
                <code>{version}</code>
              </MetaValue>
            </MetaRow>
          </Meta>

          <LatestBox $tone={matchClass}>
            <LatestLabel>Latest</LatestLabel>
            {latest === null ? (
              <Hint>No dispatch yet.</Hint>
            ) : latest.error ? (
              <ErrorText>{latest.error}</ErrorText>
            ) : (
              <LatestRow>
                <span>
                  expected <strong>{latest.expected}</strong>, got{" "}
                  <strong>{latest.observed ?? "—"}</strong>
                </span>
                <span>
                  {latest.observed === latest.expected ? "match" : "MISMATCH"}
                  {latest.durationMs !== null
                    ? ` · ${latest.durationMs} ms`
                    : ""}
                </span>
              </LatestRow>
            )}
          </LatestBox>

          {history.length > 1 && (
            <HistoryBox>
              <HistoryLabel>Recent</HistoryLabel>
              <HistoryList>
                {history.slice(1).map((h) => (
                  <HistoryItem key={`${h.at}-${h.versionSent}`}>
                    <HistoryWhen>
                      {new Date(h.at).toLocaleTimeString()}
                    </HistoryWhen>
                    {h.error ? (
                      <ErrorText>err: {h.error}</ErrorText>
                    ) : (
                      <span>
                        v=<code>{h.versionSent}</code> · {h.expected} →{" "}
                        {h.observed ?? "—"}
                        {h.observed === h.expected ? (
                          <CheckIcon
                            size={11}
                            strokeWidth={2.5}
                            style={{ marginLeft: 3 }}
                          />
                        ) : (
                          <CloseIcon
                            size={11}
                            strokeWidth={2.5}
                            style={{ marginLeft: 3 }}
                          />
                        )}
                      </span>
                    )}
                  </HistoryItem>
                ))}
              </HistoryList>
            </HistoryBox>
          )}

          <ScriptBox>
            <ScriptLabel>Generated body</ScriptLabel>
            <pre>{body}</pre>
          </ScriptBox>
        </>
      )}
    </Panel>
  );
}

function KosWrapperTesterConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosWrapperTesterConfig>>) {
  const [cpu, setCpu] = useState(config?.cpu ?? "");
  const [scriptPath, setScriptPath] = useState(
    config?.scriptPath ?? DEFAULT_SCRIPT_PATH,
  );
  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="wrapper-tester-cpu">kOS CPU</FieldLabel>
        <KosCpuPicker id="wrapper-tester-cpu" value={cpu} onChange={setCpu} />
        <FieldHint>
          The kOS CPU to dispatch against. Pick from the registry or add a new
          entry.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="wrapper-tester-path">Script path</FieldLabel>
        <Input
          id="wrapper-tester-path"
          value={scriptPath}
          onChange={(e) => setScriptPath(e.target.value)}
        />
        <FieldHint>
          Where the wrapper writes the generated test script. Stored alongside a{" "}
          <code>.ver</code> sidecar for change detection.
        </FieldHint>
      </Field>
      <FormActions>
        <PrimaryButton onClick={() => onSave({ cpu, scriptPath })}>
          Save
        </PrimaryButton>
      </FormActions>
    </ConfigForm>
  );
}

const FormActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;

const Hint = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: 8px 0;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const RunStatus = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-style: italic;
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
  font-size: var(--font-size-xs);
`;

const MetaRow = styled.div`
  display: flex;
  gap: 8px;
`;

const MetaLabel = styled.span`
  color: var(--color-text-muted);
  min-width: 60px;
`;

const MetaValue = styled.span`
  color: var(--color-text-primary);
  font-family: var(--font-mono, monospace);
`;

const LatestBox = styled.div<{ $tone: "match" | "miss" | "pending" }>`
  margin-top: 10px;
  padding: 8px;
  border-radius: 3px;
  border: 1px solid
    ${(p) =>
      p.$tone === "match"
        ? "var(--color-status-go-bg)"
        : p.$tone === "miss"
          ? "var(--color-status-nogo-bg)"
          : "var(--color-border-subtle)"};
  background: var(--color-surface-sunken);
`;

const LatestLabel = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 4px;
`;

const LatestRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--font-size-sm);
`;

const ErrorText = styled.div`
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  font-family: var(--font-mono, monospace);
`;

const HistoryBox = styled.div`
  margin-top: 10px;
`;

const HistoryLabel = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 4px;
`;

const HistoryList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const HistoryItem = styled.li`
  display: flex;
  gap: 8px;
  font-size: var(--font-size-xs);
  font-family: var(--font-mono, monospace);
  color: var(--color-text-secondary);
`;

const HistoryWhen = styled.span`
  color: var(--color-text-muted);
  min-width: 64px;
`;

const ScriptBox = styled(ScrollArea)`
  margin-top: 10px;
  max-height: 180px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  font-size: 11px;
  pre {
    margin: 0;
    padding: 6px 8px;
    white-space: pre;
  }
`;

const ScriptLabel = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 4px;
`;

registerComponent<KosWrapperTesterConfig>({
  id: "kos-wrapper-tester",
  name: "kOS Wrapper Tester",
  description:
    "Dev-only widget that exercises the kOS managed-script wrapper end-to-end. Generates a kerboscript with a fresh random literal each press, dispatches it via the wrapper (which auto-syncs the file on the kOS volume), and verifies the round-trip value matches what was sent. A match proves the wrapper wrote and ran the freshly-generated body; a mismatch points at a stale on-volume copy.",
  tags: ["debug", "kos"],
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 5, h: 6 },
  component: KosWrapperTesterComponent,
  configComponent: KosWrapperTesterConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: [],
  defaultConfig: {
    cpu: "",
    scriptPath: DEFAULT_SCRIPT_PATH,
  },
  actions: [],
  pushable: true,
});

export { KosWrapperTesterComponent };
