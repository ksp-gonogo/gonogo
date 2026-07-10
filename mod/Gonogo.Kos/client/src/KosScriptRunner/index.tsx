import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  getKosScripts,
  registerComponent,
  useActionInput,
} from "@ksp-gonogo/core";
import { type KosWidgetArg, useKosWidget } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  ScrollArea,
  Textarea,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { useCallback, useMemo, useState } from "react";
import styled from "styled-components";
import { KosCpuPicker } from "../shared/KosCpuPicker";
import { KosScriptFrame } from "../shared/KosScriptFrame";

/**
 * kOS Script Runner — helper layer 2 over the raw kOS terminal (P3 spec
 * §"Helper layer 2"). For far / unmanned craft you skip the terminal
 * entirely: pick a target CPU + a saved kerboscript path, and fire a single
 * delayed RUNPATH (`kos.exec`) rather than typing `RUNPATH(...)` interactively
 * under light-time delay. Run state (in-flight / error / last-good) surfaces
 * through the shared `KosScriptFrame` chrome.
 *
 * Uses the command-mode `useKosWidget` path — i.e. the data source's
 * `executeScript` RPC, which IS the client-side `kos.exec` / RUNPATH path
 * (KosFiles rides the same seam). This is the sanctioned RPC one-shot case
 * (per CLAUDE.md "raw executeScript" guidance), not a passive compute feed,
 * so dispatching directly is correct here.
 */

interface KosScriptRunnerConfig {
  /** kOS CPU tagname this widget dispatches the RUNPATH against. */
  cpu?: string;
  /** Path of the saved kerboscript to RUNPATH, e.g. "0:/deploy.ks". */
  scriptName?: string;
  /**
   * Optional positional args, one per line. Passed to the script's
   * `PARAMETER` list as strings (kerboscript coerces numerics as needed).
   */
  argsText?: string;
}

const kosScriptRunnerActions = [
  {
    id: "run",
    label: "Run script",
    accepts: ["button"],
    description: "Dispatch the configured RUNPATH to the target CPU.",
  },
  {
    id: "reEnable",
    label: "Re-enable",
    accepts: ["button"],
    description: "Clear a tripped error state and allow dispatching again.",
  },
] as const satisfies readonly ActionDefinition[];

export type KosScriptRunnerActions = typeof kosScriptRunnerActions;

/** Split the newline-delimited args field into trimmed, non-empty lines. */
function parseArgs(argsText: string | undefined): KosWidgetArg[] {
  if (!argsText) return [];
  return argsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((value) => ({ type: "string" as const, value }));
}

