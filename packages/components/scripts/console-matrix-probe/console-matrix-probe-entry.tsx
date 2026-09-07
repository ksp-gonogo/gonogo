/**
 * Standalone probe for the `Console` composition (`@ksp-gonogo/ui-kit`).
 *
 * `Console` is a ui-kit primitive, not a registered widget, so no widget id
 * covers it and the dashboard probe cannot reach it. This mounts it directly
 * inside a `Panel`, exactly the way the two consoles in the app do, and drives
 * it from a plain-data payload supplied by the `render-console-matrix` driver:
 * every prop the composition takes, one scenario per state.
 *
 * Modelled on `delay-rail-probe/`, same esbuild -> injected HTML -> playwright
 * pipeline, nothing fixture-file-bound.
 */
import {
  ComposerBar,
  Console,
  type ConsoleTone,
  type InFlightListItem,
  Panel,
  ScrollArea,
  Text,
} from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";

/** Which composer a scenario hands the console, if any. */
type ComposerKind = "bar" | "falsy" | "omitted";

interface ConsoleMatrixPayload {
  panelTitle: string;
  tone?: ConsoleTone;
  /** Omitted key means the prop is not passed at all. */
  oneWaySeconds?: number | null;
  canQueue?: boolean;
  alwaysBadge?: boolean;
  /** Omitted key means `inFlight` is not passed at all (`undefined`). */
  inFlight?: InFlightListItem[];
  inFlightFrozenAtDispatch?: boolean;
  composer: ComposerKind;
  /**
   * The composer's own refusal flag, which straddles the LEFT end of the same
   * border the console's standing chip straddles the right end of. Here so a
   * scenario can put both up at once: the terminal reads its refusal and its
   * separation off two topics that reveal on different clocks, so on a link
   * coming back the separation is measurable again before the refusal clears.
   */
  composerFlag?: string;
  /** Lines of prose in the scrollback, so the surface is not blank. */
  lines: string[];
  pxW: number;
  pxH: number;
}

let activeRoot: Root | null = null;

function composerFor(kind: ComposerKind, flag?: string) {
  if (kind === "omitted") return undefined;
  if (kind === "falsy") return false;
  return (
    <ComposerBar
      prompt="❯"
      onSend={() => {}}
      sendVariant="icon"
      {...(flag !== undefined ? { blocked: true, flag } : {})}
    >
      <Text size="xs" tone="faint">
        Type a message
      </Text>
    </ComposerBar>
  );
}

function Harness(payload: ConsoleMatrixPayload) {
  const composer = composerFor(payload.composer, payload.composerFlag);
  return (
    <Panel panelTitle={payload.panelTitle}>
      <Console
        {...(payload.tone !== undefined ? { tone: payload.tone } : {})}
        {...("oneWaySeconds" in payload
          ? { oneWaySeconds: payload.oneWaySeconds }
          : {})}
        {...(payload.canQueue !== undefined
          ? { canQueue: payload.canQueue }
          : {})}
        {...(payload.alwaysBadge !== undefined
          ? { alwaysBadge: payload.alwaysBadge }
          : {})}
        {...("inFlight" in payload ? { inFlight: payload.inFlight } : {})}
        {...(payload.inFlightFrozenAtDispatch !== undefined
          ? { inFlightFrozenAtDispatch: payload.inFlightFrozenAtDispatch }
          : {})}
        {...(composer !== undefined ? { composer } : {})}
      >
        <ScrollArea>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-6)",
              padding: "var(--space-8)",
            }}
          >
            {payload.lines.map((line) => (
              <Text key={line} size="sm">
                {line}
              </Text>
            ))}
          </div>
        </ScrollArea>
      </Console>
    </Panel>
  );
}

async function renderConsoleMatrix(
  payload: ConsoleMatrixPayload,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Console matrix probe: #root missing");
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  root.style.width = `${payload.pxW}px`;
  root.style.height = `${payload.pxH}px`;
  root.style.display = "flex";
  root.innerHTML = "";
  activeRoot = createRoot(root);
  activeRoot.render(<Harness {...payload} />);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => setTimeout(r, 300));
}

declare global {
  interface Window {
    __renderConsoleMatrix: (payload: ConsoleMatrixPayload) => Promise<void>;
  }
}

window.__renderConsoleMatrix = renderConsoleMatrix;

export type { ConsoleMatrixPayload };
