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
                case string s:
                    AppendString(sb, s);
                    break;
                case IDictionary<string, object?> obj:
                    AppendObject(sb, obj);
                    break;
                case IEnumerable<object?> list:
                    AppendArray(sb, list);
                    break;
                default:
                    throw new System.NotSupportedException(
                        $"JsonWriter.AppendValue: unsupported CLR value type {value.GetType()}");
            }
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

        private static void AppendArray(StringBuilder sb, IEnumerable<object?> list)
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
