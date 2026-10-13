using System;
using System.Collections.Generic;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// Which craft the home centre cannot hear: those whose route is read and
    /// ends somewhere other than a ground station. Every ground station is the
    /// home centre's antenna, so a craft talking to any of them is heard at home.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class OffTheGroundTests
    {
        private const double Ut = 500.0;

        private static readonly Guid Grounded = new Guid("11111111-0000-0000-0000-000000000000");
        private static readonly Guid Relayed = new Guid("22222222-0000-0000-0000-000000000000");
        private static readonly Guid Dark = new Guid("33333333-0000-0000-0000-000000000000");
        private static readonly Guid Unread = new Guid("44444444-0000-0000-0000-000000000000");

        private static SignalDelayConfig DelayOn() => new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private static List<Vessel> Fleet() => new List<Vessel>
        {
            UnityStandIns.Craft(Grounded, UnityStandIns.Link(true, UnityStandIns.Hop(1_000.0, endsAtHome: false), UnityStandIns.Hop(2_000.0, endsAtHome: true))),
            UnityStandIns.Craft(Relayed, UnityStandIns.Link(true, UnityStandIns.Hop(1_000.0, endsAtHome: false))),
            UnityStandIns.Craft(Dark, UnityStandIns.Link(false)),
            UnityStandIns.Craft(Unread),
        };

        [Fact]
        public void ACraftWhoseRouteEndsAwayFromTheGroundOrIsDownIsOffTheGround()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());

            Assert.Equal(
                new[] { Relayed.ToString(), Dark.ToString() },
                FleetCommsReader.OffTheGround(Fleet(), DelayOn()));
        }

        [Fact]
        public void InASaveWithNoCommsModelNoCraftIsOffTheGround()
        {
            var noCommNet = new SignalDelayConfig { Enabled = false, LightSpeedScale = 1.0, CutForNoCommsModel = true };
            using var ksp = new UnityStandIns(Ut, noCommNet);

            Assert.Empty(FleetCommsReader.OffTheGround(Fleet(), noCommNet));
        }
    }
}
