using System;
using System.Collections.Generic;
using System.Text;
using Sitrep.Contract;

namespace Sitrep.Contract.Serialization
{
    /// <summary>
    /// Writes and parses every Sitrep envelope message as JSON:
    /// <see cref="Meta"/>, <c>StreamData&lt;object?&gt;</c>,
    /// <see cref="StreamBinary"/> headers, <see cref="EventMsg"/>,
    /// <c>CommandRequest&lt;object?&gt;</c>, <c>CommandResponse&lt;object?&gt;</c>,
    /// <see cref="CommandAccepted"/>, <see cref="ErrorMsg"/>,
    /// <see cref="Subscribe"/>, <see cref="Unsubscribe"/> and
    /// <see cref="SetVantage"/>. It depends on no JSON library.
    ///
    /// <para>Every <c>Write*</c> method emits fields in the TypeScript SDK's
    /// declaration order, so the output is byte-for-byte identical to what the
    /// TypeScript SDK serializes for the same message.</para>
    ///
    /// <para>Optional properties (TS <c>foo?: T</c>, C# <c>string?</c> or
    /// <c>double?</c>) are OMITTED from the object when null, matching
    /// <c>JSON.stringify</c>'s treatment of <c>undefined</c>, and are never
    /// written as an explicit <c>null</c>. The always-present generic
    /// <c>Payload</c>, <c>Args</c> and <c>Result</c> fields are the opposite: a
    /// CLR <c>null</c> there is a real value and is written as JSON
    /// <c>null</c>.</para>
    ///
    /// <para>Every <c>Parse*</c> method throws <see cref="FormatException"/>
    /// when the text is not a JSON object, the <c>type</c> field does not name
    /// the expected envelope, or a required field is missing or has the wrong
    /// JSON type.</para>
    /// <internal>
    /// Field order matches the interface declaration order in
    /// <c>mod/sitrep-sdk/src/__generated__/contract.ts</c> (and the
    /// golden-fixture generator constructs its object literals in that same
    /// order); asserted in
    /// <c>Sitrep.Core.Tests/EnvelopeSerializationGoldenFixtureTests.cs</c>
    /// against <c>mod/golden-fixtures/serialization.json</c>. Values are
    /// written through <see cref="JsonWriter"/> and read through
    /// <see cref="JsonReader"/>; a null generic field goes out via
    /// <see cref="JsonWriter.AppendValue"/>.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    public static class EnvelopeCodec
    {
        /// <summary>Serializes a <see cref="Meta"/> block as a JSON object.
        /// <see cref="Meta.GapSinceUt"/> is omitted when null; every other field
        /// is always written.</summary>
        /// <param name="meta">The block to write.</param>
        /// <returns>The JSON text of the object.</returns>
        public static string WriteMeta(Meta meta)
        {
            var sb = new StringBuilder();
            AppendMeta(sb, meta);
            return sb.ToString();
        }

        /// <summary>Parses a JSON <see cref="Meta"/> object. <c>gapSinceUt</c> may be
        /// absent or <c>null</c>, both read as <c>null</c>; every other field is
        /// required.</summary>
        /// <param name="json">The JSON text of one <c>meta</c> object.</param>
        /// <returns>The parsed block.</returns>
        /// <exception cref="FormatException">The text is not a JSON object, or a
        /// required field is missing or has the wrong type.</exception>
        public static Meta ParseMeta(string json)
        {
            return ParseMetaRaw(ExpectObject(JsonReader.Parse(json)));
        }

        private static void AppendMeta(StringBuilder sb, Meta meta)
        {
            sb.Append('{');
            AppendField(sb, "source", first: true);
            JsonWriter.AppendString(sb, meta.Source);

            AppendField(sb, "validAt");
            JsonWriter.AppendNumber(sb, meta.ValidAt);

            AppendField(sb, "seq");
            JsonWriter.AppendInteger(sb, meta.Seq);

            AppendField(sb, "deliveredAt");
            JsonWriter.AppendNumber(sb, meta.DeliveredAt);

            AppendField(sb, "vantage");
            JsonWriter.AppendString(sb, meta.Vantage);

            // Omitted when unstated, as gapSinceUt below is: only vessel.orbit's payload states a quality.
            if (meta.Quality.HasValue)
            {
                AppendField(sb, "quality");
                JsonWriter.AppendInteger(sb, (long)meta.Quality.Value);
            }

            AppendField(sb, "active");
            JsonWriter.AppendBool(sb, meta.Active);

            AppendField(sb, "staleness");
            JsonWriter.AppendInteger(sb, (long)meta.Staleness);

            AppendField(sb, "timelineEpoch");
            JsonWriter.AppendInteger(sb, meta.TimelineEpoch);

            /*
             * Omitted when null, as quality is. The TS envelope
             * declares it optional (`gapSinceUt?: number`), so the TS output this
             * codec must match byte for byte leaves the key out rather than writing
             * null. A gap is also rare (one sample per known break), so absence is
             * the hot path and an explicit null would cost every frame 17 bytes.
             */
            if (meta.GapSinceUt.HasValue)
            {
                AppendField(sb, "gapSinceUt");
                JsonWriter.AppendNumber(sb, meta.GapSinceUt.Value);
            }

            sb.Append('}');
        }

        private static Meta ParseMetaRaw(Dictionary<string, object?> raw)
        {
            return new Meta
            {
                Source = RequireString(raw, "source"),
                ValidAt = RequireDouble(raw, "validAt"),
                Seq = (long)RequireDouble(raw, "seq"),
                DeliveredAt = RequireDouble(raw, "deliveredAt"),
                Vantage = RequireString(raw, "vantage"),
                Quality = OptionalDouble(raw, "quality") is double quality ? (Quality)(int)quality : null,
                Active = RequireBool(raw, "active"),
                Staleness = (Staleness)(int)RequireDouble(raw, "staleness"),
                TimelineEpoch = (int)RequireDouble(raw, "timelineEpoch"),
                // Optional on the way in so a recording that never carried it still parses; absent and null both mean "this sample opens no known break".
                GapSinceUt = OptionalDouble(raw, "gapSinceUt"),
            };
        }

        /// <summary>Serializes a <c>stream-data</c> envelope. A null
        /// <c>Payload</c> is written as JSON <c>null</c>.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteStreamData(StreamData<object?> msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "topic");
            JsonWriter.AppendString(sb, msg.Topic);

            AppendField(sb, "payload");
            JsonWriter.AppendValue(sb, msg.Payload);

            AppendField(sb, "meta");
            AppendMeta(sb, msg.Meta);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses a <c>stream-data</c> envelope. The payload is left as
        /// parsed JSON (dictionaries, lists, strings, doubles, bools and
        /// <c>null</c>); an absent <c>payload</c> reads as <c>null</c>.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not a <c>stream-data</c>
        /// envelope, or a required field is missing or has the wrong
        /// type.</exception>
        public static StreamData<object?> ParseStreamData(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "stream-data");
            return new StreamData<object?>
            {
                Type = "stream-data",
                Topic = RequireString(raw, "topic"),
                Payload = raw.TryGetValue("payload", out var payload) ? payload : null,
                Meta = ParseMetaRaw(RequireObject(raw, "meta")),
            };
        }

