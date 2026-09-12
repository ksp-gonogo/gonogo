using Gonogo.RealAntennasUplink;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The fallback walk's decision, every branch of it, headlessly.
    ///
    /// <para>It is worth pinning harder than most decisions in this Uplink
    /// because nothing else will notice it being wrong. A single-target press has
    /// an operator watching the result; a chain acts on its own, minutes of
    /// light-time away, and the two ways it can fail quietly are opposites: a
    /// walk that never moves leaves a craft dark while reporting a fallback, and
    /// a walk that moves too eagerly slews a dish off the link it already
    /// had.</para>
    /// </summary>
    public class RaChainPolicyTests
    {
        private static RaChainPolicy.Walk Walk(int? activeStep = null, double? lastAppliedUt = null, int laps = 0) =>
            new RaChainPolicy.Walk { ActiveStep = activeStep, LastAppliedUt = lastAppliedUt, Laps = laps };

        [Fact]
        public void AConnectedCraftIsLeftAlone()
        {
            var decision = RaChainPolicy.Decide(Walk(activeStep: 2, lastAppliedUt: 0.0), 3, true, 10_000.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Hold, decision.Move);
            Assert.Equal(RaChainPolicy.StateHolding, decision.State);
        }

        /// <summary>
        /// The preference is not worth the link. A craft connected on the last
        /// entry must not be pulled back to the first one just because the first
        /// one is preferred, because the slew costs the link it currently has.
        /// </summary>
        [Fact]
        public void AConnectedCraftIsNotPulledBackToThePreferredEntry()
        {
            var walk = Walk(activeStep: 2, lastAppliedUt: 0.0);

            var decision = RaChainPolicy.Decide(walk, 3, true, 1_000_000.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Hold, decision.Move);
            Assert.Equal(2, walk.ActiveStep);
        }

        [Fact]
        public void AFreshLossStartsAtTheFirstEntry()
        {
            var decision = RaChainPolicy.Decide(Walk(), 3, false, 100.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Apply, decision.Move);
            Assert.Equal(0, decision.Step);
            Assert.Equal(RaChainPolicy.StateWalking, decision.State);
        }

        [Fact]
        public void AnEntryIsGivenItsSettleTimeBeforeItIsJudged()
        {
            var decision = RaChainPolicy.Decide(Walk(activeStep: 0, lastAppliedUt: 100.0), 3, false, 120.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Settle, decision.Move);
            Assert.Equal(RaChainPolicy.StateSettling, decision.State);
        }

        [Fact]
        public void AnEntryThatHasHadItsTimeAndStillHasNoLinkIsPassedOver()
        {
            var decision = RaChainPolicy.Decide(Walk(activeStep: 0, lastAppliedUt: 100.0), 3, false, 131.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Apply, decision.Move);
            Assert.Equal(1, decision.Step);
        }

        /// <summary>
        /// Past the last entry the walk goes back to the first rather than
        /// stopping. A chain that stopped after one pass would leave the craft on
        /// a target already proven not to work, which is the one outcome an
        /// operator setting a fallback is trying to avoid.
        /// </summary>
        [Fact]
        public void PastTheLastEntryTheWalkWrapsRatherThanGivingUp()
        {
            var decision = RaChainPolicy.Decide(Walk(activeStep: 2, lastAppliedUt: 100.0), 3, false, 200.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Apply, decision.Move);
            Assert.Equal(0, decision.Step);
        }

        /// <summary>
        /// An unreadable link is a reason to do NOTHING, never a quiet "no". A
        /// walk that advanced on it would slew whichever dish might be the one
        /// carrying the link, on the strength of a read that never happened.
        /// </summary>
        [Fact]
        public void AnUnreadableLinkHoldsTheWalkAndSaysSo()
        {
            var decision = RaChainPolicy.Decide(Walk(), 3, null, 100.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Hold, decision.Move);
            Assert.Equal(RaChainPolicy.StateBlocked, decision.State);
            Assert.NotNull(decision.Detail);
        }

        [Fact]
        public void AChainWithNoEntriesIsBlockedRatherThanWalking()
        {
            var decision = RaChainPolicy.Decide(Walk(), 0, false, 100.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Hold, decision.Move);
            Assert.Equal(RaChainPolicy.StateBlocked, decision.State);
        }

        /// <summary>
        /// A clock that went backwards is what a revert or a load does. The entry
        /// in place has effectively just been applied, so it gets its settle time
        /// again rather than being judged against a moment in another timeline.
        /// </summary>
        [Fact]
        public void AClockThatWentBackwardsRestartsTheSettleRatherThanAdvancing()
        {
            var decision = RaChainPolicy.Decide(Walk(activeStep: 1, lastAppliedUt: 5_000.0), 3, false, 100.0, 30.0);

            Assert.Equal(RaChainPolicy.Move.Settle, decision.Move);
        }

        [Fact]
        public void ALapIsCountedOnlyWhenTheWalkWrapsBackToTheFirstEntry()
        {
            var walk = Walk(activeStep: 2, lastAppliedUt: 100.0);

            RaChainPolicy.RecordApplied(walk, 0, 3, 200.0);

            Assert.Equal(0, walk.ActiveStep);
            Assert.Equal(200.0, walk.LastAppliedUt);
            Assert.Equal(1, walk.Laps);
        }

        /// <summary>
        /// The FIRST application is not a lap. It is the walk starting, and
        /// counting it would report a chain as having been all the way round
        /// before it had tried anything.
        /// </summary>
        [Fact]
        public void TheFirstApplicationOfAWalkIsNotALap()
        {
            var walk = Walk();

            RaChainPolicy.RecordApplied(walk, 0, 3, 200.0);

            Assert.Equal(0, walk.Laps);
        }

        /// <summary>
        /// A one-entry chain is re-applied rather than counted round and round. It
        /// is a legitimate chain (one preferred target, retried), and a lap count
        /// climbing once per settle window would read as a search.
        /// </summary>
        [Fact]
        public void AOneEntryChainDoesNotAccumulateLaps()
        {
            var walk = Walk(activeStep: 0, lastAppliedUt: 100.0);

            RaChainPolicy.RecordApplied(walk, 0, 1, 200.0);

            Assert.Equal(0, walk.Laps);
        }

        [Fact]
        public void RegainingTheLinkClearsTheLapTally()
        {
            var walk = Walk(activeStep: 1, lastAppliedUt: 100.0, laps: 4);

            RaChainPolicy.NoteConnected(walk);

            Assert.Equal(0, walk.Laps);
        }

        /// <summary>
        /// Deciding must not MOVE the walk. The chain channel describes it every
        /// tick, so a describe that mutated would make the reported numbers depend
        /// on who happened to be subscribed.
        /// </summary>
        [Fact]
        public void DecidingNeverWritesTheWalk()
        {
            var walk = Walk(activeStep: 1, lastAppliedUt: 100.0, laps: 3);

            RaChainPolicy.Decide(walk, 3, true, 10_000.0, 30.0);
            RaChainPolicy.Decide(walk, 3, false, 10_000.0, 30.0);
            RaChainPolicy.Decide(walk, 3, null, 10_000.0, 30.0);

            Assert.Equal(1, walk.ActiveStep);
            Assert.Equal(100.0, walk.LastAppliedUt);
            Assert.Equal(3, walk.Laps);
        }

        [Fact]
        public void AnAbsentSettleRequestTakesTheDefault() =>
            Assert.Equal(RaChainPolicy.DefaultSettleSeconds, RaChainPolicy.SettleSecondsFor(null));

        /// <summary>
        /// A settle of zero would slew the dish every tick the craft was dark, so
        /// the request is clamped rather than honoured. The clamp is what stands
        /// between a chain and a network re-solve per frame.
        /// </summary>
        [Fact]
        public void ASettleRequestIsClampedRatherThanHonouredAllTheWayToZero()
        {
            Assert.Equal(RaChainPolicy.MinimumSettleSeconds, RaChainPolicy.SettleSecondsFor(0.0));
            Assert.Equal(RaChainPolicy.MinimumSettleSeconds, RaChainPolicy.SettleSecondsFor(-5.0));
        }

        /// <summary>
        /// A non-finite settle is read as no request at all. It arrives as a
        /// double off the wire, and a NaN compared against an elapsed time is
        /// false both ways, which would make the walk advance every tick.
        /// </summary>
        [Fact]
        public void ANonFiniteSettleRequestFallsBackToTheDefault()
        {
            Assert.Equal(RaChainPolicy.DefaultSettleSeconds, RaChainPolicy.SettleSecondsFor(double.NaN));
            Assert.Equal(RaChainPolicy.DefaultSettleSeconds, RaChainPolicy.SettleSecondsFor(double.PositiveInfinity));
        }
    }
}