function KosScriptRunnerComponent({
  config,
}: Readonly<ComponentProps<KosScriptRunnerConfig>>) {
  const cpu = config?.cpu ?? "";
  const scriptName = config?.scriptName ?? "";
  const args = useMemo(() => parseArgs(config?.argsText), [config?.argsText]);

  const notConfigured = !cpu || !scriptName;

  const {
    data,
    error,
    running,
    lastGoodAt,
    dispatch,
    disabled,
    disabledReason,
    reEnable,
  } = useKosWidget({
    cpu,
    script: scriptName,
    args,
    mode: "command",
  });

  const run = useCallback(() => {
    if (notConfigured) return;
    logger.info("kos-script-runner: dispatch", {
      cpu,
      script: scriptName,
      argc: args.length,
    });
    dispatch();
  }, [notConfigured, cpu, scriptName, args.length, dispatch]);

  useActionInput<KosScriptRunnerActions>({
    run: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      run();
      return { Script: scriptName || "—" };
    },
    reEnable: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      reEnable();
      return undefined;
    },
  });

  return (
    <KosScriptFrame
      title={cpu ? `Run · ${cpu}` : "Run script"}
      running={running}
      scriptError={error}
      parseError={null}
      lastGoodAt={lastGoodAt}
      onRun={run}
      runDisabled={running || notConfigured}
      paused={disabled}
      pausedReason={disabledReason}
      onReEnable={reEnable}
    >
      {renderBody()}
    </KosScriptFrame>
  );

  function renderBody() {
    if (notConfigured) {
      return (
        <Placeholder>
          Set a target CPU and a script path in the widget&apos;s config to
          start.
        </Placeholder>
      );
    }
    return (
      <Body>
        <SummaryRow>
          <SummaryLabel>Script</SummaryLabel>
          <SummaryValue>{scriptName}</SummaryValue>
        </SummaryRow>
        {args.length > 0 && (
          <SummaryRow>
            <SummaryLabel>Args</SummaryLabel>
            <SummaryValue>
              {args.map((a) => (a.type === "string" ? a.value : "")).join(", ")}
            </SummaryValue>
          </SummaryRow>
        )}
        <StatusLine>
          {running
            ? "Dispatching…"
            : lastGoodAt
              ? "Last run acknowledged."
              : "Press Run to dispatch."}
        </StatusLine>
        {data && Object.keys(data).length > 0 && (
          <ResultScroll>
            <ResultPre>{JSON.stringify(data, null, 2)}</ResultPre>
          </ResultScroll>
        )}
      </Body>
    );
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

function KosScriptRunnerConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosScriptRunnerConfig>>) {
  const [cpu, setCpu] = useState(config?.cpu ?? "");
  const [scriptName, setScriptName] = useState(config?.scriptName ?? "");
  const [argsText, setArgsText] = useState(config?.argsText ?? "");

  // Registered kerboscripts are a convenience quick-pick: clicking one fills
  // the script-path field with the conventional managed on-volume path. The
  // path stays editable — this widget fires whatever path is entered.
  const registered = useMemo(() => getKosScripts(), []);

  const candidate = useMemo<KosScriptRunnerConfig>(
    () => ({ cpu, scriptName, argsText }),
    [cpu, scriptName, argsText],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="kos-script-runner-cpu">kOS CPU</FieldLabel>
        <KosCpuPicker
          id="kos-script-runner-cpu"
          value={cpu}
          onChange={setCpu}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="kos-script-runner-script">Script path</FieldLabel>
        <Input
          id="kos-script-runner-script"
          type="text"
          value={scriptName}
          onChange={(e) => setScriptName(e.target.value)}
          placeholder="0:/deploy.ks"
        />
        <FieldHint>
          Path to the saved kerboscript on the target CPU&apos;s volume. The
          widget dispatches <code>RUNPATH(&lt;path&gt;, …args)</code>.
        </FieldHint>
        {registered.length > 0 && (
          <QuickPick>
            <QuickPickLabel>Registered scripts:</QuickPickLabel>
            {registered.map((s) => (
              <GhostButton
                key={s.id}
                type="button"
                onClick={() => setScriptName(`0:/widget_scripts/${s.id}.ks`)}
              >
                {s.name}
              </GhostButton>
            ))}
          </QuickPick>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="kos-script-runner-args">
          Arguments (optional)
        </FieldLabel>
        <Textarea
          id="kos-script-runner-args"
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder={"one arg per line"}
          rows={3}
        />
        <FieldHint>
          One positional argument per line, passed to the script&apos;s{" "}
          <code>PARAMETER</code> list as strings.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Placeholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: 11px;
  padding: 12px;
  text-align: center;
  code {
    background: var(--color-surface-raised);
    padding: 1px 4px;
    border-radius: 2px;
    color: var(--color-status-go-fg);
  }
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  flex: 1;
  min-height: 0;
`;

const SummaryRow = styled.div`
  display: flex;
  gap: 8px;
  font-size: 12px;
`;

const SummaryLabel = styled.span`
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: var(--font-size-xs);
  flex: 0 0 44px;
`;

const SummaryValue = styled.span`
  color: var(--color-status-go-fg);
  word-break: break-all;
  min-width: 0;
`;

const StatusLine = styled.div`
  font-size: 11px;
  color: var(--color-text-muted);
`;

const ResultScroll = styled(ScrollArea)`
  flex: 1;
  min-height: 0;
  background: var(--color-surface-app);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
`;

const ResultPre = styled.pre`
  margin: 0;
  padding: 8px 10px;
  color: var(--color-status-go-fg);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
`;

const QuickPick = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
`;

const QuickPickLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<KosScriptRunnerConfig>({
  id: "kos-script-runner",
  name: "kOS Script Runner",
  description:
    "Fire a saved kerboscript on a chosen kOS CPU without opening the terminal — pick a target CPU and script path, then dispatch a single RUNPATH. Built for far / unmanned craft under light-time delay, where typing RUNPATH interactively costs a round-trip per keystroke.",
  tags: ["kos", "control"],
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 4, h: 4 },
  component: KosScriptRunnerComponent,
  configComponent: KosScriptRunnerConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: [],
  defaultConfig: {
    cpu: "",
    scriptName: "",
    argsText: "",
  },
  actions: kosScriptRunnerActions,
  pushable: true,
});

export { KosScriptRunnerComponent };
