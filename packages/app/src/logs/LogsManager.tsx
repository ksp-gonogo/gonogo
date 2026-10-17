import { logger, tagRegistry } from "@ksp-gonogo/logger";
import {
  Button,
  Field,
  FieldHint,
  FieldLabel,
  FileInput,
  FormActions,
  Select,
  Switch,
  Textarea,
} from "@ksp-gonogo/ui";
import { SectionTitle, Stack } from "@ksp-gonogo/ui-kit";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { downloadLogs } from "./downloadLogs";
import { GithubIssueForm } from "./GithubIssueForm";
import { recentLogsWindow } from "./recentLogsWindow";
import {
  type EncodedScreenshot,
  encodeScreenshot,
  SCREENSHOT_WARN_BYTES,
  ScreenshotTooLargeError,
} from "./screenshotEncoder";
import { sendReportOnce } from "./sendReportOnce";

const LOG_TAGS_KEY = "LOG_TAGS";

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

function readVerbose(): boolean {
  try {
    return localStorage.getItem(LOG_TAGS_KEY)?.trim() === "*";
  } catch {
    return false;
  }
}

function writeVerbose(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOG_TAGS_KEY, "*");
    else localStorage.removeItem(LOG_TAGS_KEY);
  } catch {
    // Storage is unavailable: the switch still applies for this page load.
  }
  tagRegistry.setVerbose(on);
}

export function LogsManager() {
  const [verbose, setVerbose] = useState(readVerbose);
  const [, setBufferVersion] = useState(0);
  const bufferSize = logger.getBuffer().length;

  function toggleVerbose(on: boolean) {
    setVerbose(on);
    writeVerbose(on);
  }

  function clearBuffer() {
    logger.clearBuffer();
    setBufferVersion((v) => v + 1);
  }

  return (
    <Container>
      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3">Console output</SectionTitle>
        <Switch
          checked={verbose}
          onChange={toggleVerbose}
          label="Verbose logging"
        />
        <Foot>
          Prints debug lines from every part of the app to the browser console.
          Warnings and errors always print.
        </Foot>
      </Stack>

      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3">Log buffer</SectionTitle>
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
      </Stack>

      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3">Feedback</SectionTitle>
        <ReportBug />
        <GithubIssue />
      </Stack>
    </Container>
  );
}

function GithubIssue() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <>
        <Foot>
          Or report it on GitHub, with the versions already filled in.
        </Foot>
        <ActionRow>
          <Button onClick={() => setOpen(true)}>Open a GitHub issue</Button>
        </ActionRow>
      </>
    );
  }
  return <GithubIssueForm onCancel={() => setOpen(false)} />;
}

type FormPhase = "idle" | "encoding" | "submitting" | "sent";

