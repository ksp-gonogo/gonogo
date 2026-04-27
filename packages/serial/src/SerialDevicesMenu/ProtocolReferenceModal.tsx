import { useState } from "react";
import styled from "styled-components";
import type { DeviceParserId } from "../types";

/**
 * Small help link that opens a modal describing the wire format for the
 * selected parser. Rendered next to the parser dropdown in the Device Type
 * editor so firmware authors can copy a minimal reference without leaving
 * the app.
 */
export function ProtocolReferenceButton({
  parser,
}: Readonly<{ parser: DeviceParserId }>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <HelpLink
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show protocol reference"
        title="Show protocol reference"
      >
        ?
      </HelpLink>
      {open && (
        <Backdrop onClick={() => setOpen(false)} role="presentation">
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-label="Serial protocol reference"
            onClick={(e) => e.stopPropagation()}
          >
            <Header>
              <Title>
                {parser === "json-state"
                  ? "json-state protocol"
                  : "char-position protocol"}
              </Title>
              <Close
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </Close>
            </Header>
            <Body>
              {parser === "json-state" ? (
                <JsonStateContent />
              ) : (
                <CharPositionContent />
              )}
            </Body>
          </Dialog>
        </Backdrop>
      )}
    </>
  );
}

function CharPositionContent() {
  return (
    <>
      <p>
        Your device sends one fixed-width ASCII line per tick, terminated by{" "}
        <code>\n</code>. Each input you declare below picks a fixed character
        slice of that line.
      </p>
      <pre>{`0723 1 0 0 0512 0612 0500\\n`}</pre>
      <p>
        With offsets <code>throttle</code> = (0, 4), <code>sas</code> = (5, 1),
        <code>rcs</code> = (7, 1), <code>gear</code> = (9, 1), <code>roll</code>{" "}
        = (11, 4) the parser slices each tick and emits one event per input.
      </p>
      <ul>
        <li>
          <strong>Button:</strong> non-empty slice AND not <code>"0"</code> →{" "}
          <code>true</code>, else <code>false</code>.
        </li>
        <li>
          <strong>Analog:</strong> <code>parseInt(slice)</code>, then normalised
          to <code>-1..1</code> using the input's min/max.
        </li>
        <li>
          Malformed slices (out-of-range, <code>NaN</code>) are silently skipped
          — other inputs on the same line still fire.
        </li>
      </ul>
      <p>Minimal Arduino-ish firmware:</p>
      <pre>{`void loop() {
  int thr  = analogRead(A0);           // 0–1023
  int sas  = digitalRead(2);           // 0 or 1
  char line[16];
  snprintf(line, sizeof(line), "%04d %d\\n", thr, sas);
  Serial.write(line);
  delay(20);                           // ~50 Hz
}`}</pre>
      <ul>
        <li>Zero-pad analogs so their slice width stays constant.</li>
        <li>
          Use plain <code>\n</code>, not <code>\r\n</code> — the trailing{" "}
          <code>\r</code> lands inside the last field's slice otherwise.
        </li>
        <li>Send every input every tick (no diffs).</li>
        <li>30–50 Hz is the sweet spot.</li>
      </ul>
    </>
  );
}

function JsonStateContent() {
  return (
    <>
      <p>
        Your device sends one line of JSON per tick. The parser discovers the
        input list from the message itself — you don't declare inputs in the UI,
        they appear here as the device reports them.
      </p>
      <pre>{`{
  "btn":    { "A": 0, "B": 1 },
  "analog": { "X": { "val": 100, "min": 0, "max": 1023 } },
  "screen": { "type": "txt", "w": 21, "h": 8 }
}`}</pre>
      <ul>
        <li>
          <strong>btn</strong>: object of <code>id → 0/1</code> (or{" "}
          <code>true/false</code>, or <code>"0"/"1"</code>). Any unrecognised
          value becomes <code>false</code>.
        </li>
        <li>
          <strong>analog</strong>: object of{" "}
          <code>id → {"{val, min, max}"}</code>. Normalised to{" "}
          <code>-1..1</code>. After the first tick you can elide{" "}
          <code>min</code>/<code>max</code> and send just{" "}
          <code>{`{"X": 102}`}</code> — the parser remembers the range.
        </li>
        <li>
          <strong>screen</strong> (optional):{" "}
          <code>{`{"type": "txt", "w": N, "h": M}`}</code> wires up the{" "}
          <code>text-buffer</code> render style at the declared size. Send other
          types later as we add render styles for them.
        </li>
        <li>
          All three top-level keys are optional per tick — send only what
          changes if you want.
        </li>
      </ul>
      <p>Minimal firmware sketch (ArduinoJson):</p>
      <pre>{`void loop() {
  StaticJsonDocument<256> doc;
  doc["btn"]["A"]    = digitalRead(2);
  auto x = doc["analog"].createNestedObject("X");
  x["val"] = analogRead(A0);
  x["min"] = 0;
  x["max"] = 1023;
  auto screen = doc.createNestedObject("screen");
  screen["type"] = "txt";
  screen["w"] = 21;
  screen["h"] = 8;
  serializeJson(doc, Serial);
  Serial.write('\\n');
  delay(20);
}`}</pre>
      <ul>
        <li>
          Plain <code>\n</code> terminator, not <code>\r\n</code>.
        </li>
        <li>
          Re-send the full announcement (with <code>min</code>/<code>max</code>/
          <code>screen</code>) every few seconds so an app that reconnects
          mid-stream picks up the schema without a handshake.
        </li>
        <li>30–50 Hz for typical controllers.</li>
      </ul>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const HelpLink = styled.button`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 50%;
  color: var(--color-status-info-fg);
  width: 18px;
  height: 18px;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  &:hover {
    background: var(--color-border-subtle);
    color: var(--color-text-primary);
  }
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Dialog = styled.div`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  max-width: 560px;
  width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-surface-raised);
  background: var(--color-surface-panel);
`;

const Title = styled.h3`
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const Close = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 14px;
  cursor: pointer;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const Body = styled.div`
  overflow-y: auto;
  padding: 14px 18px;
  color: var(--color-text-primary);
  font-size: 12px;
  line-height: 1.5;

  p {
    margin: 0 0 10px;
  }
  ul {
    margin: 0 0 10px;
    padding-left: 20px;
  }
  li {
    margin: 4px 0;
  }
  code {
    background: var(--color-surface-sunken);
    color: var(--color-status-go-fg);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 11px;
  }
  pre {
    background: var(--color-surface-sunken);
    color: var(--color-status-go-fg);
    padding: 8px 10px;
    border-radius: 3px;
    font-size: 11px;
    overflow-x: auto;
    margin: 0 0 10px;
  }
`;
