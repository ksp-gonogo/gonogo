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

        /// <summary>
        /// Multiple-subscriber-aware stand-in for the production
        /// <c>host.SubscriberCountFor(topic)</c> read. Deliberately exposes
        /// the same <c>Add</c>/<c>Remove</c> call shape a plain
        /// <c>HashSet&lt;int&gt;</c> would (so every pre-existing
        /// single-subscriber test — one <c>Add</c>, one <c>Remove</c> —
        /// keeps compiling and behaving identically) while ALSO letting a
        /// test model a second simultaneous subscriber by calling
        /// <c>Add</c> twice for the same id.
        /// </summary>
        private sealed class SubscriberCounter
        {
            private readonly Dictionary<int, int> _counts = new Dictionary<int, int>();

            public void Add(int id) => _counts[id] = _counts.TryGetValue(id, out var c) ? c + 1 : 1;

            public void Remove(int id)
            {
                if (!_counts.TryGetValue(id, out var c) || c <= 0)
                {
                    return;
                }
                if (c <= 1)
                {
                    _counts.Remove(id);
                }
                else
                {
                    _counts[id] = c - 1;
                }
            }

            public int CountFor(int id) => _counts.TryGetValue(id, out var c) ? c : 0;
        }

        private sealed class Harness
        {
            public List<int> CoreIds = new List<int> { 7 };
            public SubscriberCounter Subscribed = new SubscriberCounter();
            public readonly Dictionary<int, FakeScreen> Screens = new Dictionary<int, FakeScreen>();
            public readonly List<KosTerminalFrame> Published = new List<KosTerminalFrame>();
            public readonly List<double> PublishedUts = new List<double>();
            // Constant by default: reproduces production's "the terminal's
            // ~20Hz poll runs faster than the UT source advances" shape —
            // see KosTerminalCourierBurstTests for the end-to-end proof this
            // matters for.
            public double Now;
            public readonly KosTerminalManager Manager;

            public Harness()
            {
                Manager = new KosTerminalManager(
                    knownCoreIds: () => CoreIds,
                    subscriberCount: id => Subscribed.CountFor(id),
                    publish: (id, frame, ut) =>
                    {
                        Published.Add(frame);
                        PublishedUts.Add(ut);
                    },
                    createScreen: id =>
                    {
                        if (!Screens.TryGetValue(id, out var s))
                        {
                            s = new FakeScreen();
                            Screens[id] = s;
                        }
                        return s;
                    },
                    nowUt: () => Now,
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
        public void Poll_SecondSubscriberJoiningAnAlreadySubscribedCpu_AlsoForcesAFullRepaint()
        {
            // Root cause #2: the reseed decision was a 0->1 AGGREGATE
            // transition for the whole CPU (host.IsAnyTopicSubscribed),
            // sampled once per poll. A second, simultaneous viewer never
            // saw that transition — the aggregate was already "subscribed"
            // — so their fresh xterm got incremental diffs onto a blank
            // canvas instead of a full-repaint baseline.
            var h = new Harness();

            // Subscriber A joins; gets the expected full repaint.
            h.Subscribed.Add(7);
            h.Tick();
            Assert.Single(h.Published.FindAll(f => f.FullRepaint));

            // Subscriber B joins the SAME CPU while A is still attached —
            // the aggregate "is CPU 7 subscribed at all" was already true,
            // so this must be recognised as a genuinely new subscriber
            // (not a no-op) and force another full repaint for B's benefit.
            h.Subscribed.Add(7);
            h.Tick();

            var repaints = h.Published.FindAll(f => f.FullRepaint);
            Assert.Equal(2, repaints.Count);
        }

        [Fact]
        public void Poll_BurstWithConstantNowUt_AssignsStrictlyIncreasingUts()
        {
            // Regression for root cause #1 (see KosTerminalCourierBurstTests
            // for the full Courier-backed proof of the delivery bug this
            // guards against): the injected UT source can return the SAME
            // value across several consecutive polls (its own clock hasn't
            // ticked yet) — every published frame must still get a
            // strictly-increasing UT so no two collide once they reach the
            // Courier/Archive delay engine.
            var h = new Harness();
            h.Subscribed.Add(7);
            h.Now = 500.0;

            h.Tick();
            h.Tick();
            h.Tick();

            Assert.Equal(3, h.PublishedUts.Count);
            Assert.True(h.PublishedUts[0] < h.PublishedUts[1]);
            Assert.True(h.PublishedUts[1] < h.PublishedUts[2]);
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
