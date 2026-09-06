using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoRealAntennasUplink.Tests
{
    /// <summary>
    /// The half of <c>realantennas.antenna.target</c> that decides before the
    /// game is touched: mode validation, the tech-level gate RealAntennas
    /// declares but does not enforce, argument ranges, and the exact
    /// <c>TARGET</c> node contents each mode lowers to.
    /// </summary>
    public class RaTargetPlanTests
    {
        /// <summary>The shipped stock table, which Realism Overhaul moves three rows of.</summary>
        private static readonly Dictionary<string, int> StockModes = new Dictionary<string, int>
        {
            ["Vessel"] = 1,
            ["BodyCenter"] = 0,
            ["BodyLatLonAlt"] = 2,
            ["AzEl"] = 0,
            ["OrbitRelative"] = 2,
        };

        [Theory]
        [InlineData("Vessel")]
        [InlineData("BodyCenter")]
        [InlineData("BodyLatLonAlt")]
        [InlineData("AzEl")]
        [InlineData("OrbitRelative")]
        public void KnowsTheFiveModesRealAntennasDeclares(string mode) =>
            Assert.True(RaTargetPlan.IsKnownMode(mode));

        [Theory]
        [InlineData("")]
        [InlineData("vessel")]
        [InlineData("BodyCentre")]
        [InlineData("Home")]
        public void RejectsAnythingElseAsAMode(string mode) =>
            Assert.False(RaTargetPlan.IsKnownMode(mode));

        /// <summary>
        /// BodyCenter is the one mode name with no target class behind it: it
        /// stores as a BodyLatLonAlt, which is what reads back on the channel.
        /// </summary>
        [Fact]
        public void BodyCenterStoresAsBodyLatLonAlt()
        {
            Assert.Equal("BodyLatLonAlt", RaTargetPlan.StoredKind("BodyCenter"));
            foreach (var mode in new[] { "Vessel", "BodyLatLonAlt", "AzEl", "OrbitRelative" })
            {
                Assert.Equal(mode, RaTargetPlan.StoredKind(mode));
            }
        }

        // ── The gate, in both directions ─────────────────────────────────────

        [Fact]
        public void GateRefusesAModeTheAntennaHasNotReached()
        {
            Assert.False(RaTargetPlan.ModeIsUnlocked("BodyLatLonAlt", 1, StockModes, out var required));
            Assert.Equal(2, required);
        }

        [Fact]
        public void GatePassesAtExactlyTheRequiredLevel()
        {
            Assert.True(RaTargetPlan.ModeIsUnlocked("BodyLatLonAlt", 2, StockModes, out var required));
            Assert.Equal(2, required);
        }

        /// <summary>
        /// An empty table means the install has not loaded its targeting modes,
        /// not that every mode is forbidden. Refusing on a missing row would
        /// disable targeting outright on an install whose table came up late.
        /// </summary>
        [Fact]
        public void GatePassesWhenTheInstallDeclaresNothingAboutTheMode()
        {
            Assert.True(RaTargetPlan.ModeIsUnlocked(
                "BodyLatLonAlt", 0, new Dictionary<string, int>(), out _));
        }

        /// <summary>
        /// An unreadable tech level must not become a refusal: the antenna is
        /// there, the level is what could not be read, and blocking every mode on
        /// a failed reflection read is a worse answer than trusting the caller.
        /// </summary>
        [Fact]
        public void GatePassesWhenTheAntennaTechLevelCouldNotBeRead() =>
            Assert.True(RaTargetPlan.ModeIsUnlocked("OrbitRelative", null, StockModes, out _));

        [Fact]
        public void UnlockedModesGrowWithTechLevelAndKeepDeclarationOrder()
        {
            Assert.Equal(new[] { "BodyCenter", "AzEl" }, RaTargetPlan.UnlockedModes(0, StockModes));
            Assert.Equal(new[] { "Vessel", "BodyCenter", "AzEl" }, RaTargetPlan.UnlockedModes(1, StockModes));
            Assert.Equal(
                new[] { "Vessel", "BodyCenter", "BodyLatLonAlt", "AzEl", "OrbitRelative" },
                RaTargetPlan.UnlockedModes(2, StockModes));
        }

        /// <summary>
        /// Realism Overhaul moves Vessel to 2 and BodyLatLonAlt to 3, so the same
        /// antenna offers a different set. The table is read from the install for
        /// exactly this reason.
        /// </summary>
        [Fact]
        public void UnlockedModesFollowTheInstallsOwnTableNotTheStockNumbers()
        {
            var realismOverhaul = new Dictionary<string, int>
            {
                ["Vessel"] = 2,
                ["BodyCenter"] = 0,
                ["BodyLatLonAlt"] = 3,
                ["AzEl"] = 0,
                ["OrbitRelative"] = 2,
            };
            Assert.Equal(new[] { "BodyCenter", "AzEl" }, RaTargetPlan.UnlockedModes(1, realismOverhaul));
            Assert.Equal(
                new[] { "Vessel", "BodyCenter", "AzEl", "OrbitRelative" },
                RaTargetPlan.UnlockedModes(2, realismOverhaul));
        }

        /// <summary>A mode the install does not declare is not offered, because nothing would build it.</summary>
        [Fact]
        public void UnlockedModesOmitsAModeTheInstallDoesNotDeclare()
        {
            var partial = new Dictionary<string, int> { ["AzEl"] = 0 };
            Assert.Equal(new[] { "AzEl" }, RaTargetPlan.UnlockedModes(9, partial));
        }

        // ── The node each mode lowers to ─────────────────────────────────────

        [Fact]
        public void VesselTargetCarriesTheTargetVesselGuid()
        {
            var args = new RealAntennasTargetArgs
            {
                Mode = "Vessel",
                VesselId = "8b6a5d4c-1111-2222-3333-444455556666",
            };
            Assert.True(Build(args, out var values));
            Assert.Equal("Vessel", values["name"]);
            Assert.Equal("8b6a5d4c-1111-2222-3333-444455556666", values["vesselId"]);
        }

        /// <summary>
        /// RealAntennas parses the id with <c>new Guid(...)</c>, which THROWS on a
        /// malformed string, inside the load it performs for us. Refusing here is
        /// what keeps that from becoming an exception out of the command.
        /// </summary>
        [Fact]
        public void VesselTargetRefusesAnIdThatIsNotAGuid()
        {
            var args = new RealAntennasTargetArgs { Mode = "Vessel", VesselId = "the-mun" };
            Assert.False(Build(args, out _, out var error));
            Assert.Equal(CommandErrorCode.Range, error);
        }

        [Fact]
        public void VesselTargetRefusesAMissingId()
        {
            Assert.False(Build(new RealAntennasTargetArgs { Mode = "Vessel" }, out _, out var error));
            Assert.Equal(CommandErrorCode.Range, error);
        }

        /// <summary>
        /// Latitude 0, longitude 0, altitude minus the radius: RealAntennas' own
        /// spelling of a body's centre, in its "Body Center" button and in the
        /// default it gives an untargeted dish.
        /// </summary>
        [Fact]
        public void BodyCenterLowersToTheNegativeRadiusPoint()
        {
            var args = new RealAntennasTargetArgs { Mode = "BodyCenter", BodyName = "Kerbin" };
            Assert.True(Build(args, out var values, out _, bodyName: "Kerbin", bodyRadius: 600000.0));
            Assert.Equal("BodyLatLonAlt", values["name"]);
            Assert.Equal("Kerbin", values["bodyName"]);
            Assert.Equal("0,0,-600000", values["latLonAlt"]);
        }

        [Fact]
        public void BodyCenterRefusesWhenNoBodyResolved()
        {
            var args = new RealAntennasTargetArgs { Mode = "BodyCenter", BodyName = "Krypton" };
            Assert.False(Build(args, out _, out var error, bodyName: null));
            Assert.Equal(CommandErrorCode.NotFound, error);
        }

        [Fact]
        public void BodyLatLonAltCarriesTheThreeComponentsInOrder()
        {
            var args = new RealAntennasTargetArgs
            {
                Mode = "BodyLatLonAlt",
                BodyName = "Kerbin",
                Latitude = -0.0972,
                Longitude = -74.5577,
                Altitude = 70.0,
            };
            Assert.True(Build(args, out var values, out _, bodyName: "Kerbin", bodyRadius: 600000.0));
            Assert.Equal("BodyLatLonAlt", values["name"]);
            Assert.Equal("-0.0972,-74.5577,70", values["latLonAlt"]);
        }

        /// <summary>
        /// A comma decimal separator would turn a three-component vector into six
        /// components and load the target somewhere else entirely, so the format
        /// is pinned rather than left to the machine's culture.
        /// </summary>
        [Fact]
        public void VectorFormattingIsInvariantOfTheMachineCulture()
        {
            var original = Thread.CurrentThread.CurrentCulture;
            try
            {
                Thread.CurrentThread.CurrentCulture = new CultureInfo("de-DE");
                var args = new RealAntennasTargetArgs
                {
                    Mode = "BodyLatLonAlt",
                    BodyName = "Kerbin",
                    Latitude = 1.5,
                    Longitude = 2.25,
                    Altitude = 3.75,
                };
                Assert.True(Build(args, out var values, out _, bodyName: "Kerbin"));
                Assert.Equal("1.5,2.25,3.75", values["latLonAlt"]);
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = original;
            }
        }

        /// <summary>Never exponent notation: RealAntennas reads these back through KSP's float parse.</summary>
        [Fact]
        public void SmallMagnitudesStayPlainDecimal()
        {
            var args = new RealAntennasTargetArgs
            {
                Mode = "BodyLatLonAlt",
                BodyName = "Kerbin",
                Latitude = 0.0000001,
                Longitude = 0.0,
                Altitude = 0.0,
            };
            Assert.True(Build(args, out var values, out _, bodyName: "Kerbin"));
            Assert.DoesNotContain("E", values["latLonAlt"]);
            Assert.Equal("0.0000001,0,0", values["latLonAlt"]);
        }

        /// <summary>
        /// Azimuth and elevation are measured FROM the antenna's own craft, so the
        /// id in the node is that craft's and never a target's: RealAntennas'
        /// own targeting window fills it the same way.
        /// </summary>
        [Fact]
        public void AzElMeasuresFromTheAntennasOwnCraft()
        {
            var args = new RealAntennasTargetArgs
            {
                Mode = "AzEl",
                Azimuth = 135.0,
                Elevation = -12.5,
                // Supplied and deliberately ignored: an azimuth relative to some
                // other craft is not a thing RealAntennas can express.
                VesselId = "dddddddd-dddd-dddd-dddd-dddddddddddd",
            };
            Assert.True(Build(args, out var values, out _, ownVesselId: "aaaaaaaa-1111-2222-3333-444444444444"));
            Assert.Equal("AzEl", values["name"]);
            Assert.Equal("aaaaaaaa-1111-2222-3333-444444444444", values["vesselId"]);
            Assert.Equal("135", values["azimuth"]);
            Assert.Equal("-12.5", values["elevation"]);
        }

        [Fact]
        public void OrbitRelativeCarriesDeflectionAndElevation()
        {
            var args = new RealAntennasTargetArgs { Mode = "OrbitRelative", Forward = -30.0, Elevation = 5.0 };
            Assert.True(Build(args, out var values, out _, ownVesselId: "aaaaaaaa-1111-2222-3333-444444444444"));
            Assert.Equal("OrbitRelative", values["name"]);
            Assert.Equal("-30", values["forward"]);
            Assert.Equal("5", values["elevation"]);
        }

        [Fact]
        public void AttitudeModesRefuseWhenTheOwnCraftIsUnknown()
        {
            var args = new RealAntennasTargetArgs { Mode = "AzEl", Azimuth = 0.0, Elevation = 0.0 };
            Assert.False(Build(args, out _, out var error, ownVesselId: null));
            Assert.Equal(CommandErrorCode.NoVessel, error);
        }

        // ── Ranges: refused rather than clamped ──────────────────────────────
        //
        // RealAntennas' own window clamps these silently, and can, because it
        // shows the clamped number straight back. A delayed command that clamped
        // would report success minutes later for an aim point nobody asked for.

        [Theory]
        [InlineData(-1.0, 0.0)]
        [InlineData(361.0, 0.0)]
        [InlineData(0.0, 91.0)]
        [InlineData(0.0, -91.0)]
        [InlineData(double.NaN, 0.0)]
        [InlineData(0.0, double.PositiveInfinity)]
        public void AzElRefusesOutOfRangeAngles(double azimuth, double elevation)
        {
            var args = new RealAntennasTargetArgs { Mode = "AzEl", Azimuth = azimuth, Elevation = elevation };
            Assert.False(Build(args, out _, out var error, ownVesselId: "aaaaaaaa-1111-2222-3333-444444444444"));
            Assert.Equal(CommandErrorCode.Range, error);
        }

        [Theory]
        [InlineData(0.0, 0.0)]
        [InlineData(360.0, 90.0)]
        [InlineData(360.0, -90.0)]
        public void AzElAcceptsTheEndsOfTheRange(double azimuth, double elevation)
        {
            var args = new RealAntennasTargetArgs { Mode = "AzEl", Azimuth = azimuth, Elevation = elevation };
            Assert.True(Build(args, out _, out _, ownVesselId: "aaaaaaaa-1111-2222-3333-444444444444"));
        }

        [Theory]
        [InlineData(-181.0)]
        [InlineData(181.0)]
        public void OrbitRelativeRefusesOutOfRangeDeflection(double forward)
        {
            var args = new RealAntennasTargetArgs { Mode = "OrbitRelative", Forward = forward, Elevation = 0.0 };
            Assert.False(Build(args, out _, out var error, ownVesselId: "aaaaaaaa-1111-2222-3333-444444444444"));
            Assert.Equal(CommandErrorCode.Range, error);
        }

        [Theory]
        [InlineData(91.0, 0.0)]
        [InlineData(-91.0, 0.0)]
        [InlineData(0.0, 361.0)]
        [InlineData(0.0, -181.0)]
        public void BodyLatLonAltRefusesOutOfRangeCoordinates(double latitude, double longitude)
        {
            var args = new RealAntennasTargetArgs
            {
                Mode = "BodyLatLonAlt",
                BodyName = "Kerbin",
                Latitude = latitude,
                Longitude = longitude,
            };
            Assert.False(Build(args, out _, out var error, bodyName: "Kerbin"));
            Assert.Equal(CommandErrorCode.Range, error);
        }

        [Fact]
        public void AnUnknownModeIsRefusedBeforeAnythingElseIsRead()
        {
            Assert.False(Build(new RealAntennasTargetArgs { Mode = "PointAtHome" }, out _, out var error));
            Assert.Equal(CommandErrorCode.Range, error);
        }

        private static bool Build(RealAntennasTargetArgs args, out Dictionary<string, string> values) =>
            Build(args, out values, out _);

        private static bool Build(
            RealAntennasTargetArgs args,
            out Dictionary<string, string> values,
            out CommandErrorCode error,
            string? ownVesselId = "aaaaaaaa-1111-2222-3333-444444444444",
            string? bodyName = "Kerbin",
            double bodyRadius = 600000.0) =>
            RaTargetPlan.TryBuild(args, ownVesselId, bodyName, bodyRadius, out values, out error, out _);
    }
}
