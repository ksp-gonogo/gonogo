// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Gonogo.Kos
{
    /// <summary>
    /// One completed <c>[KOSDATA]</c> block, attributed to the CPU whose
    /// <c>PRINT</c> stream produced it.
    /// </summary>
    public sealed class KosComputeBlock
    {
        /// <summary>
        /// The emitting CPU's <c>KOSCoreId</c> (spec §4.2). The accumulator
        /// itself no longer knows this — it keys buffers by the
        /// <c>ScreenBuffer</c> reference, not the resolved CPU id, so no
        /// <c>AllInstances()</c> reverse-map runs per <c>PRINT</c> fragment
        /// (adversarial-review I1). The owning CPU is resolved ONCE and stamped
        /// here by <c>KosExtension.OnPrint</c> at the moment the block completes
        /// and is about to publish. <c>-1</c> until stamped.
        /// </summary>
        public int CoreId { get; internal set; } = -1;

        public string Topic { get; }
        public IReadOnlyDictionary<string, object> Fields { get; }

        /// <summary>
        /// True when this block came from an explicit
        /// <c>[KOSERROR]message[/KOSERROR]</c> marker rather than
        /// <c>[KOSDATA]</c> — the mod-side mirror of the telnet path's
        /// <c>KosComputeSession.parseKosExplicitError</c>. Script authors print
        /// this to deliberately fail an RPC call (e.g. <c>kos.run</c>) with a
        /// domain-level message, distinct from a script crash or timeout.
        /// <see cref="Fields"/> is always empty when this is true.
        /// </summary>
        public bool IsError { get; }

        /// <summary>The <c>[KOSERROR]</c> body, trimmed — null unless <see cref="IsError"/>.</summary>
        public string? ErrorMessage { get; }

        private static readonly IReadOnlyDictionary<string, object> EmptyFields =
            new Dictionary<string, object>();

        public KosComputeBlock(
            string topic,
            IReadOnlyDictionary<string, object> fields,
            bool isError = false,
            string? errorMessage = null)
        {
            Topic = topic;
            Fields = fields;
            IsError = isError;
            ErrorMessage = errorMessage;
        }

        /// <summary>Convenience factory for an explicit <c>[KOSERROR]</c> block — mirrors the TS <c>parseKosExplicitError</c> shape (message only, no topic).</summary>
        public static KosComputeBlock ForError(string message) =>
            new KosComputeBlock(KosDataParser.DefaultTopic, EmptyFields, isError: true, errorMessage: message.Trim());
    }

    /// <summary>
    /// Pure, KSP/kOS-free per-CPU accumulator that turns a stream of
    /// <c>ScreenBuffer.Print</c> fragments (captured by the Harmony postfix,
    /// spec §4(b)) into completed <c>[KOSDATA]</c> blocks. A single <c>PRINT</c>
    /// need not contain a whole block — kerboscript can build one up across
    /// several prints, and the postfix sees each fragment — so the marker pair
    /// is only actionable once BOTH ends have arrived. This class holds the
    /// partial text per CPU until a closing <c>[/KOSDATA]</c> completes a
    /// block, emits it, and drops the consumed prefix.
    ///
    /// <para>Bounded: if a buffer grows past <see cref="MaxBufferChars"/>
    /// without ever closing a block (a runaway <c>PRINT</c> or a script that
    /// opened a marker it never closes), the oldest half is discarded so the
    /// accumulator can never leak memory on the main thread. The
    /// <c>PerfBudget</c> on the emit fanout (spec's compute budget) covers the
    /// downstream rate; this bound covers the upstream buffer.</para>
    ///
    /// <para>NOT thread-safe by itself — every call happens inside the
    /// <c>ScreenBuffer.Print</c> postfix, i.e. already on the KSP main thread
    /// (spec §2). The dispatcher/pump boundary is elsewhere.</para>
    ///
    /// <para>Buffers are keyed by the <b>emitting screen reference</b> (the
    /// postfix's <c>ScreenBuffer __instance</c>), NOT the CPU's
    /// <c>KOSCoreId</c>. Keying by the object already in hand means no
    /// <c>kOSProcessor.AllInstances()</c> reverse-map runs per <c>PRINT</c>
    /// fragment (adversarial-review I1) — the CPU id is resolved once, later,
    /// only when a block completes. In tests the key can be any stable object
    /// (an <c>int</c>, a sentinel) — it is used purely as a dictionary key.</para>
    /// </summary>
    public sealed class KosComputeAccumulator
    {
        /// <summary>Per-screen buffer hard cap — a block that never closes can't grow the buffer past this.</summary>
        public const int MaxBufferChars = 64 * 1024;

        private readonly Dictionary<object, StringBuilder> _buffers = new Dictionary<object, StringBuilder>();

        // Matches ONE complete block (either a [KOSDATA] data block or an
        // explicit [KOSERROR] failure marker) and captures the index just past
        // its close, so we can drop everything up to and including the last
        // consumed block. The [KOSDATA] half is the same grammar as
        // KosDataParser.BlockRe; [KOSERROR] is new here — the mod-side mirror
        // of the telnet path's KosComputeSession.parseKosExplicitError, needed
        // so kos.run can reject a call the same way the telnet RPC did (see
        // kos-uplink-full-migration.md). Alternation order matters: an error
        // group match takes the "errorBody" branch, a data group match takes
        // "topic"/"dataBody" — exactly one side's groups succeed per match.
        private static readonly Regex BlockRe = new Regex(
            @"\[KOSERROR\](?<errorBody>[\s\S]*?)\[/KOSERROR\]" +
            @"|\[KOSDATA(?::(?<topic>[\w-]+))?\](?<dataBody>[\s\S]*?)\[/KOSDATA\]",
            RegexOptions.Compiled);

        /// <summary>
        /// Appends one <c>PRINT</c> fragment for <paramref name="coreId"/> and
        /// returns every <c>[KOSDATA]</c> block that is NOW complete (usually
        /// zero or one; more if several closed in this fragment). Consumed
        /// text up to the end of the last complete block is dropped from the
        /// buffer; any trailing partial (an opened-but-unclosed block) is
        /// retained for the next fragment.
        /// </summary>
        public IReadOnlyList<KosComputeBlock> Append(object screen, string text)
        {
            var blocks = new List<KosComputeBlock>();
            if (screen == null || string.IsNullOrEmpty(text))
            {
                return blocks;
            }

            if (!_buffers.TryGetValue(screen, out var buffer))
            {
                buffer = new StringBuilder();
                _buffers[screen] = buffer;
            }

            buffer.Append(KosDataParser.StripAnsi(text));

            var current = buffer.ToString();
            var lastEnd = -1;
            foreach (Match m in BlockRe.Matches(current))
            {
                if (m.Groups["errorBody"].Success)
                {
                    blocks.Add(KosComputeBlock.ForError(m.Groups["errorBody"].Value));
                }
                else
                {
                    var topic = m.Groups["topic"].Success ? m.Groups["topic"].Value : KosDataParser.DefaultTopic;
                    var fields = KosDataParser.ParseBody(m.Groups["dataBody"].Value);
                    blocks.Add(new KosComputeBlock(topic, fields));
                }
                lastEnd = m.Index + m.Length;
            }

            if (lastEnd >= 0)
            {
                buffer.Remove(0, lastEnd);
            }
            else if (buffer.Length > MaxBufferChars)
            {
                // No block closed and the buffer is oversized — drop the
                // oldest half. Keep the tail: a partial [KOSDATA that is still
                // open is likelier near the end than the start.
                buffer.Remove(0, buffer.Length / 2);
            }

            return blocks;
        }

        /// <summary>Discards the buffer for a screen that has left (unload / scene change) — call from the main thread.</summary>
        public void Forget(object screen) => _buffers.Remove(screen);

        /// <summary>Discards every buffer.</summary>
        public void Clear() => _buffers.Clear();
    }
}
