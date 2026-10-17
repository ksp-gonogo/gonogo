import { logger } from "@ksp-gonogo/logger";
import { useCommand, useStream } from "@ksp-gonogo/sitrep-client";
import {
  Button,
  Field,
  FieldHint,
  FieldLabel,
  FormActions,
  Switch,
  Textarea,
} from "@ksp-gonogo/ui";
import { LiveRegion, Stack } from "@ksp-gonogo/ui-kit";
import { useId, useState, useSyncExternalStore } from "react";
import { usePeerClient } from "../peer/PeerClientContext";
import {
  getSitrepHello,
  subscribeSitrepHello,
} from "../telemetry/sitrepRuntime";
import { VERSION } from "../version";
import {
  buildIssueLink,
  type LogSection,
  logLines,
  redactLogLine,
} from "./githubIssue";

const MOD_LOG_LINES = 200;
const MOD_LOG_WAIT_MS = 4000;

interface SystemUplinksReading {
  coreVersion?: string | null;
  uplinks?: Array<{ id: string; version: string; available: boolean }>;
}

/** What the bug report form asks that this screen already knows. */
function useReportEnvironment() {
  const reading = useStream<SystemUplinksReading>("system.uplinks");
  const hello = useSyncExternalStore(subscribeSitrepHello, getSitrepHello);
  const client = usePeerClient();
  const arrived = reading.state === "observed" || reading.state === "held";
  const value = arrived ? reading.value : undefined;
  return {
    modVersion: hello?.modVersion ?? value?.coreVersion ?? null,
    uplinks: (value?.uplinks ?? [])
      .filter((u) => u.available)
      .map((u) => `${u.id} ${u.version}`),
    screen: client ? ("Station" as const) : ("Main screen" as const),
  };
}

/**
 * Opens GitHub's bug report form with the versions, installed Uplinks, screen
 * and the operator's description already filled in, and the app's recent log in
 * a collapsed section when asked. Used by the log settings beside the form that
 * sends feedback to the log store.
 */
export function GithubIssueForm({
  onCancel,
}: Readonly<{ onCancel: () => void }>) {
  const env = useReportEnvironment();
  const [description, setDescription] = useState("");
  const [includeKspLog, setIncludeKspLog] = useState(true);
  const [includeLog, setIncludeLog] = useState(true);
  const recentLog = useCommand("system.log.recent", { rail: false });
  const [notice, setNotice] = useState<string | null>(null);
  const descriptionId = useId();

  /** The mod's recent lines, or none when the mod is not connected or does not answer in time. */
  async function modLogLines(): Promise<string[]> {
    const timeout = new Promise<null>((resolve) =>
      window.setTimeout(() => resolve(null), MOD_LOG_WAIT_MS),
    );
    const reply = await Promise.race([
      recentLog.send({ maxLines: MOD_LOG_LINES }).catch(() => null),
      timeout,
    ]);
    const lines = reply?.success ? (reply.payload?.lines ?? []) : [];
    return lines.map(redactLogLine);
  }

  async function open() {
    const sections: LogSection[] = [];
    if (includeKspLog) {
      const lines = await modLogLines();
      sections.push({ title: "KSP.log, Gonogo lines", lines });
    }
    if (includeLog) {
      sections.push({
        title: "App log",
        lines: logLines(logger.getBuffer()),
      });
    }
    const link = buildIssueLink(
      {
        description: description.trim(),
        modVersion: env.modVersion,
        appVersion: VERSION,
        uplinks: env.uplinks,
        screen: env.screen,
      },
      sections,
    );
    let message: string | null = null;
    if (link.clipboard !== null) {
      const copied = await navigator.clipboard
        ?.writeText(link.clipboard)
        .then(() => true)
        .catch(() => false);
      const where = link.log === "none" ? "was too long to fit" : "was trimmed";
      message = copied
        ? `The log ${where} for the link, so the whole log is copied. Paste it into the Logs box on GitHub.`
        : `The log ${where} for the link and could not be copied. Download it from Log buffer above and attach it.`;
    }
    window.open(link.url, "_blank", "noopener,noreferrer");
    setNotice(message);
  }

  return (
    <Stack gap="related-comfortable">
      <Field>
        <FieldLabel htmlFor={descriptionId}>What went wrong?</FieldLabel>
        <Textarea
          id={descriptionId}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What were you doing? What happened?"
        />
        <FieldHint>
          You finish the report on GitHub, where you can add steps and what you
          expected.
        </FieldHint>
      </Field>
      <Switch
        checked={includeKspLog}
        onChange={() => setIncludeKspLog((v) => !v)}
        label="Include KSP.log"
      />
      <Switch
        checked={includeLog}
        onChange={() => setIncludeLog((v) => !v)}
        label="Include the app log"
      />
      <FieldHint>
        <LiveRegion>{notice}</LiveRegion>
      </FieldHint>
      <FormActions>
        <Button type="button" onClick={() => void open()}>
          Open GitHub issue
        </Button>
        <Button type="button" onClick={onCancel}>
          Close
        </Button>
      </FormActions>
    </Stack>
  );
}
