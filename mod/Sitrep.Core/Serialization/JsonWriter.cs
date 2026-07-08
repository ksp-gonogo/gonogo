using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// Hand-written, allocation-conscious JSON writer — no Json.NET, no
    /// System.Text.Json (the latter is a separate NuGet package on
    /// <c>netstandard2.0</c> and would break <c>Sitrep.Core</c>'s
    /// zero-PackageReference invariant; see <c>Sitrep.Core.csproj</c>).
    /// Writes directly into a caller-supplied <see cref="StringBuilder"/> so
    /// a full envelope write is one buffer, not one allocation per field.
    /// <c>EnvelopeCodec</c> owns fixed-schema field order and optional-field
    /// omission; this class only knows how to append JSON primitives and the
    /// fully-generic <c>object?</c> value tree (used for <c>Payload</c> /
    /// <c>Args</c> / <c>Result</c>).
    /// </summary>
    internal static class JsonWriter
    {
        /// <summary>
        /// THE only place a <see cref="double"/> is ever appended — see
        /// <see cref="NanPolicy"/> for why. Finite values are written as a
        /// plain JSON number (shortest round-trippable form, matching what
        /// <c>JSON.stringify</c> produces for ordinary telemetry-range
        /// magnitudes); non-finite values are written as one of the three
        /// fixed sentinel strings instead.
        /// </summary>
        public static void AppendNumber(StringBuilder sb, double value)
        {
            var sentinel = NanPolicy.TryEncode(value);
            if (sentinel != null)
            {
                AppendString(sb, sentinel);
                return;
            }

            sb.Append(FormatFiniteNumber(value));
        }

        /// <summary>Appends a JSON integer (used for <c>Meta.Seq</c> and enum ordinals) — always finite, no sentinel policy applies.</summary>
        public static void AppendInteger(StringBuilder sb, long value)
        {
            sb.Append(value.ToString(CultureInfo.InvariantCulture));
        }

        public static void AppendBool(StringBuilder sb, bool value)
        {
            sb.Append(value ? "true" : "false");
        }

        public static void AppendNull(StringBuilder sb)
        {
            sb.Append("null");
        }

        /// <summary>Appends a JSON string with standard escaping (quote, backslash, control chars). Non-ASCII passes through unescaped, matching <c>JSON.stringify</c>'s default.</summary>
        public static void AppendString(StringBuilder sb, string value)
        {
            sb.Append('"');
            foreach (var c in value)
            {
                switch (c)
                {
                    case '"':
                        sb.Append("\\\"");
                        break;
                    case '\\':
                        sb.Append("\\\\");
                        break;
                    case '\b':
                        sb.Append("\\b");
                        break;
                    case '\f':
                        sb.Append("\\f");
                        break;
                    case '\n':
                        sb.Append("\\n");
                        break;
                    case '\r':
                        sb.Append("\\r");
                        break;
                    case '\t':
                        sb.Append("\\t");
                        break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }

        /// <summary>
        /// Generic recursive writer for the free-form CLR value shapes used
        /// by <c>Payload</c> / <c>Args</c> / <c>Result</c>: <c>null</c>,
        /// <c>bool</c>, <c>double</c> (also accepts boxed <c>int</c>/<c>long</c>/
        /// <c>float</c> for caller convenience), <c>string</c>,
        /// <c>Dictionary&lt;string, object?&gt;</c>, and <c>List&lt;object?&gt;</c>
        /// — the same shape <c>CourierGoldenFixtureTests.ToClrValue</c> already
        /// uses elsewhere in this codebase. Numbers always go through
        /// <see cref="AppendNumber"/>, so the NaN/Infinity policy applies
        /// uniformly however deeply nested the value is.
        ///
        /// WIDER NUMERIC TYPES (C2-2, second fail-soft round): a channel
        /// mapper is uplink-authored and can legitimately hand back any
        /// of the numeric CLR types <c>ChannelEmitter.TryToDouble</c>
        /// already accepts for its deadband gate — <c>short</c>/<c>sbyte</c>/
        /// <c>byte</c>/<c>uint</c>/<c>ulong</c>/<c>decimal</c>, not just
        /// <c>double</c>/<c>float</c>/<c>int</c>/<c>long</c>. Before this
        /// fix, one of those types would clear the emitter's gate fine and
        /// only THEN throw <c>NotSupportedException</c> here, at delivery
        /// time — every one of those is now converted (widened to
        /// <c>double</c>, matching the emitter's own conversion) and routed
        /// through <see cref="AppendNumber"/> exactly like any other number.
        ///
        /// ARRAYS: anything else that's an <see cref="IEnumerable"/> (e.g.
        /// <c>double[]</c>, <c>object?[]</c>, <c>float[]</c> — any real
        /// capture code writes a typed array, not a hand-built
        /// <c>List&lt;object?&gt;</c>) is written as a JSON array too, one
        /// element at a time back through THIS method, so a numeric element
        /// still gets the NaN/Infinity sentinel policy and a nested
        /// array/dict still recurses correctly. This case is deliberately
        /// last among the collection cases: <c>string</c> is itself
        /// <c>IEnumerable&lt;char&gt;</c> and <c>Dictionary&lt;,&gt;</c>/
        /// <c>IDictionary&lt;,&gt;</c> are themselves <c>IEnumerable</c>, so
        /// both must (and do, per C#'s in-order switch matching) get matched
        /// by their own case above before this catch-all runs.
        /// </summary>
        public static void AppendValue(StringBuilder sb, object? value)
        {
            switch (value)
            {
                case null:
                    AppendNull(sb);
                    break;
                case bool b:
                    AppendBool(sb, b);
                    break;
                case double d:
                    AppendNumber(sb, d);
                    break;
                case float f:
                    AppendNumber(sb, f);
                    break;
                case int i:
                    AppendNumber(sb, i);
                    break;
                case long l:
                    AppendNumber(sb, l);
                    break;
                case short s16:
                    AppendNumber(sb, s16);
                    break;
                case sbyte i8:
                    AppendNumber(sb, i8);
                    break;
                case byte u8:
                    AppendNumber(sb, u8);
                    break;
                case uint u32:
                    AppendNumber(sb, u32);
                    break;
                case ulong u64:
                    AppendNumber(sb, u64);
                    break;
                case decimal dec:
                    AppendNumber(sb, (double)dec);
                    break;
                case string s:
                    AppendString(sb, s);
                    break;
                case Sitrep.Contract.CommandResult commandResult:
                    // F2 Part 3 (R7 wire-flatten): a CommandResult /
                    // CommandResult<T> POCO is what every command handler
                    // returns and travels back as CommandResponse.Result.
                    // JsonWriter otherwise has no idea how to serialize an
                    // arbitrary POCO, so before this case existed EVERY
                    // command response (success OR failure) fail-softed at the
                    // wire boundary (see EnvelopeCodec.WriteCommandResponse ->
                    // this method). Flattened here, in the SAME "producer owns
                    // the flatten" spirit as VesselViewProvider.ToWire, rather
                    // than adding a wire-shape method to the BCL-only contract
                    // type. Enum error code is emitted as its integer ordinal,
                    // matching how every other enum in this codec serializes
                    // (Meta.quality / Meta.staleness).
                    AppendCommandResult(sb, commandResult);
                    break;
                case IDictionary<string, object?> obj:
                    AppendObject(sb, obj);
                    break;
                case IEnumerable enumerable:
                    AppendArray(sb, enumerable);
                    break;
                default:
                    throw new System.NotSupportedException(
                        $"JsonWriter.AppendValue: unsupported CLR value type {value.GetType()}");
            }
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.CommandResult"/> (or its
        /// generic <c>CommandResult&lt;T&gt;</c> subtype) to the wire object
        /// <c>{ success, errorCode, [payload] }</c>. <c>errorCode</c> is the
        /// enum's integer ordinal (same convention as every other enum in
        /// this codec). The <c>payload</c> key is emitted ONLY for the
        /// generic subtype — read reflectively because <c>T</c> is open here —
        /// so a plain <see cref="Sitrep.Contract.CommandResult"/> (the "no
        /// payload" actuation ack) serializes without a payload key at all.
        /// A null payload on a <c>CommandResult&lt;T&gt;</c> (the failure
        /// case) is still a real value and IS written as JSON <c>null</c>,
        /// via <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendCommandResult(StringBuilder sb, Sitrep.Contract.CommandResult result)
        {
            sb.Append('{');
            AppendString(sb, "success");
            sb.Append(':');
            AppendBool(sb, result.Success);

            sb.Append(',');
            AppendString(sb, "errorCode");
            sb.Append(':');
            AppendInteger(sb, (long)result.ErrorCode);

            var type = result.GetType();
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Sitrep.Contract.CommandResult<>))
            {
                var payload = type.GetProperty("Payload")!.GetValue(result);
                sb.Append(',');
                AppendString(sb, "payload");
                sb.Append(':');
                AppendValue(sb, payload);
            }

            sb.Append('}');
        }

        private static void AppendObject(StringBuilder sb, IDictionary<string, object?> obj)
        {
            sb.Append('{');
            var first = true;
            foreach (var pair in obj)
            {
                if (!first)
                {
                    sb.Append(',');
                }
                first = false;
                AppendString(sb, pair.Key);
                sb.Append(':');
                AppendValue(sb, pair.Value);
            }
            sb.Append('}');
        }

        /// <summary>
        /// Writes any non-string, non-dictionary <see cref="IEnumerable"/> as
        /// a JSON array — covers both the hand-built <c>List&lt;object?&gt;</c>
        /// shape and a real typed array (<c>double[]</c>, <c>object?[]</c>,
        /// ...). Enumerating as plain (non-generic) <see cref="IEnumerable"/>
        /// yields each element already boxed as <c>object</c>, so a
        /// <c>double[]</c> element arrives as a boxed <c>double</c> and hits
        /// <see cref="AppendValue"/>'s <c>case double d</c> exactly like any
        /// other numeric value — same NaN/Infinity sentinel path either way.
        /// </summary>
        private static void AppendArray(StringBuilder sb, IEnumerable list)
        {
            sb.Append('[');
            var first = true;
            foreach (var item in list)
            {
                if (!first)
                {
                    sb.Append(',');
                }
                first = false;
                AppendValue(sb, item);
            }
            sb.Append(']');
        }

        /// <summary>
        /// Formats a finite double as the shortest round-trippable decimal
        /// string, matching <c>JSON.stringify</c> for realistic
        /// telemetry-range magnitudes: no redundant trailing zeros, negative
        /// zero collapsed to <c>"0"</c> (JS's <c>JSON.stringify(-0) === "0"</c>),
        /// and (for the rare very-large/very-small magnitude that triggers
        /// exponential notation) a lowercased, non-zero-padded exponent
        /// (<c>"1e+21"</c> / <c>"1e-7"</c>) to look like V8's own output.
        ///
        /// NOT a claim of byte-for-byte parity with V8's exact
        /// shortest-round-trip / fixed-vs-exponential switchover algorithm
        /// (ECMA-262 Number::ToString) across EVERY possible double — that's
        /// out of scope for M5a. Telemetry values are realistically within
        /// the range where .NET's own shortest-round-trippable formatting
        /// already agrees with JS's default number-to-string conversion.
        /// </summary>
        private static string FormatFiniteNumber(double value)
        {
            // IEEE-754: -0.0 == 0.0, so this also normalizes negative zero.
            if (value == 0)
            {
                return "0";
            }

            var s = value.ToString(CultureInfo.InvariantCulture);

            var eIndex = s.IndexOfAny(new[] { 'E', 'e' });
            if (eIndex < 0)
            {
                return s;
            }

            var mantissa = s.Substring(0, eIndex);
            var expPart = s.Substring(eIndex + 1);
            var negativeExp = expPart.Length > 0 && expPart[0] == '-';
            var digits = expPart.TrimStart('+', '-').TrimStart('0');
            if (digits.Length == 0)
            {
                digits = "0";
            }
            return mantissa + "e" + (negativeExp ? "-" : "+") + digits;
        }
    }
}
