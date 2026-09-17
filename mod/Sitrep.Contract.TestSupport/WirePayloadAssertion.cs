using System.Text.Json;
using Sitrep.Contract.Serialization;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// Serializes a payload the way the courier does, so a test can assert what
    /// an extension actually puts on the wire.
    ///
    /// <para>The point is the BYTES, not the builder. A payload object that
    /// looks right and serializes wrong is the defect these tests exist to
    /// catch, so this goes through the real <see cref="EnvelopeCodec"/> rather
    /// than reimplementing the shape: the same call the host makes, holding the
    /// same golden-fixture parity with the TypeScript SDK. A helper that
    /// asserted a shape without serializing would report green over exactly the
    /// regression it was written for.</para>
    ///
    /// <para>The envelope around the payload defaults to a fixed, arbitrary
    /// one, because a test about a payload should not have to describe nine
    /// fields it will never look at. Pass <paramref name="meta"/> when the
    /// envelope is itself part of the assertion: a golden fixture holding a
    /// whole serialised frame is that case, since its committed bytes include
    /// the meta that produced them.</para>
    /// </summary>
    public static class WirePayload
    {
        /// <summary>
        /// The whole envelope as it would leave the host, as raw JSON.
        ///
        /// <para>For assertions about the bytes THEMSELVES: key order, an
        /// omitted optional, a nested object's exact spelling. A parsed
        /// <see cref="JsonElement"/> cannot see any of those, because parsing
        /// is what throws them away.</para>
        /// </summary>
        public static string Envelope(object? payload, string topic = "test", Meta? meta = null)
        {
            return EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Type = "stream-data",
                Topic = topic,
                Payload = payload,
                Meta = meta ?? new Meta
                {
                    Source = "vessel:1",
                    ValidAt = 0,
                    Seq = 1,
                    DeliveredAt = 0,
                    Vantage = "v",
                    Quality = Quality.Loaded,
                    Active = true,
                    Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            });
        }

        /// <summary>
        /// Just the serialized payload, parsed, for assertions about values.
        ///
        /// <para>Detached from the document that produced it, so it outlives
        /// the parse and a caller need not manage one.</para>
        /// </summary>
        public static JsonElement Of(object? payload, string topic = "test", Meta? meta = null)
        {
            using var doc = JsonDocument.Parse(Envelope(payload, topic, meta));
            return doc.RootElement.GetProperty("payload").Clone();
        }
    }
}
