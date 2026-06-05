import { logger, tagRegistry } from "@gonogo/logger";
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
} from "@gonogo/ui";
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
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [phase, setPhase] = useState<FormPhase>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Post-send form-reset timer (5s after a successful submit). Held so it
  // can be cleared on unmount — otherwise closing the Logs modal within 5s
  // of sending fires setState on an unmounted component.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );
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
      logger.tag("bug-report").error(trimmed, undefined, {
        bug_report: {
          timeWindowMinutes: selectedWindow.windowMinutes,
          recentLogsCount: recentLogs.length,
          recentLogs,
          screenshot,
          reportedAt: new Date().toISOString(),
        },
      });
      // The Axiom SDK auto-batches and retries on its own. Race the flush
      // against a 10s deadline so a slow transport (e.g. backpressure on
      // a large screenshot) doesn't trap the UI in "Submitting…" — the
      // user's 2026-05-17 bug-report attempt with a screenshot stalled
      // forever and the report never arrived. The entry is in the ring
      // buffer regardless, so timing out is a soft success: surface
      // "sent" but flip the form to its post-send state quickly.
      const flushOrTimeout = await Promise.race([
        logger.flushTransports().then(() => "flushed" as const),
        new Promise<"timeout">((resolve) =>
          window.setTimeout(() => resolve("timeout"), 10_000),
        ),
      ]);
      if (flushOrTimeout === "timeout") {
        // Don't error out — the entry is in the ring buffer and the SDK
        // will keep retrying. Tag a one-liner so the operator sees in
        // their own logs that delivery was slow.
        logger.warn("[bug-report] flush did not complete within 10s", {
          screenshotEncodedSize: screenshot?.encodedSize ?? null,
        });
      }
      setPhase("sent");
      setOpen(false);
      resetTimerRef.current = setTimeout(() => {
        // After the user has seen the success notice, collapse it and reset
        // the form so a second report starts from a clean slate. We bail if
        // the user has already started another report by then.
        setPhase((p) => (p === "sent" ? "idle" : p));
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
        <FileInput
          id={screenshotId}
          ref={fileInputRef}
          accept="image/*"
          fileName={screenshotName}
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
