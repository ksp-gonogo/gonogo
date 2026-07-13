/**
 * FakeKosUplink — a fake `kos.run` Uplink responder, the `kos.run`-era
 * counterpart to `MockKosTelnet.ts`. `KosDataSource.executeScript` no
 * longer talks to telnet at all (see `kosUplinkExecutor.ts`); this fixture
 * lets the existing `executeScript`/`useKosWidget` integration coverage
 * keep exercising the REAL dispatch → correlate → resolve pipeline, just
 * over a real `StubTransport` + `TelemetryClient` instead of a fake
 * WebSocket telnet session.
 *
 * Usage:
 *   const fake = FakeKosUplink.install();
 *   fake.setCpus([{ number: 1, tagname: "datastream" }]);
 *   fake.registerScript("0:/widget_scripts/deltav.ks", (inv) => `[KOSDATA] dv=${inv.args[0]} [/KOSDATA]`);
 *   // ... run code under test that calls KosDataSource.executeScript ...
 *   FakeKosUplink.uninstall();
 *
 * What it handles:
 *   - `kos.processors` — publishes the coreId/tag list `setCpus()` is given.
 *     Subscribed eagerly on construction (a dummy listener) so it stays
 *     "carried": `KosUplinkExecutor`'s own lazy subscribe then replays the
 *     current list SYNCHRONOUSLY instead of racing an empty cache — this
 *     mirrors the real app, where something (e.g. the KosProcessors widget)
 *     already has `kos.processors` flowing before a user triggers a script.
 *   - `kos.run` command dispatch — parses the LAST non-blank line of the
 *     dispatched command text (works for both the bare `RUNPATH(...)` form
 *     and the multi-line managed-wrapper form, which always ends with the
 *     same RUNPATH line) via the same regex/arg-splitter `MockKosTelnet`
 *     uses, looks up the registered handler by path, and converts its
 *     string return value into a `KosRunResult` the same way the mod does:
 *     an explicit `[KOSERROR]...[/KOSERROR]` wins over `[KOSDATA]` if both are
 *     present; otherwise `parseKosData` produces `fields`.
 *
 * What it deliberately does NOT handle:
 *   - kOS's raw REPL error-dump format (`At interpreter`, `Message:`,
 *     `VERBOSE DESCRIPTION`, ...) — that parsing (`kosComputeSession.ts`'s
 *     `parseKosError`) is telnet-REPL-text-specific and, since executeScript
 *     no longer talks to telnet, is unreachable production code. The mod
 *     does its own equivalent extraction server-side and hands back an
 *     already-clean message, which is what registered script handlers
 *     should return directly for an implicit/runtime error.
 */

import { parseKosData } from "@ksp-gonogo/data";
import {
  StubTransport,
  setActiveTelemetryClientForTests,
  TelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import type {
  CommandResult,
  KosProcessorInfo,
  KosRunResult,
} from "@ksp-gonogo/sitrep-sdk";

export interface FakeKosCpu {
  /** Used as the coreId on the kos.processors wire shape. */
  number: number;
  tagname: string;
}

export interface FakeKosInvocation {
  script: string;
  args: string[];
  cpu: { tagname: string };
}

export type FakeKosScriptHandler = (
  invocation: FakeKosInvocation,
) => string | Promise<string>;

// Same shape MockKosTelnetSocket matches — the wrapper's final line and a
// bare RUNPATH dispatch are textually identical.
const RUNPATH_RE = /^RUNPATH\s*\(\s*"([^"]+)"\s*(?:,\s*(.*?))?\s*\)\s*\.\s*$/i;

export class FakeKosUplink {
  private static active: FakeKosUplink | null = null;

  static install(): FakeKosUplink {
    if (FakeKosUplink.active) {
      throw new Error(
        "FakeKosUplink is already installed. Call uninstall() first.",
      );
    }
    const instance = new FakeKosUplink();
    FakeKosUplink.active = instance;
    return instance;
  }

