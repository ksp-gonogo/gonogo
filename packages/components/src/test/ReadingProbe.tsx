import { useTelemetry } from "@ksp-gonogo/core";
import type { TopicId } from "@ksp-gonogo/sitrep-sdk";

/**
 * Renders one topic's reading state as `<topic>: <state>`, beside a widget.
 *
 * For a test whose claim is that an arrival changes NOTHING on screen: the
 * widget cannot show that the emit landed, so the probe does, and the test
 * waits for it before asserting the unchanged render. The probe and the widget
 * read the same store, so once the probe shows the arrival the widget has
 * rendered it too.
 */
export function ReadingProbe({ topic }: { topic: TopicId }) {
  const reading = useTelemetry(topic);
  return <span>{`${topic}: ${reading.state}`}</span>;
}
