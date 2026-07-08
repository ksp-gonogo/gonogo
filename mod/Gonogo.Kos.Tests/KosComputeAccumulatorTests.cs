using System.Linq;
using Gonogo.Kos;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Headless tests for the per-CPU <c>[KOSDATA]</c> accumulator — the piece
    /// that turns the postfix's <c>PRINT</c> fragment stream into completed
    /// blocks (spec §4(b)). Covers split-across-fragments assembly, per-CPU
    /// isolation, multi-block fragments, and the runaway-buffer bound.
    /// </summary>
    public class KosComputeAccumulatorTests
    {
        [Fact]
        public void Append_CompleteBlockInOneFragment_EmitsOnce()
        {
            var acc = new KosComputeAccumulator();

            var blocks = acc.Append(7, "[KOSDATA:t]v=1[/KOSDATA]").ToList();

            var block = Assert.Single(blocks);
            // CoreId is no longer known to the accumulator (keyed by screen ref,
            // not CPU id) — it is stamped by OnPrint on completion, so it stays
            // at the -1 sentinel here.
            Assert.Equal(-1, block.CoreId);
            Assert.Equal("t", block.Topic);
            Assert.Equal(1.0, block.Fields["v"]);
        }

        [Fact]
        public void Append_BlockSplitAcrossFragments_EmitsWhenClosed()
        {
            var acc = new KosComputeAccumulator();

            Assert.Empty(acc.Append(1, "[KOSDATA:t]par"));
            Assert.Empty(acc.Append(1, "ts=[];cou"));
            var blocks = acc.Append(1, "nt=2[/KOSDATA]").ToList();

            var block = Assert.Single(blocks);
            Assert.Equal("[]", block.Fields["parts"]);
            Assert.Equal(2.0, block.Fields["count"]);
        }

        [Fact]
        public void Append_DifferentScreens_AreIsolated()
        {
            var acc = new KosComputeAccumulator();

            // Distinct screen keys (here plain ints as opaque stand-ins for two
            // different ScreenBuffer references) buffer independently.
            var screenA = new object();
            var screenB = new object();

            Assert.Empty(acc.Append(screenA, "[KOSDATA:a]x=1"));
            Assert.Empty(acc.Append(screenB, "[KOSDATA:b]y=2"));

            var one = acc.Append(screenA, "[/KOSDATA]").ToList();
            var two = acc.Append(screenB, "[/KOSDATA]").ToList();

            Assert.Equal("a", Assert.Single(one).Topic);
            Assert.Equal("b", Assert.Single(two).Topic);
        }

        [Fact]
        public void Append_MultipleBlocksInOneFragment_EmitsAll()
        {
            var acc = new KosComputeAccumulator();

            var blocks = acc.Append(3,
                "[KOSDATA:a]x=1[/KOSDATA][KOSDATA:b]y=2[/KOSDATA]").ToList();

            Assert.Equal(2, blocks.Count);
            Assert.Equal("a", blocks[0].Topic);
            Assert.Equal("b", blocks[1].Topic);
        }

        [Fact]
        public void Append_ConsumesPrefix_LeftoverPartialSurvives()
        {
            var acc = new KosComputeAccumulator();

            // One complete block plus the start of the next in a single call.
            var first = acc.Append(5, "[KOSDATA:a]x=1[/KOSDATA][KOSDATA:b]y=").ToList();
            Assert.Equal("a", Assert.Single(first).Topic);

            // The retained partial completes on the next fragment.
            var second = acc.Append(5, "2[/KOSDATA]").ToList();
            Assert.Equal("b", Assert.Single(second).Topic);
            Assert.Equal(2.0, second[0].Fields["y"]);
        }

        [Fact]
        public void Append_RunawayUnclosedBuffer_IsBoundedAndStillParsesAfterClose()
        {
            var acc = new KosComputeAccumulator();

            // Never-closing junk far exceeding the cap — must not throw or leak.
            var junk = new string('x', KosComputeAccumulator.MaxBufferChars + 5000);
            Assert.Empty(acc.Append(9, junk));

            // A real block still parses once it finally arrives.
            var blocks = acc.Append(9, "[KOSDATA:t]v=1[/KOSDATA]").ToList();
            Assert.Equal(1.0, Assert.Single(blocks).Fields["v"]);
        }

        [Fact]
        public void Forget_DropsBufferedPartial()
        {
            var acc = new KosComputeAccumulator();

            Assert.Empty(acc.Append(1, "[KOSDATA:a]x=1"));
            acc.Forget(1);

            // The closing marker alone can't complete a block the buffer forgot.
            Assert.Empty(acc.Append(1, "[/KOSDATA]"));
        }
    }
}
