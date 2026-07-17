using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.KosUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// Headless tests for the compute capture hot path
    /// (<see cref="KosExtension.OnPrint"/>) — the adversarial-review I1 fix.
    /// <see cref="KosExtension.Register"/> needs a live kOS/Unity process (the
    /// version guard + Harmony install), so these wire the compute source, the
    /// subscription gate, and the CPU reverse-map directly via the internal test
    /// seams instead — no KSP, no Unity, no <c>kOSProcessor.AllInstances()</c>.
    /// </summary>
    public class KosExtensionOnPrintTests
    {
        // Counts calls to the CPU reverse-map so a test can prove OnPrint does
        // NOT resolve the owning CPU per PRINT fragment — only on block close.
        private sealed class CoreIdCounter
        {
            public int Calls;
            public int Resolve(object screen)
            {
                Calls++;
                return 42;
            }
        }

        private sealed class RecordingChannelSource : IDynamicChannelSource
        {
            public readonly List<(string sub, object? value)> Published = new();
            private readonly Dictionary<string, RecordingPublisher> _pubs = new();

            public IChannelPublisher Publisher(string subTopic)
            {
                if (!_pubs.TryGetValue(subTopic, out var p))
                {
                    p = new RecordingPublisher(subTopic, Published);
                    _pubs[subTopic] = p;
                }
                return p;
            }

            public void OnSubscribed(Action<string> callback)
            {
                // Not exercised by the OnPrint compute-hot-path tests this
                // fake serves — nothing here subscribes to kos.compute.*.
            }
        }

        private sealed class RecordingPublisher : IChannelPublisher
        {
            private readonly string _sub;
            private readonly List<(string, object?)> _sink;
            public RecordingPublisher(string sub, List<(string, object?)> sink)
            {
                _sub = sub;
                _sink = sink;
            }
            public void Publish(object? payload, double ut) => _sink.Add((_sub, payload));
        }

        private static KosExtension NewExtension(RecordingChannelSource source, CoreIdCounter counter, Func<bool> subscribed)
        {
            // Internal ctor with a real (never-drained) dispatcher and a no-op
            // addon binder — nothing here touches Unity.
            var ext = new KosExtension(new MainThreadDispatcher(), _ => { });
            ext.WireComputeForTests(source, subscribed);
            ext.CoreIdResolver = counter.Resolve;
            return ext;
        }

        [Fact]
        public void OnPrint_FragmentsThatDoNotCloseABlock_NeverResolveTheCpu()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => true);
            var screen = new object();

            // Ordinary terminal output and a still-open block: many fragments,
            // no completed [KOSDATA] — the CPU reverse-map (AllInstances) must
            // not run once (I1: no per-fragment allocation on the main thread).
            ext.OnPrint(screen, "just some terminal chatter\n");
            ext.OnPrint(screen, "[KOSDATA:feed]par");
            ext.OnPrint(screen, "ts=[];cou");
            ext.OnPrint(screen, "nt=3");

            Assert.Equal(0, counter.Calls);
            Assert.Empty(source.Published);
        }

        [Fact]
        public void OnPrint_CompletedBlock_ResolvesCpuOnceAndPublishesFields()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => true);
            var screen = new object();

            // Build a block across fragments, then close it in one final call.
            ext.OnPrint(screen, "[KOSDATA:feed]par");
            ext.OnPrint(screen, "ts=[];cou");
            Assert.Equal(0, counter.Calls);

            ext.OnPrint(screen, "nt=3[/KOSDATA]");

            // Exactly one reverse-map call for the whole completed block.
            Assert.Equal(1, counter.Calls);
            Assert.Contains(("feed.parts", (object?)"[]"), source.Published);
            Assert.Contains(("feed.count", (object?)3.0), source.Published);
        }

        [Fact]
        public void OnPrint_MultipleBlocksInOneFragment_ResolvesCpuOnce()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => true);

            ext.OnPrint(new object(), "[KOSDATA:a]x=1[/KOSDATA][KOSDATA:b]y=2[/KOSDATA]");

            // Two blocks closed in one PRINT — still a single CPU resolve.
            Assert.Equal(1, counter.Calls);
            Assert.Contains(("a.x", (object?)1.0), source.Published);
            Assert.Contains(("b.y", (object?)2.0), source.Published);
        }

        [Fact]
        public void OnPrint_NoComputeSubscribers_ShortCircuitsWithNoCpuResolveNoPublish()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => false);
            var screen = new object();

            // A fully-formed block, but nobody is subscribed under kos.compute.*
            // — OnPrint must bail before accumulate/resolve/publish (I1).
            ext.OnPrint(screen, "[KOSDATA:feed]v=1[/KOSDATA]");

            Assert.Equal(0, counter.Calls);
            Assert.Empty(source.Published);

            // And once a subscriber appears, the SAME extension resumes capture
            // (the gate is a pure early-out, not a latch).
            var live = new bool[] { true };
            ext.WireComputeForTests(source, () => live[0]);
            ext.OnPrint(screen, "[KOSDATA:feed]v=2[/KOSDATA]");

            Assert.Equal(1, counter.Calls);
            Assert.Contains(("feed.v", (object?)2.0), source.Published);
        }

        // --- kos.run routing (kos-uplink-full-migration.md) ---------------

        [Fact]
        public void OnPrint_ArmedRun_RoutesTheCompletedBlockToTheRunManagerNotCompute()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => true);
            var runResults = new List<(int coreId, KosRunResult result)>();
            ext.WireRunForTests((coreId, result) => runResults.Add((coreId, result)));
            Assert.True(ext.ArmRunForTests(42, "req-1"));
            var screen = new object();

            ext.OnPrint(screen, "[KOSDATA]v=1[/KOSDATA]");

            // CoreIdCounter.Resolve always returns 42 — matches the armed CPU.
            var (coreId, result) = Assert.Single(runResults);
            Assert.Equal(42, coreId);
            Assert.Equal("req-1", result.RequestId);
            Assert.NotNull(result.Fields);
            Assert.Equal(1.0, result.Fields!["v"]);

            // The block went to the run manager, NOT the compute fanout.
            Assert.Empty(source.Published);
        }

        [Fact]
        public void OnPrint_ArmedRun_ExplicitKosErrorBlock_RoutesAsAnErrorResult()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => true);
            var runResults = new List<KosRunResult>();
            ext.WireRunForTests((_, result) => runResults.Add(result));
            ext.ArmRunForTests(42, "req-1");

            ext.OnPrint(new object(), "[KOSERROR]engine flameout[/KOSERROR]");

            var result = Assert.Single(runResults);
            Assert.Null(result.Fields);
            Assert.Equal("engine flameout", result.Error);
        }

        [Fact]
        public void OnPrint_NoArmedRunForThatCpu_StillFansOutToCompute()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => true);
            var runResults = new List<KosRunResult>();
            ext.WireRunForTests((_, result) => runResults.Add(result));
            // No ArmRunForTests call — ordinary kos.compute / kos.exec path.

            ext.OnPrint(new object(), "[KOSDATA:feed]v=1[/KOSDATA]");

            Assert.Empty(runResults);
            Assert.Contains(("feed.v", (object?)1.0), source.Published);
        }

        [Fact]
        public void OnPrint_ArmedRunWithNoComputeSubscribers_StillAccumulatesAndCompletes()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            // No kos.compute.* subscriber — without the gate-widening fix this
            // would short-circuit before accumulation ever ran, and the
            // caller's kos.run promise would hang forever.
            var ext = NewExtension(source, counter, () => false);
            var runResults = new List<KosRunResult>();
            ext.WireRunForTests((_, result) => runResults.Add(result));
            ext.ArmRunForTests(42, "req-1");

            ext.OnPrint(new object(), "[KOSDATA]v=1[/KOSDATA]");

            var result = Assert.Single(runResults);
            Assert.Equal(1.0, result.Fields!["v"]);
        }

        [Fact]
        public void OnPrint_NoArmedRunAndNoComputeSubscribers_StillShortCircuits()
        {
            var source = new RecordingChannelSource();
            var counter = new CoreIdCounter();
            var ext = NewExtension(source, counter, () => false);
            var runResults = new List<KosRunResult>();
            ext.WireRunForTests((_, result) => runResults.Add(result));

            // Neither gate is open — the original I1 short-circuit still
            // applies when nothing is armed and nobody subscribes.
            ext.OnPrint(new object(), "[KOSDATA]v=1[/KOSDATA]");

            Assert.Equal(0, counter.Calls);
            Assert.Empty(runResults);
            Assert.Empty(source.Published);
        }
    }
}