        /// <summary>
        /// Serializes the JSON header of a <see cref="BinaryLane"/> frame: the
        /// topic, the segment length table and a <see cref="Meta"/> block
        /// written byte for byte as a <c>stream-data</c> envelope writes it.
        /// Field order matches <see cref="StreamBinary"/>'s declaration order.
        /// <internal>
        /// Written here rather than in <c>BinaryFrameCodec</c> so it can reuse
        /// <see cref="AppendMeta"/>: a second hand-written copy of that block is
        /// how the binary and JSON deliveries would drift.
        /// </internal>
        /// </summary>
        /// <param name="msg">The header to write.</param>
        /// <returns>The JSON text of the header.</returns>
        public static string WriteStreamBinaryHeader(StreamBinary msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "topic");
            JsonWriter.AppendString(sb, msg.Topic);

            AppendField(sb, "segments");
            sb.Append('[');
            for (var i = 0; i < msg.Segments.Length; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }

                JsonWriter.AppendInteger(sb, msg.Segments[i]);
            }

            sb.Append(']');

            AppendField(sb, "meta");
            AppendMeta(sb, msg.Meta);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses the JSON header of a binary-lane frame, the
        /// <c>stream-binary</c> half written by
        /// <see cref="WriteStreamBinaryHeader"/>.</summary>
        /// <param name="json">The JSON text of the header.</param>
        /// <returns>The parsed header.</returns>
        /// <exception cref="FormatException">The text is not a
        /// <c>stream-binary</c> header, a required field is missing, or a segment
        /// length is not a non-negative integer.</exception>
        public static StreamBinary ParseStreamBinaryHeader(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "stream-binary");
            return new StreamBinary
            {
                Type = "stream-binary",
                Topic = RequireString(raw, "topic"),
                Segments = RequireIntArray(raw, "segments"),
                Meta = ParseMetaRaw(RequireObject(raw, "meta")),
            };
        }

        private static int[] RequireIntArray(Dictionary<string, object?> raw, string key)
        {
            if (!raw.TryGetValue(key, out var value) || value is not List<object?> list)
            {
                throw new FormatException("expected array field '" + key + "'");
            }

            var result = new int[list.Count];
            for (var i = 0; i < list.Count; i++)
            {
                if (list[i] is not double number)
                {
                    throw new FormatException("expected a number in '" + key + "' at index " + i);
                }

                // A segment length is a byte count: a fractional or negative
                // one is not a short frame, it is a producer that has lost
                // track of its own buffer, and reading past it would be reading
                // whatever the next frame's bytes happen to be.
                var length = (int)number;
                if (length != number || length < 0)
                {
                    throw new FormatException("segment length must be a non-negative integer, got " + number);
                }

                result[i] = length;
            }

            return result;
        }

        /// <summary>Serializes an <c>event</c> envelope.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteEventMsg(EventMsg msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "topic");
            JsonWriter.AppendString(sb, msg.Topic);

            AppendField(sb, "name");
            JsonWriter.AppendString(sb, msg.Name);

            AppendField(sb, "meta");
            AppendMeta(sb, msg.Meta);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses an <c>event</c> envelope; every field is
        /// required.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not an <c>event</c>
        /// envelope, or a required field is missing or has the wrong
        /// type.</exception>
        public static EventMsg ParseEventMsg(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "event");
            return new EventMsg
            {
                Type = "event",
                Topic = RequireString(raw, "topic"),
                Name = RequireString(raw, "name"),
                Meta = ParseMetaRaw(RequireObject(raw, "meta")),
            };
        }

        /// <summary>Serializes a <c>command-request</c> envelope. <c>vantage</c>
        /// is written only when <see cref="CommandRequest{T}.Vantage"/> is
        /// non-empty; absent, the server uses the vantage the session selected
        /// with <see cref="SetVantage"/>. A null <c>Args</c> is written as JSON
        /// <c>null</c>.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteCommandRequest(CommandRequest<object?> msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "requestId");
            JsonWriter.AppendString(sb, msg.RequestId);

            AppendField(sb, "command");
            JsonWriter.AppendString(sb, msg.Command);

            AppendField(sb, "label");
            JsonWriter.AppendString(sb, msg.Label);

            AppendField(sb, "topic");
            JsonWriter.AppendString(sb, msg.Topic);

            // Written only when set, matching the TS SDK's omission of an undefined optional; absent, the server uses the session's selected vantage.
            if (!string.IsNullOrEmpty(msg.Vantage))
            {
                AppendField(sb, "vantage");
                JsonWriter.AppendString(sb, msg.Vantage);
            }

            AppendField(sb, "args");
            JsonWriter.AppendValue(sb, msg.Args);

            AppendField(sb, "sentAt");
            JsonWriter.AppendNumber(sb, msg.SentAt);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses a <c>command-request</c> envelope. <c>label</c>,
        /// <c>topic</c> and <c>vantage</c> are optional and read as an empty
        /// string when absent; an absent <c>args</c> reads as <c>null</c>.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not a
        /// <c>command-request</c> envelope, or <c>requestId</c>, <c>command</c> or
        /// <c>sentAt</c> is missing or has the wrong type.</exception>
        public static CommandRequest<object?> ParseCommandRequest(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "command-request");
            return new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = RequireString(raw, "requestId"),
                Command = RequireString(raw, "command"),
                // Optional: "" makes PendingUplink.Label fall back to Command.
                Label = TryGetString(raw, "label") ?? "",
                // Optional: "" leaves PendingUplink.Topic unscoped.
                Topic = TryGetString(raw, "topic") ?? "",
                // Optional: "" makes the server use the session's selected vantage.
                Vantage = TryGetString(raw, "vantage") ?? "",
                Args = raw.TryGetValue("args", out var args) ? args : null,
                SentAt = RequireDouble(raw, "sentAt"),
            };
        }

        /// <summary>Serializes a <c>command-response</c> envelope. A null
        /// <c>Result</c> is written as JSON <c>null</c>.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteCommandResponse(CommandResponse<object?> msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "requestId");
            JsonWriter.AppendString(sb, msg.RequestId);

            AppendField(sb, "result");
            JsonWriter.AppendValue(sb, msg.Result);

            AppendField(sb, "meta");
            AppendMeta(sb, msg.Meta);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses a <c>command-response</c> envelope. The result is left
        /// as parsed JSON; an absent <c>result</c> reads as <c>null</c>.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not a
        /// <c>command-response</c> envelope, or a required field is missing or has
        /// the wrong type.</exception>
        public static CommandResponse<object?> ParseCommandResponse(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "command-response");
            return new CommandResponse<object?>
            {
                Type = "command-response",
                RequestId = RequireString(raw, "requestId"),
                Result = raw.TryGetValue("result", out var result) ? result : null,
                Meta = ParseMetaRaw(RequireObject(raw, "meta")),
            };
        }

        /// <summary>Serializes an <c>error</c> envelope. <c>requestId</c> and
        /// <c>topic</c> are omitted when null.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteErrorMsg(ErrorMsg msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            if (msg.RequestId != null)
            {
                AppendField(sb, "requestId");
                JsonWriter.AppendString(sb, msg.RequestId);
            }

            if (msg.Topic != null)
            {
                AppendField(sb, "topic");
                JsonWriter.AppendString(sb, msg.Topic);
            }

            AppendField(sb, "code");
            JsonWriter.AppendString(sb, msg.Code.Id);

            AppendField(sb, "message");
            JsonWriter.AppendString(sb, msg.Message);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Serializes a <c>command-accepted</c> envelope.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteCommandAccepted(CommandAccepted msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "requestId");
            JsonWriter.AppendString(sb, msg.RequestId);

            AppendField(sb, "oneWaySeconds");
            JsonWriter.AppendNumber(sb, msg.OneWaySeconds);

            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses a <c>command-accepted</c> envelope; every field is
        /// required.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not a
        /// <c>command-accepted</c> envelope, or a required field is missing or has
        /// the wrong type.</exception>
        public static CommandAccepted ParseCommandAccepted(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "command-accepted");
            return new CommandAccepted
            {
                Type = "command-accepted",
                RequestId = RequireString(raw, "requestId"),
                OneWaySeconds = RequireDouble(raw, "oneWaySeconds"),
            };
        }

        /// <summary>Parses an <c>error</c> envelope. <c>requestId</c> and
        /// <c>topic</c> are optional and read as <c>null</c> when absent.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not an <c>error</c>
        /// envelope, or <c>code</c> or <c>message</c> is missing or not a
        /// string.</exception>
        public static ErrorMsg ParseErrorMsg(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "error");
            return new ErrorMsg
            {
                Type = "error",
                RequestId = TryGetString(raw, "requestId"),
                Topic = TryGetString(raw, "topic"),
                Code = FaultCode.FromWire(RequireString(raw, "code")),
                Message = RequireString(raw, "message"),
            };
        }

        /// <summary>Serializes a <c>subscribe</c> envelope.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteSubscribe(Subscribe msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "topic");
            JsonWriter.AppendString(sb, msg.Topic);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses a <c>subscribe</c> envelope.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not a <c>subscribe</c>
        /// envelope, or <c>topic</c> is missing or not a string.</exception>
        public static Subscribe ParseSubscribe(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "subscribe");
            return new Subscribe { Type = "subscribe", Topic = RequireString(raw, "topic") };
        }

        /// <summary>Serializes an <c>unsubscribe</c> envelope.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteUnsubscribe(Unsubscribe msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "topic");
            JsonWriter.AppendString(sb, msg.Topic);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses an <c>unsubscribe</c> envelope.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not an
        /// <c>unsubscribe</c> envelope, or <c>topic</c> is missing or not a
        /// string.</exception>
        public static Unsubscribe ParseUnsubscribe(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "unsubscribe");
            return new Unsubscribe { Type = "unsubscribe", Topic = RequireString(raw, "topic") };
        }

        /// <summary>Serializes a <c>set-vantage</c> envelope.</summary>
        /// <param name="msg">The envelope to write.</param>
        /// <returns>The JSON text of the envelope.</returns>
        public static string WriteSetVantage(SetVantage msg)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            AppendField(sb, "type", first: true);
            JsonWriter.AppendString(sb, msg.Type);

            AppendField(sb, "centreId");
            JsonWriter.AppendString(sb, msg.CentreId);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Parses a <c>set-vantage</c> envelope.</summary>
        /// <param name="json">The JSON text of the envelope.</param>
        /// <returns>The parsed envelope.</returns>
        /// <exception cref="FormatException">The text is not a
        /// <c>set-vantage</c> envelope, or <c>centreId</c> is missing or not a
        /// string.</exception>
        public static SetVantage ParseSetVantage(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "set-vantage");
            return new SetVantage { Type = "set-vantage", CentreId = RequireString(raw, "centreId") };
        }

        /// <summary>
        /// Parses a server-to-client envelope (<c>StreamData&lt;object?&gt;</c>,
        /// <see cref="EventMsg"/>, <c>CommandResponse&lt;object?&gt;</c>,
        /// <see cref="CommandAccepted"/> or <see cref="ErrorMsg"/>), dispatching
        /// on the <c>"type"</c> field the same way the TypeScript SDK does.
        /// <internal>
        /// Mirrors <c>parseServerMessage</c> in
        /// <c>mod/sitrep-sdk/src/client.ts</c>.
        /// </internal>
        /// </summary>
        /// <param name="json">The JSON text of one frame.</param>
        /// <returns>The parsed envelope, typed by its <c>type</c> field.</returns>
        /// <exception cref="UnknownEnvelopeTypeException">The frame names no
        /// server envelope, or has no readable <c>type</c>.</exception>
        /// <exception cref="InvalidEnvelopeException">The frame names a server
        /// envelope but a field is missing or has the wrong type.</exception>
        public static object ParseServerMessage(string json)
        {
            var type = PeekType(json);
            try
            {
                return type switch
                {
                    "stream-data" => ParseStreamData(json),
                    "event" => ParseEventMsg(json),
                    "command-response" => ParseCommandResponse(json),
                    "command-accepted" => ParseCommandAccepted(json),
                    "error" => ParseErrorMsg(json),
                    _ => throw new UnknownEnvelopeTypeException(
                        $"unknown server envelope type: {type}", type, PeekRequestId(json), PeekTopic(json)),
                };
            }
            catch (FormatException ex) when (!(ex is UnknownEnvelopeTypeException))
            {
                throw new InvalidEnvelopeException(type, PeekRequestId(json), ex);
            }
        }

        /// <summary>
        /// Parses a client-to-server envelope (<see cref="Subscribe"/>,
        /// <see cref="Unsubscribe"/>, <see cref="SetVantage"/> or
        /// <c>CommandRequest&lt;object?&gt;</c>), dispatching on the
        /// <c>"type"</c> field.
        ///
        /// <para>Failure comes back as one of two <see cref="FormatException"/>
        /// subclasses: an <see cref="UnknownEnvelopeTypeException"/> means the
        /// frame named no envelope this build has, and there is nothing more to
        /// report; an <see cref="InvalidEnvelopeException"/> means it named one
        /// and got a field wrong, and carries the type and the field so a caller
        /// can say which.</para>
        /// <internal>
        /// Mirrors <c>ClientMessage</c> in <c>envelope.ts</c>.
        /// </internal>
        /// </summary>
        /// <param name="json">The JSON text of one frame.</param>
        /// <returns>The parsed envelope, typed by its <c>type</c> field.</returns>
        public static object ParseClientMessage(string json)
        {
            var type = PeekType(json);
            try
            {
                return type switch
                {
                    "subscribe" => ParseSubscribe(json),
                    "unsubscribe" => ParseUnsubscribe(json),
                    "set-vantage" => ParseSetVantage(json),
                    "command-request" => ParseCommandRequest(json),
                    _ => throw new UnknownEnvelopeTypeException(
                        $"unknown client envelope type: {type}", type, PeekRequestId(json), PeekTopic(json)),
                };
            }
            catch (FormatException ex) when (!(ex is UnknownEnvelopeTypeException))
            {
                throw new InvalidEnvelopeException(type, PeekRequestId(json), ex);
            }
        }

        /// <summary>
        /// Reads the discriminant, and treats every way of failing to as
        /// "this is not an envelope" rather than as a bad field: unparseable
        /// JSON, a non-object, and a missing or non-string <c>type</c> all
        /// leave the reader with no idea what it is holding, which is exactly
        /// what <see cref="UnknownEnvelopeTypeException"/> says.
        /// </summary>
        private static string PeekType(string json)
        {
            try
            {
                return RequireString(ExpectObject(JsonReader.Parse(json)), "type");
            }
            catch (FormatException ex)
            {
                throw new UnknownEnvelopeTypeException("envelope carries no readable \"type\": " + ex.Message, ex);
            }
        }

        /// <summary>
        /// Best-effort <c>requestId</c> for a refusal that wants correlating.
        /// It only ever runs on a frame already known to be broken, so every
        /// failure mode reads as "no id" instead of throwing a second time on
        /// top of the first.
        /// </summary>
        private static string? PeekRequestId(string json) => PeekString(json, "requestId");

        /// <summary>Best-effort <c>topic</c>, on the same terms as <see cref="PeekRequestId"/>.</summary>
        private static string? PeekTopic(string json) => PeekString(json, "topic");

        private static string? PeekString(string json, string field)
        {
            try
            {
                return TryGetString(ExpectObject(JsonReader.Parse(json)), field);
            }
            catch (FormatException)
            {
                return null;
            }
        }

        private static void AppendField(StringBuilder sb, string name, bool first = false)
        {
            if (!first)
            {
                sb.Append(',');
            }
            JsonWriter.AppendString(sb, name);
            sb.Append(':');
        }

        private static Dictionary<string, object?> ExpectObject(object? value)
        {
            if (value is Dictionary<string, object?> dict)
            {
                return dict;
            }
            throw new FormatException("Expected a JSON object at the top level of an envelope.");
        }

        private static void RequireType(Dictionary<string, object?> raw, string expected)
        {
            var actual = RequireString(raw, "type");
            if (actual != expected)
            {
                throw new FormatException($"Expected envelope type \"{expected}\" but found \"{actual}\".");
            }
        }

        private static string RequireString(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is string s)
            {
                return s;
            }
            throw new FormatException($"Missing or non-string required field \"{key}\".");
        }

        private static string? TryGetString(Dictionary<string, object?> raw, string key)
        {
            return raw.TryGetValue(key, out var value) && value is string s ? s : null;
        }

        private static double RequireDouble(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is double d)
            {
                return d;
            }
            throw new FormatException($"Missing or non-numeric required field \"{key}\".");
        }

        /// <summary>A numeric field that may be absent or explicitly null, both read as <c>null</c>.</summary>
        private static double? OptionalDouble(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is double d)
            {
                return d;
            }
            return null;
        }

        private static bool RequireBool(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is bool b)
            {
                return b;
            }
            throw new FormatException($"Missing or non-boolean required field \"{key}\".");
        }

        private static Dictionary<string, object?> RequireObject(Dictionary<string, object?> raw, string key)
        {
            if (raw.TryGetValue(key, out var value) && value is Dictionary<string, object?> obj)
            {
                return obj;
            }
            throw new FormatException($"Missing or non-object required field \"{key}\".");
        }
    }
}
