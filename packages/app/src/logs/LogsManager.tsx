import { getAppVersion, useDataSources, useStreamSources } from "@gonogo/core";
import { logger, tagRegistry } from "@gonogo/logger";
import {
  Button,
  Field,
  FieldHint,
  FieldLabel,
  FormActions,
  Select,
  Switch,
  Textarea,
} from "@gonogo/ui";
import {
  type ChangeEvent,
  type FormEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { downloadLogs } from "./downloadLogs";
import { recentLogsWindow } from "./recentLogsWindow";
import {
  type EncodedScreenshot,
  encodeScreenshot,
  SCREENSHOT_WARN_BYTES,
  ScreenshotTooLargeError,
} from "./screenshotEncoder";

const LOG_TAGS_KEY = "LOG_TAGS";

/**
 * Tags seeded in the UI. Any `logger.tag(...)` call outside this list still
 * works, this is just the curated on/off set shown in the modal. Add a new
 * tag here whenever you start logging under a fresh subsystem name.
 */
const KNOWN_TAGS: Array<{ id: string; label: string; hint: string }> = [
  { id: "peer", label: "peer", hint: "PeerJS connect / disconnect / errors" },
  {
    id: "peer:broadcast",
    label: "peer:broadcast",
    hint: "Per-sample broadcast traffic (noisy)",
  },
  {
    id: "peer:kos",
    label: "peer:kos",
    hint: "kOS terminal tunnel over peer",
  },
  {
    id: "peer:stream",
    label: "peer:stream",
    hint: "WebRTC media calls (cameras)",
  },
  {
    id: "peer:ice",
    label: "peer:ice",
    hint: "Per-data-conn ICE state + candidate gathering (verbose)",
  },
  {
    id: "kos",
    label: "kos",
    hint: "kOS script dispatch + raw WS buffer on timeout",
  },
  { id: "camera", label: "camera", hint: "OCISLY stream source lifecycle" },
  { id: "serial", label: "serial", hint: "Serial device connect / parse" },
  {
    id: "targets",
    label: "targets",
    hint: "Body / vessel data flow into the TargetPicker",
  },
  {
    id: "gonogo",
    label: "gonogo",
    hint: "Station registration & votes",
  },
  { id: "flight", label: "flight", hint: "Flight history plumbing" },
  {
    id: "bug-report",
    label: "bug-report",
    hint: "User-submitted bug reports (rare, kept on for triage)",
  },
];

type TimeWindowOption = {
  label: string;
  /** Minutes; null = include the entire ring buffer. */
  windowMinutes: number | null;
};

const TIME_WINDOW_OPTIONS: TimeWindowOption[] = [
  { label: "last 1 min", windowMinutes: 1 },
  { label: "last 5 min (recommended)", windowMinutes: 5 },
  { label: "last 15 min", windowMinutes: 15 },
  { label: "everything in buffer", windowMinutes: null },
];
const DEFAULT_WINDOW_INDEX = 1;

type Mode = "all" | "none" | "list";

function readTags(): { mode: Mode; tags: Set<string> } {
  const raw =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(LOG_TAGS_KEY)
      : null;
  if (!raw?.trim()) return { mode: "none", tags: new Set() };
  if (raw.trim() === "*") return { mode: "all", tags: new Set() };
  return {
    mode: "list",
    tags: new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  };
}

function writeTags(mode: Mode, tags: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  if (mode === "all") localStorage.setItem(LOG_TAGS_KEY, "*");
  else if (mode === "none" || tags.size === 0)
    localStorage.removeItem(LOG_TAGS_KEY);
  else localStorage.setItem(LOG_TAGS_KEY, Array.from(tags).sort().join(","));
  if (mode === "all") tagRegistry.setTags("all");
  else tagRegistry.setTags(Array.from(tags));
}

export function LogsManager() {
  const [state, setState] = useState(readTags);
  const bufferSize = logger.getBuffer().length;
  const dataSources = useDataSources();
  const streamSources = useStreamSources();
  const version = getAppVersion();
  const [copied, setCopied] = useState(false);

  function buildReport(): string {
    const lines: string[] = [];
    lines.push("gonogo diagnostic snapshot");
    lines.push(`Captured: ${new Date().toISOString()}`);
    if (version) {
      lines.push(`App: v${version.version} (build ${version.buildTime})`);
    }
    lines.push("");
    lines.push("== Data sources ==");
    for (const s of dataSources)
      lines.push(`  ${s.name} (${s.id}): ${s.status}`);
    if (dataSources.length === 0) lines.push("  (none registered)");
    lines.push("");
    lines.push("== Stream sources ==");
    for (const s of streamSources)
      lines.push(
        `  ${s.name} (${s.id}): ${s.status} — ${s.streamCount} stream(s)`,
      );
    if (streamSources.length === 0) lines.push("  (none registered)");
    lines.push("");
    lines.push(`== Log buffer (${bufferSize} entries) ==`);
    for (const entry of logger.getBuffer()) {
      const tag = entry.tag ? `[${entry.tag}] ` : "";
      const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
      const err = entry.error
        ? ` ${entry.error.name}: ${entry.error.message}`
        : "";
      lines.push(
        `  ${entry.timestamp} ${entry.level.toUpperCase()} ${tag}${entry.message}${err}${ctx}`,
      );
    }
    return lines.join("\n");
  }

  async function copyReport() {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard write can fail on insecure origins or when permission
      // is denied. The download path still works for sharing.
      setCopied(false);
    }
  }

  function toggleTag(id: string) {
    const next = new Set(state.tags);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const nextState = { mode: "list" as Mode, tags: next };
    setState(nextState);
    writeTags(nextState.mode, nextState.tags);
  }

  function setMode(mode: Mode) {
    const nextState = { mode, tags: state.tags };
    setState(nextState);
    writeTags(nextState.mode, nextState.tags);
  }

  function clearBuffer() {
    logger.clearBuffer();
    // Force re-render so the count below updates.
    setState({ ...state });
  }

  return (
    <Container>
      <Section>
        <SectionTitle>Snapshot</SectionTitle>
        {version && (
          <SnapshotLine>
            <SnapshotLabel>App</SnapshotLabel>
            <SnapshotValue>
              v{version.version} · build {version.buildTime}
            </SnapshotValue>
          </SnapshotLine>
        )}
        {(dataSources.length > 0 || streamSources.length > 0) && (
          <SnapshotList>
            {dataSources.map((s) => (
              <SnapshotEntry key={`d-${s.id}`}>
                <SnapshotName>{s.name}</SnapshotName>
                <SnapshotStatus $status={s.status}>{s.status}</SnapshotStatus>
              </SnapshotEntry>
            ))}
            {streamSources.map((s) => (
              <SnapshotEntry key={`s-${s.id}`}>
                <SnapshotName>{s.name}</SnapshotName>
                <SnapshotStatus $status={s.status}>
                  {s.status} · {s.streamCount} stream
                  {s.streamCount === 1 ? "" : "s"}
                </SnapshotStatus>
              </SnapshotEntry>
            ))}
          </SnapshotList>
        )}
        <ActionRow>
          <Button onClick={copyReport}>
            {copied ? "Copied" : "Copy report"}
          </Button>
        </ActionRow>
        <Foot>
          The report includes the snapshot above plus every entry currently in
          the log buffer — paste it into a bug report.
        </Foot>
      </Section>

      <Section>
        <SectionTitle>Active tags</SectionTitle>
        <ModeRow>
          <ModeButton
            $active={state.mode === "all"}
            onClick={() => setMode("all")}
          >
            all
          </ModeButton>
          <ModeButton
            $active={state.mode === "none"}
            onClick={() => setMode("none")}
          >
            none
          </ModeButton>
          <ModeHint>
            {state.mode === "all"
              ? "Every tag is being logged — very noisy."
              : state.mode === "none"
                ? "No tag-gated debug will print. Warnings & errors still do."
                : `${state.tags.size} tag${state.tags.size === 1 ? "" : "s"} enabled.`}
          </ModeHint>
        </ModeRow>
        {state.mode !== "all" && (
          <TagList>
            {KNOWN_TAGS.map((t) => (
              <TagRow key={t.id}>
                <Switch
                  checked={state.tags.has(t.id)}
                  onChange={() => toggleTag(t.id)}
                  label={t.label}
                />
                <TagHint>{t.hint}</TagHint>
              </TagRow>
            ))}
          </TagList>
        )}
        <Foot>
          Changes persist to <code>localStorage.LOG_TAGS</code> and apply
          immediately.
        </Foot>
      </Section>

      <Section>
        <SectionTitle>Log buffer</SectionTitle>
        <BufferRow>
          <Count>{bufferSize} entries buffered</Count>
          <ActionRow>
            <Button onClick={downloadLogs} disabled={bufferSize === 0}>
              Download
            </Button>
            <Button onClick={clearBuffer} disabled={bufferSize === 0}>
              Clear
            </Button>
          </ActionRow>
        </BufferRow>
        <Foot>
          The buffer keeps the most recent entries in memory. Download after
          reproducing a bug and share the file.
        </Foot>
      </Section>

      <Section>
        <SectionTitle>Report bug</SectionTitle>
        <ReportBug />
      </Section>
    </Container>
  );
}

