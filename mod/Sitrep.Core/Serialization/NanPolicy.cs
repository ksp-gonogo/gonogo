using System;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// THE single definition of the NaN/Infinity wire-format sentinel policy
    /// used by every envelope serializer in this project — see
    /// <c>mod/golden-fixtures/gen/serialization.gen.ts</c> for the matching
    /// TS-side policy applied when the golden fixture is generated.
    ///
    /// A browser's <c>JSON.parse</c> rejects bare <c>NaN</c> / <c>Infinity</c>
    /// tokens (they aren't valid JSON), and KSP's own orbit math is a real
    /// source of these values on the wire (eccentric-anomaly / landing
    /// telemetry can genuinely be NaN — see the fork's known Principia/NaN
    /// quirks). Rather than dropping the sample or crashing the writer, a
    /// non-finite <c>double</c> is encoded as one of three fixed JSON
    /// STRING tokens — <c>"NaN"</c>, <c>"Infinity"</c>, <c>"-Infinity"</c> —
    /// matching JavaScript's own <c>String(NaN)</c> / <c>String(Infinity)</c>
    /// / <c>String(-Infinity)</c>, so the sentinel reads naturally in logs
    /// (Axiom, browser devtools) without extra translation.
    ///
    /// Applied UNIFORMLY: both the fixed-schema numeric fields (e.g.
    /// <c>Meta.ValidAt</c>/<c>DeliveredAt</c>/<c>Confidence</c>,
    /// <c>CommandRequest.SentAt</c>) and the free-form generic
    /// <c>Payload</c>/<c>Args</c>/<c>Result</c> value trees go through the
    /// exact same <see cref="TryEncode"/> / <see cref="TryDecode"/> pair —
    /// see <see cref="JsonWriter.AppendNumber"/> (write side, the ONLY place
    /// a <c>double</c> is ever appended) and <see cref="JsonReader"/>'s
    /// string-value parsing (read side, the ONLY place a JSON string token
    /// is converted into a CLR value).
    ///
    /// KNOWN TRADE-OFF (documented, accepted for M5a): because the decode
    /// side applies to every parsed string uniformly, a genuine string
    /// PAYLOAD value that happens to be exactly <c>"NaN"</c>, <c>"Infinity"</c>,
    /// or <c>"-Infinity"</c> will be misread back as the corresponding
    /// double rather than preserved as a string. Telemetry payloads are
    /// essentially never literal strings with those exact values, so this is
    /// an acceptable ambiguity rather than a real-world bug; a future
    /// protocol version could resolve it with explicit type tagging if that
    /// ever changes.
    /// </summary>
    internal static class NanPolicy
    {
        public const string NaNToken = "NaN";
        public const string PositiveInfinityToken = "Infinity";
        public const string NegativeInfinityToken = "-Infinity";

        /// <summary>
        /// If <paramref name="value"/> is non-finite, returns the sentinel
        /// token to write in its place (as a JSON string); otherwise <c>null</c>,
        /// meaning the caller should write <paramref name="value"/> as a plain
        /// JSON number.
        /// </summary>
        public static string? TryEncode(double value)
        {
            if (double.IsNaN(value))
            {
                return NaNToken;
            }
            if (double.IsPositiveInfinity(value))
            {
                return PositiveInfinityToken;
            }
            if (double.IsNegativeInfinity(value))
            {
                return NegativeInfinityToken;
            }
            return null;
        }

        /// <summary>
        /// If <paramref name="token"/> is one of the three sentinel strings,
        /// returns the corresponding non-finite double via
        /// <paramref name="value"/> and <c>true</c>; otherwise <c>false</c>
        /// (the caller should keep treating the parsed value as a plain
        /// string).
        /// </summary>
        public static bool TryDecode(string token, out double value)
        {
            switch (token)
            {
                case NaNToken:
                    value = double.NaN;
                    return true;
                case PositiveInfinityToken:
                    value = double.PositiveInfinity;
                    return true;
                case NegativeInfinityToken:
                    value = double.NegativeInfinity;
                    return true;
                default:
                    value = default;
                    return false;
            }
        }
    }
}
