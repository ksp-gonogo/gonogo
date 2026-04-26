import { logger, tagRegistry } from "@gonogo/core";
import { Button, Switch } from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";

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
    id: "kos",
    label: "kos",
    hint: "kOS script dispatch + raw WS buffer on timeout",
  },
  { id: "camera", label: "camera", hint: "OCISLY stream source lifecycle" },
  { id: "serial", label: "serial", hint: "Serial device connect / parse" },
  {
    id: "gonogo",
    label: "gonogo",
    hint: "Station registration & votes",
  },
  { id: "flight", label: "flight", hint: "Flight history plumbing" },
];

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

function downloadLogs(): void {
  const payload = logger.exportLogs();
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gonogo-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    </Container>
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
  color: #888;
`;

const ModeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ModeButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "#2e5a2e" : "#1a1a1a")};
  border: 1px solid ${({ $active }) => ($active ? "#3e7a3e" : "#2a2a2a")};
  color: ${({ $active }) => ($active ? "#cfe" : "#aaa")};
  font-family: monospace;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 2px;
  cursor: pointer;
`;

const ModeHint = styled.span`
  color: #777;
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
  color: #777;
  font-size: 11px;
`;

const Foot = styled.div`
  color: #666;
  font-size: 11px;

  code {
    background: #1a1a1a;
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
  color: #aaa;
  font-size: 12px;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 8px;
`;
