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
    /// one delay per centre that has a clear line to it, the length of that line
    /// over the speed of light. A body blocks a line that passes inside its
    /// occluding radius.
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
            Centre(id, kind, new Vector3d(x, 0.0, 0.0));

        private static KspCommandCentre Centre(string id, CommandCentreKind kind, Vector3d position) =>
            new KspCommandCentre(id, id, kind, bodyIndex: 1, node: null, position: position, active: true);

        private static List<CommandCentreEntry> HomeIs(string id) =>
            new List<CommandCentreEntry> { new CommandCentreEntry { Id = id, IsHome = true } };

        private static Vessel Craft(VesselType type = VesselType.Probe)
        {
            var craft = UnityStandIns.Alive<Vessel>();
            craft.id = CraftId;
            craft.vesselType = type;
            return craft;
        }

        private static readonly SightBody[] NoBodies = new SightBody[0];

        /// <summary>The homeworld at the origin, occluding at its bare radius.</summary>
        private static readonly SightBody[] Kerbin = { new SightBody(new Vector3d(0.0, 0.0, 0.0), KerbinRadius) };

        private static Dictionary<string, IReadOnlyDictionary<string, double>> Table(
            Vessel craft, Vector3d at, SignalDelayConfig config, params KspCommandCentre[] centres) =>
            Table(craft, at, config, NoBodies, centres);

        private static Dictionary<string, IReadOnlyDictionary<string, double>> Table(
            Vessel craft, Vector3d at, SignalDelayConfig config, IReadOnlyList<SightBody> bodies, params KspCommandCentre[] centres) =>
            SightLines.Table(new[] { craft }, _ => at, centres, HomeIs(Home), config, bodies);

        /// <summary>
        /// A ground station on one side of the homeworld and a craft on the
        /// other: the line between them runs through the planet, so the station
        /// cannot see the craft.
        /// </summary>
        [Fact]
        public void ACraftOnTheFarSideOfThePlanetIsNotSeen()
        {
            var sight = Table(Craft(), new Vector3d(3.0 * KerbinRadius, 0.0, 0.0), DelayOn(), Kerbin,
                Centre(Home, CommandCentreKind.GroundStation, -KerbinRadius));

            Assert.Empty(sight[Row]);
        }

        /// <summary>
        /// A craft high above a station's horizon and one just below it, the
        /// station on the surface at the occluding radius.
        /// </summary>
        [Theory]
        [InlineData(0.01, true)]
        [InlineData(-0.01, false)]
        public void ACraftJustClearOfTheLimbIsSeenAndOneJustBehindItIsNot(double radiansAboveHorizon, bool seen)
        {
            var far = 10.0 * KerbinRadius;
            var bearing = Math.PI / 2.0 - radiansAboveHorizon;
            var at = new Vector3d(far * Math.Sin(bearing), far * Math.Cos(bearing) + KerbinRadius, 0.0);
            var sight = Table(Craft(), at, DelayOn(), Kerbin,
                Centre(Home, CommandCentreKind.GroundStation, new Vector3d(0.0, KerbinRadius, 0.0)));

            Assert.Equal(seen, sight[Row].ContainsKey(Home));
        }

        [Fact]
        public void ACraftBehindAMoonIsNotSeen()
        {
            var moon = new SightBody(new Vector3d(20.0 * KerbinRadius, 0.0, 0.0), 200_000.0);
            var sight = Table(Craft(), new Vector3d(30.0 * KerbinRadius, 0.0, 0.0), DelayOn(), new[] { Kerbin[0], moon },
                Centre(Home, CommandCentreKind.GroundStation, new Vector3d(KerbinRadius, 0.0, 0.0)));

            Assert.Empty(sight[Row]);
        }

        [Fact]
        public void ACrewedCraftCentreCannotSeeACraftOnTheFarSideOfAPlanetFromIt()
        {
            var sight = Table(Craft(), new Vector3d(3.0 * KerbinRadius, 0.0, 0.0), DelayOn(), Kerbin,
                Centre(Home, CommandCentreKind.GroundStation, new Vector3d(KerbinRadius, 0.0, 0.0)),
                Centre(Crewed, CommandCentreKind.CrewedVessel, -3.0 * KerbinRadius));

            Assert.False(sight[Row].ContainsKey(Crewed));
            Assert.True(sight[Row].ContainsKey(Home));
        }

        [Fact]
        public void HomeSeesThroughAnotherGroundStationWhenItsOwnLineIsBlocked()
        {
            var sight = Table(Craft(), new Vector3d(3.0 * KerbinRadius, 0.0, 0.0), DelayOn(), Kerbin,
                Centre(Home, CommandCentreKind.GroundStation, new Vector3d(-KerbinRadius, 0.0, 0.0)),
                Centre(Island, CommandCentreKind.GroundStation, new Vector3d(KerbinRadius, 0.0, 0.0)));

            Assert.Equal(2.0 * KerbinRadius / C, sight[Row][Home], 12);
            Assert.Equal(2.0 * KerbinRadius / C, sight[Row][Island], 12);
        }

        [Fact]
        public void InASaveWithNoCommsModelABodyBetweenBlocksNothing()
        {
            var noCommNet = new SignalDelayConfig { Enabled = false, LightSpeedScale = 1.0, CutForNoCommsModel = true };
            var sight = Table(Craft(), new Vector3d(3.0 * KerbinRadius, 0.0, 0.0), noCommNet, Kerbin,
                Centre(Home, CommandCentreKind.GroundStation, -KerbinRadius));

            Assert.True(sight[Row].ContainsKey(Home));
        }

        /// <summary>Switching signal delay off is not switching comms off: a body still blocks the line.</summary>
        [Fact]
        public void WithSignalDelayOffABodyBetweenStillBlocks()
        {
            var sight = Table(Craft(), new Vector3d(3.0 * KerbinRadius, 0.0, 0.0), new SignalDelayConfig { Enabled = false, LightSpeedScale = 1.0 }, Kerbin,
                Centre(Home, CommandCentreKind.GroundStation, -KerbinRadius));

            Assert.Empty(sight[Row]);
        }

        [Fact]
        public void ABodyAModelGivesNoOccludingRadiusBlocksNothing()
        {
            var transparent = new[] { new SightBody(new Vector3d(0.0, 0.0, 0.0), 0.0) };
            var sight = Table(Craft(), new Vector3d(3.0 * KerbinRadius, 0.0, 0.0), DelayOn(), transparent,
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