type FormPhase = "idle" | "encoding" | "submitting" | "sent";

function ReportBug() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [windowIndex, setWindowIndex] = useState(DEFAULT_WINDOW_INDEX);
  const [screenshot, setScreenshot] = useState<EncodedScreenshot | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [phase, setPhase] = useState<FormPhase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionId = useId();
  const windowId = useId();
  const screenshotId = useId();

  const selectedWindow =
    TIME_WINDOW_OPTIONS[windowIndex] ?? TIME_WINDOW_OPTIONS[0];
  const previewCount = useMemo(
    () =>
      recentLogsWindow(logger.getBuffer(), selectedWindow.windowMinutes).length,
    [selectedWindow.windowMinutes],
  );

  if (!open && phase !== "sent") {
    return (
      <>
        <Foot>
          Sends a tagged report straight to our log store. Includes a slice of
          your recent log buffer and an optional screenshot.
        </Foot>
        <ActionRow>
          <Button onClick={() => setOpen(true)}>Report a bug</Button>
        </ActionRow>
      </>
    );
  }

  if (phase === "sent") {
    return (
      <SentNotice role="status" aria-live="polite">
        Bug report sent — thanks. The log store has it tagged{" "}
        <code>bug-report</code>.
      </SentNotice>
    );
  }

  function reset() {
    setDescription("");
    setWindowIndex(DEFAULT_WINDOW_INDEX);
    setScreenshot(null);
    setScreenshotError(null);
    setSubmitError(null);
    setPhase("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setScreenshotError(null);
    if (!file) {
      setScreenshot(null);
      return;
    }
    setPhase("encoding");
    try {
      const encoded = await encodeScreenshot(file);
      setScreenshot(encoded);
      setPhase("idle");
    } catch (err) {
      setScreenshot(null);
      setPhase("idle");
      if (err instanceof ScreenshotTooLargeError) {
        setScreenshotError(err.message);
      } else {
        const message =
          err instanceof Error ? err.message : "Could not read the image.";
        setScreenshotError(message);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = description.trim();
    if (trimmed.length === 0) return;
    setPhase("submitting");
    setSubmitError(null);
    const recentLogs = recentLogsWindow(
      logger.getBuffer(),
      selectedWindow.windowMinutes,
    );
    try {
      logger.tag("bug-report").error(trimmed, undefined, {
        bug_report: {
          timeWindowMinutes: selectedWindow.windowMinutes,
          recentLogsCount: recentLogs.length,
          recentLogs,
          screenshot,
          reportedAt: new Date().toISOString(),
        },
      });
      await logger.flushTransports();
      setPhase("sent");
      setOpen(false);
      window.setTimeout(() => {
        // After the user has seen the success notice, collapse it and reset
        // the form so a second report starts from a clean slate. We bail if
        // the user has already started another report by then.
        setPhase((p) => (p === "sent" ? "idle" : p));
        setDescription("");
        setScreenshot(null);
        setScreenshotError(null);
        setSubmitError(null);
        setWindowIndex(DEFAULT_WINDOW_INDEX);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }, 5000);
    } catch (err) {
      setPhase("idle");
      setSubmitError(
        err instanceof Error ? err.message : "Could not submit the report.",
      );
    }
  }

  const submitDisabled =
    description.trim().length === 0 ||
    phase === "encoding" ||
    phase === "submitting";

  return (
    <ReportForm onSubmit={handleSubmit} noValidate>
      <Field>
        <FieldLabel htmlFor={descriptionId}>What went wrong?</FieldLabel>
        <Textarea
          id={descriptionId}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What were you doing? What did you expect? What happened instead?"
          required
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={windowId}>Include logs from</FieldLabel>
        <Select
          id={windowId}
          value={windowIndex}
          onChange={(e) => setWindowIndex(Number(e.target.value))}
        >
          {TIME_WINDOW_OPTIONS.map((opt, i) => (
            <option key={opt.label} value={i}>
              {opt.label}
            </option>
          ))}
        </Select>
        <FieldHint>
          {previewCount} log entr{previewCount === 1 ? "y" : "ies"} will be
          attached.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor={screenshotId}>Screenshot (optional)</FieldLabel>
        <input
          id={screenshotId}
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />
        {phase === "encoding" && <FieldHint>Compressing image…</FieldHint>}
        {screenshot && (
          <ScreenshotPreview>
            <ScreenshotThumb
              src={`data:${screenshot.mimeType};base64,${screenshot.base64}`}
              alt="Screenshot preview"
            />
            <ScreenshotMeta>
              <span>
                {screenshot.width}×{screenshot.height},{" "}
                {Math.round(screenshot.encodedSize / 1024)} KB
              </span>
              {screenshot.encodedSize > SCREENSHOT_WARN_BYTES && (
                <Warn>Large image — consider a tighter crop.</Warn>
              )}
            </ScreenshotMeta>
          </ScreenshotPreview>
        )}
        {screenshotError && <Warn>{screenshotError}</Warn>}
      </Field>

      {submitError && <Warn>{submitError}</Warn>}

      <FormActions>
        <Button type="submit" disabled={submitDisabled}>
          {phase === "submitting" ? "Sending…" : "Send report"}
        </Button>
        <Button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </FormActions>
    </ReportForm>
  );
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 420px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const ModeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ModeButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)")};
  color: ${({ $active }) => ($active ? "var(--color-status-go-fg)" : "var(--color-text-primary)")};
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 2px;
  cursor: pointer;
`;

const ModeHint = styled.span`
  color: var(--color-text-muted);
  font-size: 11px;
`;

const TagList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0 0;
`;

const TagRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const TagHint = styled.span`
  color: var(--color-text-muted);
  font-size: 11px;
`;

const Foot = styled.div`
  color: var(--color-text-dim);
  font-size: 11px;

  code {
    background: var(--color-surface-raised);
    padding: 1px 4px;
    border-radius: 2px;
  }
`;

const BufferRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const Count = styled.span`
  color: var(--color-text-primary);
  font-size: 12px;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 8px;
`;

const SnapshotLine = styled.div`
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
`;

const SnapshotLabel = styled.span`
  color: var(--color-text-muted);
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.1em;
  min-width: 32px;
`;

const SnapshotValue = styled.span`
  color: var(--color-text-primary);
`;

const SnapshotList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const SnapshotEntry = styled.li`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
`;

const SnapshotName = styled.span`
  color: var(--color-text-primary);
`;

const ReportForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SentNotice = styled.div`
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  padding: 8px 10px;
  border-radius: 3px;
  font-size: 12px;

  code {
    background: rgba(0, 0, 0, 0.2);
    padding: 1px 4px;
    border-radius: 2px;
  }
`;

const ScreenshotPreview = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-top: 6px;
`;

const ScreenshotThumb = styled.img`
  max-width: 120px;
  max-height: 80px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
`;

const ScreenshotMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--color-text-muted);
`;

const Warn = styled.span`
  color: var(--color-status-warning-bg);
  font-size: 11px;
`;

const SnapshotStatus = styled.span<{ $status: string }>`
  color: ${({ $status }) =>
    $status === "connected"
      ? "var(--color-accent-fg)"
      : $status === "reconnecting"
        ? "var(--color-status-warning-bg)"
        : $status === "error"
          ? "var(--color-status-nogo-bg)"
          : "var(--color-text-faint)"};
  font-size: 11px;
  text-transform: uppercase;
`;
