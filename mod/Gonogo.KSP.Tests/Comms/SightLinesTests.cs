using System;
using System.Collections.Generic;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// The sight table a command centre is shown craft by: one row per object,
    /// one delay per centre, the straight line between the two positions over
    /// the speed of light.
    /// </summary>
    public class SightLinesTests
    {
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;
        private const double KerbinRadius = 600_000.0;
        private const string Home = "ground:KSC";
        private const string Island = "ground:Island";
        private const string Crewed = "vessel:crewed";

        private static readonly Guid CraftId = new Guid("44444444-0000-0000-0000-000000000000");
        private static readonly string Row = "vessel:" + CraftId;

        private static SignalDelayConfig DelayOn() => new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private static KspCommandCentre Centre(string id, CommandCentreKind kind, double x) =>
            new KspCommandCentre(id, id, kind, bodyIndex: 1, node: null, position: new Vector3d(x, 0.0, 0.0), active: true);

        private static List<CommandCentreEntry> HomeIs(string id) =>
            new List<CommandCentreEntry> { new CommandCentreEntry { Id = id, IsHome = true } };

        private static Vessel Craft(VesselType type = VesselType.Probe)
        {
            var craft = UnityStandIns.Alive<Vessel>();
            craft.id = CraftId;
            craft.vesselType = type;
            return craft;
        }

        private static Dictionary<string, IReadOnlyDictionary<string, double>> Table(
            Vessel craft, Vector3d at, SignalDelayConfig config, params KspCommandCentre[] centres) =>
            SightLines.Table(new[] { craft }, _ => at, centres, HomeIs(Home), config);

        /// <summary>
        /// A ground station on one side of the homeworld and a craft on the
        /// other: the line between them runs through the planet, and the craft
        /// is seen anyway, at the length of that line.
        /// </summary>
        [Fact]
        public void ACraftOnTheFarSideOfThePlanetIsSeenAtItsStraightLineDistance()
        {
            var sight = Table(Craft(), new Vector3d(3.0 * KerbinRadius, 0.0, 0.0), DelayOn(),
                Centre(Home, CommandCentreKind.GroundStation, -KerbinRadius));

            Assert.Equal(4.0 * KerbinRadius / C, sight[Row][Home], 12);
        }

        [Fact]
        public void HomeSeesThroughWhicheverGroundStationIsNearest()
        {
            var sight = Table(Craft(), new Vector3d(10.0 * C, 0.0, 0.0), DelayOn(),
                Centre(Home, CommandCentreKind.GroundStation, 0.0),
                Centre(Island, CommandCentreKind.GroundStation, 6.0 * C));

            Assert.Equal(4.0, sight[Row][Home], 9);
            Assert.Equal(4.0, sight[Row][Island], 9);
        }

        [Fact]
        public void ACrewedCraftCommandCentreSeesEveryObjectToo()
        {
            var sight = Table(Craft(), new Vector3d(10.0 * C, 0.0, 0.0), DelayOn(),
                Centre(Home, CommandCentreKind.GroundStation, 0.0),
                Centre(Crewed, CommandCentreKind.CrewedVessel, 8.0 * C));

            Assert.Equal(2.0, sight[Row][Crewed], 9);
        }

        [Fact]
        public void DebrisIsSeenLikeAnyCraft()
        {
            var sight = Table(Craft(VesselType.Debris), new Vector3d(C, 0.0, 0.0), DelayOn(),
                Centre(Home, CommandCentreKind.GroundStation, 0.0));

            Assert.Equal(1.0, sight[Row][Home], 9);
        }

        [Fact]
        public void WithSignalDelayOffEverySightingIsInstant()
        {
            var sight = Table(Craft(), new Vector3d(10.0 * C, 0.0, 0.0), new SignalDelayConfig { Enabled = false, LightSpeedScale = 1.0 },
                Centre(Home, CommandCentreKind.GroundStation, 0.0));

            Assert.Equal(0.0, sight[Row][Home]);
        }

        [Fact]
        public void ASlowerLightSpeedScaleLengthensEverySighting()
        {
            var sight = Table(Craft(), new Vector3d(C, 0.0, 0.0), new SignalDelayConfig { Enabled = true, LightSpeedScale = 0.25 },
                Centre(Home, CommandCentreKind.GroundStation, 0.0));

            Assert.Equal(4.0, sight[Row][Home], 9);
        }
    }
}
