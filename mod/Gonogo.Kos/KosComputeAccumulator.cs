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
        public int CoreId { get; }
        public string Topic { get; }
        public IReadOnlyDictionary<string, object> Fields { get; }

        public KosComputeBlock(int coreId, string topic, IReadOnlyDictionary<string, object> fields)
        {
            CoreId = coreId;
            Topic = topic;
            Fields = fields;
        }
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
    /// </summary>
    public sealed class KosComputeAccumulator
    {
        /// <summary>Per-CPU buffer hard cap — a block that never closes can't grow the buffer past this.</summary>
        public const int MaxBufferChars = 64 * 1024;

        private readonly Dictionary<int, StringBuilder> _buffers = new Dictionary<int, StringBuilder>();

        // Matches ONE complete block and captures the index just past its
        // close, so we can drop everything up to and including the last
        // consumed block. Same grammar as KosDataParser.BlockRe.
        private static readonly Regex BlockRe = new Regex(
            @"\[KOSDATA(?::([\w-]+))?\]([\s\S]*?)\[/KOSDATA\]",
            RegexOptions.Compiled);

        /// <summary>
        /// Appends one <c>PRINT</c> fragment for <paramref name="coreId"/> and
        /// returns every <c>[KOSDATA]</c> block that is NOW complete (usually
        /// zero or one; more if several closed in this fragment). Consumed
        /// text up to the end of the last complete block is dropped from the
        /// buffer; any trailing partial (an opened-but-unclosed block) is
        /// retained for the next fragment.
        /// </summary>
        public IReadOnlyList<KosComputeBlock> Append(int coreId, string text)
        {
            var blocks = new List<KosComputeBlock>();
            if (string.IsNullOrEmpty(text))
            {
                return blocks;
            }

            if (!_buffers.TryGetValue(coreId, out var buffer))
            {
                buffer = new StringBuilder();
                _buffers[coreId] = buffer;
            }

            buffer.Append(KosDataParser.StripAnsi(text));

            var current = buffer.ToString();
            var lastEnd = -1;
            foreach (Match m in BlockRe.Matches(current))
            {
                var topic = m.Groups[1].Success ? m.Groups[1].Value : KosDataParser.DefaultTopic;
                var fields = KosDataParser.ParseBody(m.Groups[2].Value);
                blocks.Add(new KosComputeBlock(coreId, topic, fields));
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

        /// <summary>Discards the buffer for a CPU that has left (unload / scene change) — call from the main thread.</summary>
        public void Forget(int coreId) => _buffers.Remove(coreId);

        /// <summary>Discards every buffer.</summary>
        public void Clear() => _buffers.Clear();
    }
}
