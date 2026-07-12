// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Gonogo.Kos
{
    /// <summary>
    /// Pure, KSP/kOS-free parser for the <c>[KOSDATA:&lt;id&gt;]k=v;k=v[/KOSDATA]</c>
    /// wire format kOS compute scripts emit via <c>PRINT</c> — the C# port of
    /// the app-side <c>packages/data/src/kos/kos-data-parser.ts</c>, moved
    /// mod-side per <c>kos-migration-spec.md</c> §4(b): in-process we capture
    /// the clean, un-wrapped source text at <c>ScreenBuffer.Print</c> (the
    /// Harmony postfix), so grid-reassembly and ANSI-splitting largely go
    /// away — but the marker/body grammar and the value coercion rules stay
    /// byte-identical to the TS so the client sees exactly the same values.
    ///
    /// <para>ANSI stripping is retained defensively (the snapshot-scrape
    /// fallback, spec §4.4, still feeds reassembled grid rows) and is a cheap
    /// no-op when the text carries no escape byte, exactly as the TS does.</para>
    /// </summary>
    public static class KosDataParser
    {
        /// <summary>Topic id used when a block omits the <c>:topic</c> suffix — mirrors the TS <c>DEFAULT_KOS_TOPIC</c>.</summary>
        public const string DefaultTopic = "default";

        private const char Esc = '\u001b';

        // Group 1 = optional topic id ("shipmap" in [KOSDATA:shipmap]); group
        // 2 = body. Topic charset is [\w-] so kebab-case ids don't clash with
        // the body's ; or =. Mirrors the TS BLOCK_RE exactly.
        private static readonly Regex BlockRe = new Regex(
            @"\[KOSDATA(?::([\w-]+))?\]([\s\S]*?)\[/KOSDATA\]",
            RegexOptions.Compiled);

        // CSI / OSC / bare 2-byte escapes — mirrors the TS ANSI_RE verbatim
        // ( = ESC,  = BEL).
        private static readonly Regex AnsiRe = new Regex(
            "\u001b\\[[0-?]*[ -/]*[@-~]|\u001b\\][^\u0007\u001b]*(?:\u0007|\u001b\\\\)|\u001b[@-Z\\\\-_?]",
            RegexOptions.Compiled);

        /// <summary>
        /// Strips ANSI control sequences. Cheap short-circuit when the text
        /// contains no ESC byte (the common plain-<c>PRINT</c> case), same as
        /// the TS <c>stripAnsi</c>.
        /// </summary>
        public static string StripAnsi(string text)
        {
            if (text == null) return "";
            if (text.IndexOf(Esc) == -1) return text;
            return AnsiRe.Replace(text, "");
        }

        /// <summary>
        /// Topic-aware parse. Returns the latest body per topic id seen in
        /// <paramref name="text"/>, keyed by topic; bare <c>[KOSDATA]</c>
        /// blocks key under <see cref="DefaultTopic"/>. When two blocks share
        /// a topic the later one wins (newer beats older). Returns an empty
        /// dictionary when no complete block is present (the C# analogue of
        /// the TS returning <c>null</c> — an empty result reads the same at
        /// every call site without a null-check).
        /// </summary>
        public static Dictionary<string, Dictionary<string, object>> ParseTopics(string text)
        {
            var result = new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
            var clean = StripAnsi(text);
            foreach (Match m in BlockRe.Matches(clean))
            {
                var topic = m.Groups[1].Success ? m.Groups[1].Value : DefaultTopic;
                result[topic] = ParseBody(m.Groups[2].Value);
            }
            return result;
        }

        /// <summary>
        /// Parses one block body (<c>k=v;k=v</c>) into a field map. Blank keys
        /// and entries with no <c>=</c> are skipped, matching the TS
        /// <c>parseBody</c>.
        /// </summary>
        public static Dictionary<string, object> ParseBody(string body)
        {
            var outMap = new Dictionary<string, object>(StringComparer.Ordinal);
            if (body == null) return outMap;
            foreach (var raw in body.Split(';'))
            {
                var eq = raw.IndexOf('=');
                if (eq == -1) continue;
                var key = raw.Substring(0, eq).Trim();
                if (key.Length == 0) continue;
                var value = raw.Substring(eq + 1).Trim();
                outMap[key] = Coerce(value);
            }
            return outMap;
        }

        // Must accept "-1.5", "3e-2", "0"; rejects "NaN" (ambiguous — surfaced
        // as a string so the widget decides). Mirrors the TS coerce() and its
        // number regex exactly. A JSON value (parts=<json>) fails the numeric
        // test and passes through as a string, which the client JSON.parses.
        private static readonly Regex NumberRe = new Regex(
            @"^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$", RegexOptions.Compiled);

        /// <summary>
        /// Coerces one raw value string to <see cref="bool"/> / <see cref="double"/>
        /// / <see cref="string"/> — the exact rules of the TS <c>coerce</c>.
        /// </summary>
        public static object Coerce(string value)
        {
            if (value == "true") return true;
            if (value == "false") return false;
            if (value.Length != 0 && NumberRe.IsMatch(value))
            {
                return double.Parse(value, NumberStyles.Float, CultureInfo.InvariantCulture);
            }
            return value;
        }
    }
}
