using System;
using System.Collections.Generic;
using System.Linq;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The precondition protocol, driven against a plugin double that faults
    /// wherever the real one aborts.
    ///
    /// <para>What is under test is the PROTOCOL, not the plugin, and that is the
    /// point rather than a limitation. None of this can be run against a real
    /// Principia here, and the thing that would break in a real one is the order
    /// the calls are made in, which is exactly what a recording double can hold to
    /// account. Every case below is one of the four ways the native side aborts:
    /// an unknown guid, a vessel with no plan, an index that has gone out of range,
    /// and a handle that was replaced underneath us.</para>
    /// </summary>
    public class PrincipiaSourcingProtocolTests
    {
        private const string Guid = "vessel-1";

        private static (FakePrincipiaPlugin Plugin, FakePluginHandle Handle, PrincipiaSession Session)
            Bind(Action<FakePrincipiaPlugin>? arrange = null)
        {
            var plugin = new FakePrincipiaPlugin();
            arrange?.Invoke(plugin);
            var handle = new FakePluginHandle(plugin);
            Assert.True(
                PrincipiaSession.TryBind(plugin, handle, out var session, out var reason),
                reason);
            return (plugin, handle, session!);
        }

        private static PrincipiaFrame Frame(PrincipiaSession session)
        {
            Assert.True(session.TryBeginFrame(out var frame));
            return frame!;
        }

        private static List<string> Named(FakePrincipiaPlugin plugin, string name) =>
            plugin.Calls.Where(c => c == name || c.StartsWith(name + "(", StringComparison.Ordinal))
                .ToList();

        // ---- The version gate -------------------------------------------------

        [Fact]
        public void TheAnalysedBuildBinds()
        {
            var (plugin, _, session) = Bind();

            Assert.Equal(PrincipiaSession.AnalysedPluginVersion, session.Version);
            Assert.Equal(new[] { "GetVersion" }, plugin.Calls);
        }

        [Fact]
        public void AnUnanalysedBuildPublishesNothingAndSaysWhatItFound()
        {
            var plugin = new FakePrincipiaPlugin { Version = "2026091100-Something-Else-0-gdeadbeef" };

            var bound = PrincipiaSession.TryBind(
                plugin, new FakePluginHandle(plugin), out var session, out var reason);

            Assert.False(bound);
            Assert.Null(session);
            // The reason carries all three of Principia's version out-params, not
            // only the one compared. A gate keyed to the wrong field refuses every
            // build forever and reports it as ordinary caution; the observed values
            // are the only thing that would ever say so.
            Assert.Contains("2026091100-Something-Else-0-gdeadbeef", reason);
            Assert.Contains("2026-08-12T17:36:45Z", reason);
            Assert.Contains("Linux x86-64", reason);
            // Nothing beyond the version probe was attempted.
            Assert.Equal(new[] { "GetVersion" }, plugin.Calls);
        }

        [Fact]
        public void AVersionThatCannotBeReadFailsClosed()
        {
            var plugin = new FakePrincipiaPlugin { VersionReadable = false };

            var bound = PrincipiaSession.TryBind(
                plugin, new FakePluginHandle(plugin), out var session, out var reason);

            Assert.False(bound);
            Assert.Null(session);
            Assert.Contains("could not be read", reason);
        }

        /// <summary>
        /// The two version strings are DIFFERENT things and folding them into one
        /// constant is a mistake that fails closed, which reads as caution and is a
        /// permanent outage.
        ///
        /// <para>The managed adapter's assembly file version is
        /// <c>2026.08.12.215</c>; the native plugin's own <c>GetVersion</c> answers
        /// a git description ending in the commit sha. The per-call abort analysis
        /// was carried out against that COMMIT, so the commit is what the gate
        /// pins.</para>
        /// </summary>
        [Fact]
        public void ThePluginVersionIsNotTheAdapterAssemblyVersion()
        {
            Assert.NotEqual(
                PrincipiaVersionGuard.ObservedAdapterVersion,
                PrincipiaSession.AnalysedPluginVersion);
            Assert.Contains("Levi-Civita", PrincipiaSession.AnalysedPluginVersion);
        }

        // ---- The frame --------------------------------------------------------

        [Fact]
        public void NoPluginMeansNoFrame()
        {
            var (plugin, handle, session) = Bind();
            handle.Absent = true;

            Assert.False(session.TryBeginFrame(out var frame));
            Assert.Null(frame);
            Assert.Equal(new[] { "GetVersion" }, plugin.Calls);
        }

        [Fact]
        public void AGateIsDeadOnceItsFrameIsDisposed()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid));
            PrincipiaVesselGate stale;
            using (var frame = Frame(session))
            {
                Assert.True(frame.TryVessel(Guid, out stale));
            }

            Assert.Throws<PrincipiaProtocolException>(() => stale.Velocity());
            Assert.Empty(Named(plugin, "VesselVelocity"));
        }

        [Fact]
        public void AGateNobodyMintedIsNotALicence()
        {
            var vessel = default(PrincipiaVesselGate);
            var plan = default(PrincipiaFlightPlanGate);

            Assert.Throws<PrincipiaProtocolException>(() => vessel.Velocity());
            Assert.Throws<PrincipiaProtocolException>(() => plan.InitialTime());
        }

        // ---- A destroyed vessel -----------------------------------------------

        [Fact]
        public void ADestroyedVesselIsDroppedRatherThanRead()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 2));
            using (var first = Frame(session))
            {
                Assert.True(first.TryVessel(Guid, out _));
            }

            plugin.Destroy(Guid);
            plugin.Calls.Clear();

            using var second = Frame(session);
            Assert.False(second.TryVessel(Guid, out var gone));

            // HasVessel is the only thing that ran, and it is the only call on the
            // whole surface that tolerates a guid we have not just proved.
            Assert.Equal(new[] { "HasVessel(" + Guid + ")" }, plugin.Calls);
            Assert.Throws<PrincipiaProtocolException>(() => gone.Velocity());
        }

        [Fact]
        public void AGateHeldAcrossTheVesselsDestructionNeverReachesThePlugin()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 2));
            PrincipiaVesselGate stale;
            using (var first = Frame(session))
            {
                Assert.True(first.TryVessel(Guid, out stale));
            }

            plugin.Destroy(Guid);
            plugin.Calls.Clear();

            using var second = Frame(session);
            var thrown = Assert.Throws<PrincipiaProtocolException>(() => stale.Velocity());

            Assert.Contains("minted in an earlier frame", thrown.Message);
            Assert.Empty(plugin.Calls);
        }

        // ---- A vessel with no flight plan -------------------------------------

        [Fact]
        public void AVesselWithNoPlanPublishesNoPlanRatherThanAnEmptyOne()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid));
            plugin.Calls.Clear();

            using var frame = Frame(session);
            Assert.True(frame.TryVessel(Guid, out var vessel));
            Assert.False(vessel.TryFlightPlan(out var plan));

            Assert.Equal(
                new[] { "HasVessel(" + Guid + ")", "FlightPlanExists(" + Guid + ")" },
                plugin.Calls);
            Assert.Throws<PrincipiaProtocolException>(() => plan.InitialTime());
            Assert.Empty(Named(plugin, "FlightPlanGetInitialTime"));
        }

        [Fact]
        public void APlanGateHeldAcrossThePlansDeletionNeverReachesThePlugin()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 1));
            PrincipiaFlightPlanGate stale;
            using (var first = Frame(session))
            {
                Assert.True(first.TryVessel(Guid, out var vessel));
                Assert.True(vessel.TryFlightPlan(out stale));
            }

            plugin.Add(Guid);
            plugin.Calls.Clear();

            using var second = Frame(session);
            Assert.Throws<PrincipiaProtocolException>(() => stale.NumberOfAnomalousManoeuvres());
            Assert.Empty(plugin.Calls);
        }

        // ---- Burn indices -----------------------------------------------------

        [Fact]
        public void EveryBurnIsReadOnceThroughTheCursorAndTheOrderIsRight()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 3));
            plugin.Calls.Clear();

            using var frame = Frame(session);
            Assert.True(frame.TryVessel(Guid, out var vessel));
            Assert.True(vessel.TryFlightPlan(out var plan));

            var burns = plan.Manoeuvres();
            Assert.Equal(3, burns.Count);

            var read = new List<object?>();
            foreach (var burn in burns)
            {
                read.Add(burn.Manoeuvre());
            }

            // Identified by ignition instant rather than by object identity: the
            // double hands back a FRESH manoeuvre on every read, as Principia's own
            // marshaller does, and the fixture spaces the three burns a thousand
            // seconds apart so a mis-ordered or repeated read is visible.
            Assert.Equal(
                new double[] { 2000.0, 3000.0, 4000.0 },
                read.Select(m => ((FakeManoeuvre)m!).burn.initial_time).ToArray());
            Assert.Equal(
                new[]
                {
                    "HasVessel(" + Guid + ")",
                    "FlightPlanExists(" + Guid + ")",
                    "FlightPlanNumberOfManoeuvres(" + Guid + ")",
                    "FlightPlanGetManoeuvre(" + Guid + ",0)",
                    "FlightPlanGetManoeuvre(" + Guid + ",1)",
                    "FlightPlanGetManoeuvre(" + Guid + ",2)",
                },
                plugin.Calls);
        }

        [Fact]
        public void ABurnTokenFromLastFrameIsRefusedAfterThePlayerDeletesTheBurn()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 3));

            PrincipiaManoeuvreGate stale = default;
            using (var first = Frame(session))
            {
                Assert.True(first.TryVessel(Guid, out var vessel));
                Assert.True(vessel.TryFlightPlan(out var plan));
                foreach (var burn in plan.Manoeuvres())
                {
                    stale = burn;
                }
                Assert.Equal(2, stale.Ordinal);
            }

            // The player deletes the last two burns between our frames.
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 1);
            plugin.Calls.Clear();

            using var second = Frame(session);
            Assert.Throws<PrincipiaProtocolException>(() => stale.Manoeuvre());
            Assert.Empty(plugin.Calls);

            // And a cursor taken afresh in the new frame yields only what is there.
            Assert.True(second.TryVessel(Guid, out var live));
            Assert.True(live.TryFlightPlan(out var plan2));
            Assert.Equal(1, plan2.Manoeuvres().Count);
        }

        /// <summary>
        /// The plotted velocity is bounded by the SEGMENT count against a doubled
        /// index, not by the manoeuvre count that bounds every neighbour of it.
        ///
        /// <para>Here the plan claims three burns but holds only three segments,
        /// which is the shape a plan takes mid-recompute. Bounding by the manoeuvre
        /// count would read segment 4 of 3 and abort; the double faults exactly
        /// where the native one does, so this test would fail rather than pass
        /// quietly if the cursor took the wrong count.</para>
        /// </summary>
        [Fact]
        public void ThePlottedVelocityCursorRespectsTheSegmentBoundNotTheBurnCount()
        {
            var (plugin, _, session) = Bind(p =>
            {
                var vessel = p.Add(Guid, hasFlightPlan: true, manoeuvres: 3);
                vessel.Segments = 3;
            });

            using var frame = Frame(session);
            Assert.True(frame.TryVessel(Guid, out var vessel));
            Assert.True(vessel.TryFlightPlan(out var plan));

            var cursor = plan.PlottedVelocities();
            Assert.Equal(2, cursor.Count);

            var ordinals = new List<int>();
            foreach (var entry in cursor)
            {
                entry.InitialPlottedVelocity();
                ordinals.Add(entry.Ordinal);
            }

            Assert.Equal(new[] { 0, 1 }, ordinals);
        }

        [Fact]
        public void ThePlottedVelocityCursorStopsAtTheBurnCountWhenSegmentsRunLonger()
        {
            // The ordinary shape: 2n+1 segments for n burns. The segment bound
            // alone would license index n, which reads the final coast rather than
            // a burn, so the burn count is taken as the tighter of the two.
            var (_, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 2));

            using var frame = Frame(session);
            Assert.True(frame.TryVessel(Guid, out var vessel));
            Assert.True(vessel.TryFlightPlan(out var plan));

            Assert.Equal(2, plan.PlottedVelocities().Count);
        }

        // ---- The plugin handle ------------------------------------------------

        [Fact]
        public void AHandleReplacedPartwayThroughAFrameStopsTheFrameDead()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 1));

            using var frame = Frame(session);
            Assert.True(frame.TryVessel(Guid, out var vessel));

            // A deserialise or a plugin reset: the pointer we opened on is now
            // freed memory, and every gate this frame handed out is about a plugin
            // that no longer exists.
            plugin.ReplaceHandle();
            plugin.Calls.Clear();

            var thrown = Assert.Throws<PrincipiaProtocolException>(() => vessel.Velocity());
            Assert.Contains("handle was replaced", thrown.Message);
            Assert.Empty(plugin.Calls);
        }

        [Fact]
        public void AHandleReplacedBetweenFramesIsSimplyPickedUp()
        {
            var (plugin, _, session) = Bind(p => p.Add(Guid, hasFlightPlan: true, manoeuvres: 1));
            using (var first = Frame(session))
            {
                Assert.True(first.TryVessel(Guid, out _));
            }

            plugin.ReplaceHandle();
            plugin.Calls.Clear();

            using var second = Frame(session);
            Assert.True(second.TryVessel(Guid, out var vessel));
            var velocity = vessel.Velocity();

            Assert.Equal(1.0, velocity.X);
            Assert.Equal(
                new[] { "HasVessel(" + Guid + ")", "VesselVelocity(" + Guid + ")" },
                plugin.Calls);
        }

        [Fact]
        public void APluginThatDisappearsPartwayThroughAFrameStopsTheFrameDead()
        {
            var (plugin, handle, session) = Bind(p => p.Add(Guid));

            using var frame = Frame(session);
            Assert.True(frame.TryVessel(Guid, out var vessel));

            handle.Absent = true;
            plugin.Calls.Clear();

            Assert.Throws<PrincipiaProtocolException>(() => vessel.Velocity());
            Assert.Empty(plugin.Calls);
        }

        // ---- The instrument itself --------------------------------------------

        /// <summary>
        /// The double must fault where the plugin aborts, so these call it DIRECTLY,
        /// around the gates, and prove it does.
        ///
        /// <para>Without this the suite above is worthless in the way that matters:
        /// a double that quietly answered a value for an unlicensed read would let
        /// every test pass whether or not the protocol held, and would report that
        /// as success. A guard that cannot see its own failure mode reports
        /// zero.</para>
        /// </summary>
        [Fact]
        public void TheDoubleFaultsOnAGuidThePluginDoesNotKnow()
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid);

            Assert.Throws<PrincipiaWouldHaveAbortedException>(
                () => plugin.VesselVelocity(plugin.Handle, "recovered-vessel"));
        }

        [Fact]
        public void TheDoubleFaultsOnAVesselWithNoFlightPlan()
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid);

            Assert.Throws<PrincipiaWouldHaveAbortedException>(
                () => plugin.FlightPlanNumberOfManoeuvres(plugin.Handle, Guid));
        }

        [Fact]
        public void TheDoubleFaultsOnABurnIndexThatIsOutOfRange()
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 2);

            Assert.Throws<PrincipiaWouldHaveAbortedException>(
                () => plugin.FlightPlanGetManoeuvre(plugin.Handle, Guid, 2));
        }

        [Fact]
        public void TheDoubleFaultsOnAReplacedHandle()
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid);
            var stale = plugin.Handle;
            plugin.ReplaceHandle();

            Assert.Throws<PrincipiaWouldHaveAbortedException>(
                () => plugin.HasVessel(stale, Guid));
        }

        [Fact]
        public void TheDoubleFaultsOnAPlottedVelocityPastTheSegmentBound()
        {
            var plugin = new FakePrincipiaPlugin();
            var vessel = plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 3);
            vessel.Segments = 3;

            // Index 1 is fine (segment 2 of 3); index 2 is segment 4 and is not.
            plugin.FlightPlanGetManoeuvreInitialPlottedVelocity(plugin.Handle, Guid, 1);
            Assert.Throws<PrincipiaWouldHaveAbortedException>(
                () => plugin.FlightPlanGetManoeuvreInitialPlottedVelocity(plugin.Handle, Guid, 2));
        }
    }
}
