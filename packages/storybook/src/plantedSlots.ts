import { plantedSlotAvailableTopic } from "../../components/scripts/probe/slot-stubs/stub";

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
 * A host fixture with the Domain of each named extension point's stub
 * announced on its stream, so those stubs render in it and no others do. The
 * fixture file itself stays as the host's own scenes read it.
 */
export function withPlantedSlots(
  fixture: Record<string, unknown>,
  slots: readonly string[],
): Record<string, unknown> {
  // A fixture fed only by flat keys has no stream block yet; one holding just the Domains leaves those keys as they were.
  const stream = fixture._stream ?? { emits: [] };
  if (!isStreamBlock(stream)) {
    throw new Error(
      "A slot stub scene's fixture has a _stream block with no emits list to announce its stubs' Domains on",
    );
  }
  return {
    ...fixture,
    _stream: {
      ...stream,
      emits: [
        ...stream.emits,
        ...slots.map((slot) => ({
          channel: plantedSlotAvailableTopic(slot),
          value: true,
        })),
      ],
    },
  };
}
