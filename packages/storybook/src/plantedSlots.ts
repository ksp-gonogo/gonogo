import { PLANTED_SLOTS_AVAILABLE_TOPIC } from "../../components/scripts/probe/slot-stubs/stub";

interface StreamBlock {
  emits: { channel: string; value: unknown }[];
}

function isStreamBlock(value: unknown): value is StreamBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    "emits" in value &&
    Array.isArray(value.emits)
  );
}

/**
 * A host fixture with the planted-slots Domain announced on its stream, so
 * the slot stubs render in it. The fixture file itself stays as the host's
 * own scenes read it.
 */
export function withPlantedSlots(
  fixture: Record<string, unknown>,
): Record<string, unknown> {
  const stream = fixture._stream;
  if (!isStreamBlock(stream)) {
    throw new Error(
      "A slot stub scene needs a fixture with a _stream block to announce the planted-slots Domain on",
    );
  }
  return {
    ...fixture,
    _stream: {
      ...stream,
      emits: [
        ...stream.emits,
        { channel: PLANTED_SLOTS_AVAILABLE_TOPIC, value: true },
      ],
    },
  };
}
