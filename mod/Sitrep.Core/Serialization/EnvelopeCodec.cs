using System;
using System.Collections.Generic;
using System.Text;
using Sitrep.Contract;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// Hand-written writer/reader for every envelope DTO in
    /// <c>Sitrep.Contract</c> (<see cref="Meta"/>, <c>StreamData&lt;object?&gt;</c>,
    /// <c>CommandResponse&lt;object?&gt;</c>, <see cref="EventMsg"/>,
    /// <see cref="ErrorMsg"/>, <see cref="Subscribe"/>, <see cref="Unsubscribe"/>,
    /// <c>CommandRequest&lt;object?&gt;</c>) — no Json.NET, no
    /// System.Text.Json; see <see cref="JsonWriter"/>/<see cref="JsonReader"/>.
    ///
    /// Field order in every <c>Write*</c> method matches the TS interface
    /// declaration order in <c>mod/sitrep-sdk/src/__generated__/contract.ts</c>
    /// exactly (and the golden-fixture generator constructs its object
    /// literals in that same order), so the on-wire shape this produces is
    /// byte-for-byte identical to what the real TS SDK serializes for the
    /// same message — asserted in
    /// <c>Sitrep.Core.Tests/EnvelopeSerializationGoldenFixtureTests.cs</c>
    /// against <c>mod/golden-fixtures/serialization.json</c>.
    ///
    /// Optional properties (TS <c>foo?: T</c>, C# <c>string?</c>/<c>double?</c>)
    /// are OMITTED from the object entirely when null — matching
    /// <c>JSON.stringify</c>'s treatment of <c>undefined</c>-valued
    /// properties — never written as an explicit <c>null</c>. The always-present
    /// generic <c>Payload</c>/<c>Args</c>/<c>Result</c> fields are the
    /// opposite: a CLR <c>null</c> there is a real value and IS written as
    /// JSON <c>null</c>, via <see cref="JsonWriter.AppendValue"/>.
    /// </summary>
    public static class EnvelopeCodec
    {
        // ----- Meta -----

        public static string WriteMeta(Meta meta)
        {
            var sb = new StringBuilder();
            AppendMeta(sb, meta);
            return sb.ToString();
        }

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

            AppendField(sb, "quality");
            JsonWriter.AppendInteger(sb, (long)meta.Quality);

            AppendField(sb, "active");
            JsonWriter.AppendBool(sb, meta.Active);

            AppendField(sb, "staleness");
            JsonWriter.AppendInteger(sb, (long)meta.Staleness);

            if (meta.Confidence.HasValue)
            {
                AppendField(sb, "confidence");
                JsonWriter.AppendNumber(sb, meta.Confidence.Value);
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
                Quality = (Quality)(int)RequireDouble(raw, "quality"),
                Active = RequireBool(raw, "active"),
                Staleness = (Staleness)(int)RequireDouble(raw, "staleness"),
                Confidence = TryGetDouble(raw, "confidence"),
            };
        }

        // ----- StreamData<object?> -----

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

        // ----- EventMsg -----

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

        // ----- CommandRequest<object?> -----

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

            AppendField(sb, "args");
            JsonWriter.AppendValue(sb, msg.Args);

            AppendField(sb, "sentAt");
            JsonWriter.AppendNumber(sb, msg.SentAt);
            sb.Append('}');
            return sb.ToString();
        }

        public static CommandRequest<object?> ParseCommandRequest(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "command-request");
            return new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = RequireString(raw, "requestId"),
                Command = RequireString(raw, "command"),
                Args = raw.TryGetValue("args", out var args) ? args : null,
                SentAt = RequireDouble(raw, "sentAt"),
            };
        }

        // ----- CommandResponse<object?> -----

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

        // ----- ErrorMsg -----

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
            JsonWriter.AppendString(sb, msg.Code);

            AppendField(sb, "message");
            JsonWriter.AppendString(sb, msg.Message);
            sb.Append('}');
            return sb.ToString();
        }

        public static ErrorMsg ParseErrorMsg(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "error");
            return new ErrorMsg
            {
                Type = "error",
                RequestId = TryGetString(raw, "requestId"),
                Topic = TryGetString(raw, "topic"),
                Code = RequireString(raw, "code"),
                Message = RequireString(raw, "message"),
            };
        }

        // ----- Subscribe -----

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

        public static Subscribe ParseSubscribe(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "subscribe");
            return new Subscribe { Type = "subscribe", Topic = RequireString(raw, "topic") };
        }

        // ----- Unsubscribe -----

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

        public static Unsubscribe ParseUnsubscribe(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            RequireType(raw, "unsubscribe");
            return new Unsubscribe { Type = "unsubscribe", Topic = RequireString(raw, "topic") };
        }

        // ----- Discriminated envelope parsing, mirroring sitrep-sdk's envelope.ts/client.ts -----

        /// <summary>
        /// Parses a server-to-client envelope (<c>StreamData&lt;object?&gt;</c> /
        /// <see cref="EventMsg"/> / <c>CommandResponse&lt;object?&gt;</c> /
        /// <see cref="ErrorMsg"/>), dispatching on the <c>"type"</c>
        /// discriminant exactly like <c>mod/sitrep-sdk/src/client.ts</c>'s
        /// <c>parseServerMessage</c>.
        /// </summary>
        public static object ParseServerMessage(string json)
        {
            var type = PeekType(json);
            return type switch
            {
                "stream-data" => ParseStreamData(json),
                "event" => ParseEventMsg(json),
                "command-response" => ParseCommandResponse(json),
                "error" => ParseErrorMsg(json),
                _ => throw new FormatException($"unknown server envelope type: {type}"),
            };
        }

        /// <summary>Parses a client-to-server envelope (<see cref="Subscribe"/> / <see cref="Unsubscribe"/> / <c>CommandRequest&lt;object?&gt;</c>), mirroring <c>ClientMessage</c> in <c>envelope.ts</c>.</summary>
        public static object ParseClientMessage(string json)
        {
            var type = PeekType(json);
            return type switch
            {
                "subscribe" => ParseSubscribe(json),
                "unsubscribe" => ParseUnsubscribe(json),
                "command-request" => ParseCommandRequest(json),
                _ => throw new FormatException($"unknown client envelope type: {type}"),
            };
        }

        private static string PeekType(string json)
        {
            var raw = ExpectObject(JsonReader.Parse(json));
            return RequireString(raw, "type");
        }

        // ----- shared helpers -----

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

        private static double? TryGetDouble(Dictionary<string, object?> raw, string key)
        {
            return raw.TryGetValue(key, out var value) && value is double d ? d : (double?)null;
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
