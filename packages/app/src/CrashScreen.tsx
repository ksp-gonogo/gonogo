import { logger } from "@ksp-gonogo/logger";
import { Button, Inline, LiveRegion, Stack, Text } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { VERSION } from "./version";

interface CrashScreenProps {
  error: Error;
  /** Reloads the page; defaults to the browser's own reload. */
  onReload?: () => void;
}

/** The text a player pastes into a bug report: what failed, where, on which build, and what the app logged just before. */
export function buildCrashReport(error: Error): string {
  return [
    `Error: ${error.message || String(error)}`,
    `App version: ${VERSION}`,
    `Page: ${globalThis.location.href}`,
    `Time: ${new Date().toISOString()}`,
    "",
    "Stack:",
    error.stack ?? "(none)",
    "",
    "Recent log:",
    logger.exportLogs(),
  ].join("\n");
}

type CopyState = "idle" | "copied" | "refused";

/**
 * What the whole app shows when something throws that nothing else caught: the
 * error's message, a Reload button and a button that copies a report for a bug
 * report. Used as the fallback of the root error boundary.
 */
export function CrashScreen({
  error,
  onReload = () => globalThis.location.reload(),
}: Readonly<CrashScreenProps>) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const [report] = useState(() => buildCrashReport(error));

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopy("copied");
    } catch {
      setCopy("refused");
    }
  }

  return (
    <main style={{ padding: "var(--inset-surface)" }}>
      <Stack gap="section">
        <Text tone="nogo" size="lg" weight="semibold">
          Something went wrong.
        </Text>
        <Text>{error.message || String(error)}</Text>
        <Text level="muted">
          Reloading usually fixes it. If it keeps happening, copy the report and
          send it with your bug report.
        </Text>
        <Inline>
          <Button variant="primary" onClick={onReload}>
            Reload
          </Button>
          <Button onClick={copyReport}>Copy report</Button>
        </Inline>
        <LiveRegion>
          {copy === "copied" && "Report copied."}
          {copy === "refused" &&
            "The browser would not copy it. Select the report below and copy it by hand."}
        </LiveRegion>
        {copy === "refused" && (
          <Stack>
            <label>
              <Text level="muted">Report</Text>
              <textarea
                readOnly
                rows={12}
                style={{ width: "100%" }}
                value={report}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          </Stack>
        )}
      </Stack>
    </main>
  );
}
