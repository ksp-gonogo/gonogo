using System;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Every EXCLUSIVE capability this Uplink wins must answer without any of this
    /// Uplink's own topics being subscribed.
    ///
    /// <para><b>The failure this exists to catch.</b> A subscription-gated sampled
    /// source is skipped entirely on any tick where nothing under its declared
    /// prefixes is subscribed, so a capability fed by that source's capture, rather
    /// than by the gated topic itself, goes stale and then stays stale. Winning an
    /// exclusive capability means stock does not answer either, so the client is
    /// told nothing at all, or worse, told positively that there is nothing to
    /// tell. No exception, no log line, no fallback. The control frame shipped that
    /// way and was found on the rig rather than here.</para>
    ///
    /// <para><b>Why a test per capability rather than a check over the source.</b>
    /// Whether a capture writes state something else reads cannot be decided by
    /// looking at the capture: the write is to a private field, and the reader is
    /// resolved through an election at runtime. It can be decided by driving ticks
    /// and asking, which is what these do. A capability added here later, or a
    /// source quietly re-gated, fails the case for that capability by name.</para>
    ///
    /// <para>The set is the four this Uplink registers into: propagation, gravity
    /// model, control frame and maneuver plan. Two are fed by a capture and two are
    /// not, and both kinds are asserted, because "this one does not need a tick" is
    /// the claim that stops being true the moment somebody moves its reading onto a
    /// gated source.</para>
    /// </summary>
    public class ExclusiveCapabilityStarvationTests
    {
        private const string Guid = "vessel-1";

        private static PrincipiaGuardResult Present =>
            PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 25557));

        /// <summary>
        /// A settings source pointing at a bound session with one planned craft, so
        /// the plan reading has something real to find.
        /// </summary>
        private static FakeSettingsSource PlannedCraft()
        {
            var plugin = new FakePrincipiaPlugin();
            plugin.Add(Guid, hasFlightPlan: true, manoeuvres: 2);
            Assert.True(
                PrincipiaSession.TryBind(
                    plugin, new FakePluginHandle(plugin), out var session, out var reason),
                reason);
            return new FakeSettingsSource { Session = session, ActiveVesselGuid = Guid };
        }

        [Fact]
        public void TheControlFrameAnswersWithOnlyItsDerivedTopicSubscribed()
        {
            var host = new RecordingUplinkHost();
            new PrincipiaUplink(Present, new FakeSettingsSource()).Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot(), "system.frame");

            Assert.NotNull(
                host.Kernel.Query<IControlFrameSource>(ControlFrameCapability.Id).Frame);
        }

        /// <summary>
        /// The twin of the control-frame case, and the one that was still live when
        /// the first was patched.
        ///
        /// <para><c>vessel.maneuver</c> is built from whatever won the maneuver-plan
        /// election, the election is exclusive, and this Uplink's source answers out
        /// of the plan observation. A null plan does not read as "silence" on that
        /// channel: the payload is still published, with its planner field ABSENT,
        /// and an absent planner is documented to mean there is no planner. So the
        /// operator of a craft with a plan is told, positively, that it has none.
        /// That is worse than silence, and nothing anywhere says it happened.</para>
        /// </summary>
        [Fact]
        public void TheManeuverPlanAnswersWithOnlyItsDerivedTopicSubscribed()
        {
            var host = new RecordingUplinkHost();
            new PrincipiaUplink(Present, PlannedCraft()).Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot(), "vessel.maneuver");

            Assert.NotNull(
                host.Kernel.Query<IManeuverPlanSource>(ManeuverPlanCapability.Id).Plan());
        }

        [Fact]
        public void TheManeuverPlanAnswersWithNOTHINGSubscribed()
        {
            var host = new RecordingUplinkHost();
            new PrincipiaUplink(Present, PlannedCraft()).Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot());

            Assert.NotNull(
                host.Kernel.Query<IManeuverPlanSource>(ManeuverPlanCapability.Id).Plan());
        }

        [Fact]
        public void ThePlanTopicStillPublishesWhenItIsSubscribed()
        {
            var host = new RecordingUplinkHost();
            new PrincipiaUplink(Present, PlannedCraft()).Register(host);
            host.Resolve();

            host.DriveTick(new KspSnapshot(), PrincipiaUplink.PlanTopic);

            Assert.Single(host.PublishedTo(PrincipiaUplink.PlanTopic));
        }

        [Fact]
        public void PropagationAnswersWithoutATickHavingBeenDrivenAtAll()
        {
            // Not fed by a capture: the provider forwards to the plugin and to the
            // vanilla it was handed. Asserted so that moving its reading onto a
            // gated source fails HERE rather than on somebody's rig.
            var host = new RecordingUplinkHost();
            new PrincipiaUplink(Present, new FakeSettingsSource()).Register(host);
            host.Resolve();

            Assert.Equal(
                "principia-propagation",
                host.Kernel.Query<IPropagationProvider>(PropagationCapability.Id).ProviderId);
        }

        [Fact]
        public void TheGravityModelAnswersWithoutATickHavingBeenDrivenAtAll()
        {
            // Read from the config database once, at attach, rather than per tick.
            // Same reason for pinning it as propagation above.
            var host = new RecordingUplinkHost();
            new PrincipiaUplink(Present, new StubGravityModel()).Register(host);
            host.Resolve();

            Assert.NotNull(
                host.Kernel.Query<IGravityModelSource>(GravityModelCapability.Id).Model);
        }

        /// <summary>A force model that is simply present, which is all these cases
        /// ask of it.</summary>
        private sealed class StubGravityModel : IGravityModelSource
        {
            public string ProviderId => "stub";

            public GravityModel? Model { get; } =
                new GravityModel("stub", new System.Collections.Generic.List<GravityModelBody>());
        }
    }
}