function ReportBug() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"bug" | "feedback">("bug");
  const [description, setDescription] = useState("");
  const [windowIndex, setWindowIndex] = useState(DEFAULT_WINDOW_INDEX);
  const [screenshot, setScreenshot] = useState<EncodedScreenshot | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [phase, setPhase] = useState<FormPhase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Post-send form-reset timer (5s after a successful submit). Held so it
  // can be cleared on unmount; otherwise closing the Logs modal within 5s
  // of sending fires setState on an unmounted component.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );
  const kindId = useId();
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
          Report a bug or send a suggestion. Either way it includes a slice of
          your recent log buffer and an optional screenshot.
        </Foot>
        <ActionRow>
          <Button onClick={() => setOpen(true)}>Send feedback</Button>
        </ActionRow>
      </>
    );
  }

  if (phase === "sent") {
    const sentTag = kind === "feedback" ? "feedback" : "bug-report";
    const sentLabel = kind === "feedback" ? "Feedback" : "Bug report";
    return (
      <SentNotice role="status" aria-live="polite">
        {sentLabel} sent, thanks. The log store has it tagged{" "}
        <code>{sentTag}</code>.
      </SentNotice>
    );
  }

  function reset() {
    setKind("bug");
    setDescription("");
    setWindowIndex(DEFAULT_WINDOW_INDEX);
    setScreenshot(null);
    setScreenshotName(null);
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
      setScreenshotName(null);
      return;
    }
    setScreenshotName(file.name);
    setPhase("encoding");
    try {
      const encoded = await encodeScreenshot(file);
      setScreenshot(encoded);
      setPhase("idle");
    } catch (err) {
      setScreenshot(null);
      setScreenshotName(null);
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
      const tag = kind === "feedback" ? "feedback" : "bug-report";
      const tagged = logger.tag(tag);
      const payload = {
        bug_report: {
          kind,
          timeWindowMinutes: selectedWindow.windowMinutes,
          recentLogsCount: recentLogs.length,
          recentLogs,
          screenshot,
          reportedAt: new Date().toISOString(),
        },
      };
      // A bug is an error so it shows up in error-rate views; feedback is
      // informational. Same payload shape either way, distinguished by `kind`.
      if (kind === "feedback") tagged.info(trimmed, payload);
      else tagged.error(trimmed, undefined, payload);
      if (logger.transportCount() === 0) {
        // No standing sink is installed (analytics is off), so this Send ships its own entry: pressing it is the consent.
        const entry = logger.getBuffer().at(-1);
        if (!entry) throw new Error("The report could not be sent.");
        await sendReportOnce(entry);
      } else {
        // The Axiom SDK auto-batches and retries on its own. Race the flush
        // against a 10s deadline so a slow transport (e.g. backpressure on
        // a large screenshot) doesn't trap the UI in "Submitting...". The entry
        // is in the ring buffer regardless, so timing out is a soft success:
        // surface "sent" but flip the form to its post-send state quickly.
        const flushOrTimeout = await Promise.race([
          logger.flushTransports().then(() => "flushed" as const),
          new Promise<"timeout">((resolve) =>
            window.setTimeout(() => resolve("timeout"), 10_000),
          ),
        ]);
        if (flushOrTimeout === "timeout") {
          // Don't error out: the entry is in the ring buffer and the SDK
          // will keep retrying. Tag a one-liner so the operator sees in
          // their own logs that delivery was slow.
          logger.warn("[report] flush did not complete within 10s", {
            screenshotEncodedSize: screenshot?.encodedSize ?? null,
          });
        }
      }
      setPhase("sent");
      setOpen(false);
      resetTimerRef.current = setTimeout(() => {
        // After the user has seen the success notice, collapse it and reset
        // the form so a second report starts from a clean slate. We bail if
        // the user has already started another report by then.
        setPhase((p) => (p === "sent" ? "idle" : p));
        setKind("bug");
        setDescription("");
        setScreenshot(null);
        setScreenshotName(null);
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
        <FieldLabel htmlFor={kindId}>Type</FieldLabel>
        <Select
          id={kindId}
          value={kind}
          onChange={(e) => setKind(e.target.value as "bug" | "feedback")}
        >
          <option value="bug">Bug report</option>
          <option value="feedback">Feedback</option>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor={descriptionId}>
          {kind === "feedback" ? "Your feedback" : "What went wrong?"}
        </FieldLabel>
        <Textarea
          id={descriptionId}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            kind === "feedback"
              ? "What would you change, add, or like to see?"
              : "What were you doing? What did you expect? What happened instead?"
          }
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
        <FileInput
          id={screenshotId}
          ref={fileInputRef}
          accept="image/*"
          fileName={screenshotName}
          onChange={handleFileChange}
        />
        {phase === "encoding" && <FieldHint>Compressing image...</FieldHint>}
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
                <Warn>Large image: consider a tighter crop.</Warn>
              )}
            </ScreenshotMeta>
          </ScreenshotPreview>
        )}
        {screenshotError && <Warn>{screenshotError}</Warn>}
      </Field>

      {submitError && <Warn>{submitError}</Warn>}

      <FormActions>
        <Button type="submit" disabled={submitDisabled}>
          {phase === "submitting" ? "Sending..." : "Send report"}
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
  gap: var(--gap-section);
  min-width: 420px;
`;

const Foot = styled.div`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);

  code {
    background: var(--color-surface-raised);
    padding: var(--inset-chip);
    border-radius: var(--radius-regular);
  }
`;

const BufferRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
`;

const Count = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
`;

const ActionRow = styled.div`
  display: flex;
  gap: var(--gap-related);
`;

const ReportForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const SentNotice = styled.div`
  background: var(--color-go-status);
  color: var(--color-go-on-status);
  padding: var(--inset-surface);
  border-radius: var(--radius-regular);
  font-size: var(--font-size-compact);

  code {
    background: rgba(0, 0, 0, 0.2);
    padding: var(--inset-chip);
    border-radius: var(--radius-regular);
  }
`;

const ScreenshotPreview = styled.div`
  display: flex;
  align-items: flex-start;
  gap: var(--gap-attachment);
  padding-top: var(--gap-under-field);
`;

const ScreenshotThumb = styled.img`
  max-width: 120px;
  max-height: 80px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;

const ScreenshotMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

const Warn = styled.span`
  color: var(--color-warn-text);
  font-size: var(--font-size-compact);
`;