  static uninstall(): void {
    setActiveTelemetryClientForTests(undefined);
    FakeKosUplink.active = null;
  }

  readonly transport = new StubTransport();
  readonly client = new TelemetryClient(this.transport);

  private cpuTagByCoreId = new Map<number, string>();
  private readonly scripts = new Map<string, FakeKosScriptHandler>();
  private readonly invocationLog: FakeKosInvocation[] = [];

  private constructor() {
    // Dummy always-on subscriber — see the class doc comment above.
    this.client.subscribe("kos.processors", () => {});
    this.transport.setCommandHandler((command, args) =>
      this.handleCommand(command, args),
    );
    setActiveTelemetryClientForTests(this.client);
    this.setCpus([{ number: 1, tagname: "datastream" }]);
  }

  setCpus(cpus: FakeKosCpu[]): void {
    this.cpuTagByCoreId = new Map(cpus.map((c) => [c.number, c.tagname]));
    this.transport.emit(
      "kos.processors",
      cpus.map(
        (c): KosProcessorInfo => ({
          coreId: c.number,
          tag: c.tagname,
          hasBooted: true,
          processorMode: "READY",
        }),
      ),
    );
  }

  registerScript(path: string, handler: FakeKosScriptHandler): void {
    this.scripts.set(path, handler);
  }

  /** Invocations seen across all dispatches, in order. */
  invocations(): FakeKosInvocation[] {
    return [...this.invocationLog];
  }

  private handleCommand(command: string, rawArgs: unknown): CommandResult {
    if (command !== "kos.run") return { success: true, errorCode: 0 };
    const {
      coreId,
      requestId,
      command: text,
    } = rawArgs as {
      coreId: number;
      requestId: string;
      command: string;
    };
    const lines = text
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const last = lines[lines.length - 1] ?? "";
    const match = RUNPATH_RE.exec(last);
    if (!match) {
      this.respond(coreId, requestId, {
        error: `FakeKosUplink: could not parse a RUNPATH call from: ${last}`,
      });
      return { success: true, errorCode: 0 };
    }
    const [, path, argText] = match;
    const invocation: FakeKosInvocation = {
      script: path,
      args: splitArgs(argText ?? ""),
      cpu: { tagname: this.cpuTagByCoreId.get(coreId) ?? "" },
    };
    this.invocationLog.push(invocation);

    const handler = this.scripts.get(path);
    if (!handler) {
      this.respond(coreId, requestId, {
        error: `Cannot open file '${path}'.`,
      });
      return { success: true, errorCode: 0 };
    }
    void Promise.resolve(handler(invocation)).then((output) => {
      this.respond(coreId, requestId, outputToResult(output));
    });
    return { success: true, errorCode: 0 };
  }

  private respond(
    coreId: number,
    requestId: string,
    partial: Pick<KosRunResult, "fields" | "error">,
  ): void {
    this.transport.emit(`kos.run.${coreId}`, {
      coreId,
      requestId,
      ...partial,
    } satisfies KosRunResult);
  }
}

function outputToResult(
  output: string,
): Pick<KosRunResult, "fields" | "error"> {
  const explicit = /\[KOSERROR\]([\s\S]*?)\[\/KOSERROR\]/.exec(output);
  if (explicit) return { error: explicit[1].trim() };
  const fields = parseKosData(output);
  if (fields) return { fields };
  return { error: output.trim() };
}

// Splits `a, "b, c", 3` into ["a", '"b, c"', "3"]. Copied from
// MockKosTelnet.ts (not exported there) — the production data source
// builds these with its own escaping, so a fixture just has to round-trip
// what it sent.
function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (const ch of raw) {
    if (ch === '"' && depth === 0) inString = !inString;
    if (!inString) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
    }
    if (ch === "," && depth === 0 && !inString) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "" || out.length > 0) out.push(current.trim());
  return out;
}
