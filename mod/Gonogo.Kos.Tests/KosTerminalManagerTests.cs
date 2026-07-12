using System.Collections.Generic;
using Gonogo.Kos;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Headless coverage of <see cref="KosTerminalManager"/> — the lease
    /// arbitration, the reject-with-notification rule (Q-P3-2), and the
    /// subscription-gated downlink poll (full-repaint on open / new subscriber,
    /// diffs otherwise, silence when unwatched). The kOS screen is faked via
    /// <see cref="FakeScreen"/> so no live KSP/Unity process is needed — exactly
    /// the split that keeps the manager free of kOS types.
    /// </summary>
    public class KosTerminalManagerTests
    {
        private sealed class FakeScreen : IKosTerminalScreen
        {
            public readonly List<string> Typed = new List<string>();
            public (int Cols, int Rows)? LastResize;
            public readonly List<bool> ReseedCalls = new List<bool>();
            public bool ReturnOutput = true;
            public bool CanType = true;
            public string Chunk = "out";

            public TerminalReadResult ReadChunk(bool forceReseed)
            {
                ReseedCalls.Add(forceReseed);
                return ReturnOutput
                    ? TerminalReadResult.Output(Chunk, forceReseed)
                    : TerminalReadResult.None;
            }

            public bool TypeChars(string chars)
            {
                if (!CanType)
                {
                    return false;
                }
                Typed.Add(chars);
                return true;
            }

            public void Resize(int cols, int rows) => LastResize = (cols, rows);
        }

        private sealed class Harness
        {
            public List<int> CoreIds = new List<int> { 7 };
            public HashSet<int> Subscribed = new HashSet<int>();
            public readonly Dictionary<int, FakeScreen> Screens = new Dictionary<int, FakeScreen>();
            public readonly List<KosTerminalFrame> Published = new List<KosTerminalFrame>();
            public readonly KosTerminalManager Manager;

            public Harness()
            {
                Manager = new KosTerminalManager(
                    knownCoreIds: () => CoreIds,
                    isSubscribed: id => Subscribed.Contains(id),
                    publish: (id, frame) => Published.Add(frame),
                    createScreen: id =>
                    {
                        if (!Screens.TryGetValue(id, out var s))
                        {
                            s = new FakeScreen();
                            Screens[id] = s;
                        }
                        return s;
                    },
                    pollIntervalSeconds: 0.05);
            }

            public void Tick() => Manager.Poll(1.0);
        }

        // ---- Lease ----

        [Fact]
        public void Open_GrantsLease_ThenSameTokenIsIdempotent()
        {
            var h = new Harness();
            Assert.True(h.Manager.Open(7, "tokenA").Success);
            Assert.True(h.Manager.Open(7, "tokenA").Success);
        }

        [Fact]
        public void Open_ByDifferentToken_IsRejected_NotStolen()
        {
            var h = new Harness();
            Assert.True(h.Manager.Open(7, "tokenA").Success);

            var second = h.Manager.Open(7, "tokenB");
            Assert.False(second.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, second.ErrorCode);

            // The original holder still owns the lease (no silent steal).
            Assert.True(h.Manager.Keystroke(7, "tokenA", "x").Success);
            Assert.False(h.Manager.Keystroke(7, "tokenB", "x").Success);
        }

        [Fact]
        public void Open_UnknownCpu_IsNotFound()
        {
            var h = new Harness();
            var r = h.Manager.Open(99, "tokenA");
            Assert.False(r.Success);
            Assert.Equal(CommandErrorCode.NotFound, r.ErrorCode);
        }

        [Fact]
        public void Keystroke_OnlyLeaseHolderMayType()
        {
            var h = new Harness();
            h.Manager.Open(7, "tokenA");

            Assert.True(h.Manager.Keystroke(7, "tokenA", "ls.").Success);
            Assert.Equal(new[] { "ls." }, h.Screens[7].Typed);

            var reject = h.Manager.Keystroke(7, "wrong", "x");
            Assert.False(reject.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, reject.ErrorCode);
            Assert.Single(h.Screens[7].Typed);
        }

        [Fact]
        public void Keystroke_WhenScreenRefusesInput_IsModeUnavailable()
        {
            var h = new Harness();
            h.Manager.Open(7, "tokenA");
            h.Screens[7].CanType = false;

            var r = h.Manager.Keystroke(7, "tokenA", "x");
            Assert.False(r.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, r.ErrorCode);
        }

        [Fact]
        public void Resize_HolderResizes_NonHolderRejected()
        {
            var h = new Harness();
            h.Manager.Open(7, "tokenA");

            Assert.True(h.Manager.Resize(7, "tokenA", 80, 24).Success);
            Assert.Equal((80, 24), h.Screens[7].LastResize);

            Assert.False(h.Manager.Resize(7, "nope", 100, 40).Success);
        }

        [Fact]
        public void Close_ReleasesLease_SoAnotherTokenCanOpen()
        {
            var h = new Harness();
            h.Manager.Open(7, "tokenA");
            Assert.True(h.Manager.Close(7, "tokenA").Success);

            // Lease is free — a different token may now acquire it.
            Assert.True(h.Manager.Open(7, "tokenB").Success);
            Assert.True(h.Manager.Keystroke(7, "tokenB", "x").Success);
        }

        [Fact]
        public void Close_WithWrongToken_DoesNotRelease()
        {
            var h = new Harness();
            h.Manager.Open(7, "tokenA");
            Assert.True(h.Manager.Close(7, "wrong").Success); // no-op ack

            // Original holder still owns it; the wrong closer can't open over it.
            Assert.False(h.Manager.Open(7, "other").Success);
            Assert.True(h.Manager.Keystroke(7, "tokenA", "x").Success);
        }

        // ---- Downlink poll ----

        [Fact]
        public void Poll_UnsubscribedCpu_PublishesNothing()
        {
            var h = new Harness();
            h.Tick();
            Assert.Empty(h.Published);
        }

        [Fact]
        public void Poll_SubscribedCpu_PublishesFullRepaintFirst_ThenDiffs()
        {
            var h = new Harness();
            h.Subscribed.Add(7);

            h.Tick();
            Assert.Single(h.Published);
            Assert.True(h.Published[0].FullRepaint);
            Assert.Equal(7, h.Published[0].CoreId);
            Assert.Equal("out", h.Published[0].Chunk);

            h.Tick();
            Assert.Equal(2, h.Published.Count);
            Assert.False(h.Published[1].FullRepaint);
        }

        [Fact]
        public void Poll_NoChange_PublishesNothing()
        {
            var h = new Harness();
            h.Subscribed.Add(7);
            h.Screens[7] = new FakeScreen { ReturnOutput = false };

            h.Tick();
            Assert.Empty(h.Published);
        }

        [Fact]
        public void Poll_NewSubscriberEdge_ForcesAFreshFullRepaint()
        {
            var h = new Harness();

            // Subscribe, poll (full repaint), unsubscribe, resubscribe.
            h.Subscribed.Add(7);
            h.Tick();
            h.Subscribed.Remove(7);
            h.Tick();
            h.Subscribed.Add(7);
            h.Tick();

            var repaints = h.Published.FindAll(f => f.FullRepaint);
            Assert.Equal(2, repaints.Count); // first open + the re-subscribe edge
        }

        [Fact]
        public void Poll_SubThreshold_DoesNotPublish()
        {
            var h = new Harness();
            h.Subscribed.Add(7);
            h.Manager.Poll(0.01); // below the 0.05s cadence
            Assert.Empty(h.Published);
        }

        [Fact]
        public void Poll_DropsLeaseWhenCpuDisappears()
        {
            var h = new Harness();
            h.Manager.Open(7, "tokenA");
            h.Subscribed.Add(7);
            h.Tick();

            // CPU 7 vanishes (vessel unload).
            h.CoreIds = new List<int>();
            h.Tick();

            // CPU 7 comes back — the stale lease is gone, so a new token opens.
            h.CoreIds = new List<int> { 7 };
            Assert.True(h.Manager.Open(7, "tokenB").Success);
        }
    }
}
