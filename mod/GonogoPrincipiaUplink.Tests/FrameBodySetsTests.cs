using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The bodies a rotating frame turns about, on both paths that can produce
    /// them.
    ///
    /// <para>A pulsating frame's sides are SETS, and the side that a reader
    /// recognises by name is only the head of one. The two paths reach that fact
    /// differently and both are exercised here: the plotting selector holds one
    /// body and the sets are walked from it, and a burn's descriptor already
    /// arrives as arrays.</para>
    /// </summary>
    public class FrameBodySetsTests
    {
        private const int BodyCentredNonRotating = 6000;
        private const int ParentDirection = 6002;
        private const int RotatingPulsating = 6004;

        /// <summary>
        /// A star with four planets in the order the game lists them, one of which
        /// has a moon. Constructed parent-first so the children land in that order,
        /// because the order is the whole point of the rule under test.
        /// </summary>
        private static FakeCelestial Kerbol(out FakeCelestial kerbin)
        {
            var kerbol = new FakeCelestial("Kerbol", 0, null);
            _ = new FakeCelestial("Moho", 4, kerbol);
            _ = new FakeCelestial("Eve", 5, kerbol);
            kerbin = new FakeCelestial("Kerbin", 1, kerbol);
            _ = new FakeCelestial("Mun", 2, kerbin);
            _ = new FakeCelestial("Duna", 6, kerbol);
            return kerbol;
        }

        private static FrameObservation ReadPlottingFrame(
            FakeCelestial centre, FakeFrameType type)
        {
            var source = new FakeSettingsSource();
            source.Selector.SetFrameType(type);
            source.Selector.SetSelectedCelestial(centre);
            var observation = new SettingsObservation();
            new SettingsReflection().Read(source, observation);
            Assert.NotNull(observation.PlottingFrame);
            return observation.PlottingFrame!;
        }

        [Fact]
        public void StopsThePrimarySideAtTheSelectedBody()
        {
            _ = Kerbol(out var kerbin);

            var frame = ReadPlottingFrame(kerbin, FakeFrameType.RotatingPulsating);

            Assert.Equal(RotatingPulsating, frame.Type);
            // Moho and Eve are listed before Kerbin and so ride along; Duna is past
            // the stop and is excluded. Publishing "Kerbol" alone, which is what the
            // singular field can say, loses two of the three.
            Assert.Equal(new List<string> { "Kerbol", "Moho", "Eve" }, frame.PrimaryBodies);
            Assert.Equal(new List<string> { "Kerbin", "Mun" }, frame.SecondaryBodies);
        }

        [Fact]
        public void KeepsTheSingularFieldsAsTheHeadsOfTheSets()
        {
            _ = Kerbol(out var kerbin);

            var frame = ReadPlottingFrame(kerbin, FakeFrameType.RotatingPulsating);

            Assert.Equal("Kerbol", frame.PrimaryBody);
            Assert.Equal("Kerbin", frame.SecondaryBody);
            Assert.Equal(frame.PrimaryBody, frame.PrimaryBodies[0]);
            Assert.Equal(frame.SecondaryBody, frame.SecondaryBodies[0]);
        }

        /// <summary>
        /// A side that really is one body leaves its list empty, so an empty list
        /// reads the same way everywhere: the head is the whole of it. A moon's
        /// pulsating frame is the case, because its parent has no other children
        /// before it.
        /// </summary>
        [Fact]
        public void LeavesASingleBodySideToTheSingularFieldAlone()
        {
            var kerbol = new FakeCelestial("Kerbol", 0, null);
            var kerbin = new FakeCelestial("Kerbin", 1, kerbol);
            var mun = new FakeCelestial("Mun", 2, kerbin);

            var frame = ReadPlottingFrame(mun, FakeFrameType.RotatingPulsating);

            Assert.Equal("Kerbin", frame.PrimaryBody);
            Assert.Equal("Mun", frame.SecondaryBody);
            Assert.Empty(frame.PrimaryBodies);
            Assert.Empty(frame.SecondaryBodies);
        }

        [Fact]
        public void DoesNotWalkTheSystemForAFrameThatIsNotPulsating()
        {
            _ = Kerbol(out var kerbin);

            var frame = ReadPlottingFrame(kerbin, FakeFrameType.BodyCentredParentDirection);

            Assert.Equal(ParentDirection, frame.Type);
            Assert.Equal("Kerbol", frame.PrimaryBody);
            Assert.Equal("Kerbin", frame.SecondaryBody);
            Assert.Empty(frame.PrimaryBodies);
            Assert.Empty(frame.SecondaryBodies);
        }

        [Fact]
        public void ACentredFrameStillNamesOnlyItsCentre()
        {
            _ = Kerbol(out var kerbin);

            var frame = ReadPlottingFrame(kerbin, FakeFrameType.BodyCentredNonRotating);

            Assert.Equal(BodyCentredNonRotating, frame.Type);
            Assert.Equal("Kerbin", frame.CentreBody);
            Assert.Null(frame.PrimaryBody);
            Assert.Empty(frame.PrimaryBodies);
        }

        /// <summary>
        /// A body listed as its own descendant would otherwise walk forever, on the
        /// game's main thread. The walk is depth-bounded, so a cycle costs a
        /// truncated set rather than a hung frame.
        /// </summary>
        [Fact]
        public void SurvivesABodyGraphThatLoops()
        {
            var kerbol = new FakeCelestial("Kerbol", 0, null);
            var kerbin = new FakeCelestial("Kerbin", 1, kerbol);
            var mun = new FakeCelestial("Mun", 2, kerbin);
            mun.orbitingBodies.Add(kerbin);

            var frame = ReadPlottingFrame(kerbin, FakeFrameType.RotatingPulsating);

            Assert.Equal("Kerbol", frame.PrimaryBody);
            Assert.NotEmpty(frame.SecondaryBodies);
        }

        /// <summary>
        /// The burn path, where the indices arrive as arrays already. Reading only
        /// the first is what the code did before, and it dropped the rest without
        /// saying so.
        /// </summary>
        [Fact]
        public void ABurnFrameKeepsEveryIndexItsDescriptorCarries()
        {
            var descriptor = new FakeFrameParameters(
                RotatingPulsating,
                centre: -1,
                primary: new[] { 0, 2, 3 },
                secondary: new[] { 1, 6 });

            var frame = new SettingsReflection().FrameFromIndices(
                descriptor, new FakeCelestialNames(), "burn");

            Assert.Equal("Kerbol", frame.PrimaryBody);
            Assert.Equal("Kerbin", frame.SecondaryBody);
            Assert.Equal(new List<string> { "Kerbol", "Mun", "Minmus" }, frame.PrimaryBodies);
            Assert.Equal(new List<string> { "Kerbin", "Duna" }, frame.SecondaryBodies);
        }

        [Fact]
        public void ABurnFrameWithOneBodyASideLeavesTheListsEmpty()
        {
            var descriptor = new FakeFrameParameters(
                ParentDirection,
                centre: -1,
                primary: new[] { 0 },
                secondary: new[] { 1 });

            var frame = new SettingsReflection().FrameFromIndices(
                descriptor, new FakeCelestialNames(), "burn");

            Assert.Equal("Kerbol", frame.PrimaryBody);
            Assert.Equal("Kerbin", frame.SecondaryBody);
            Assert.Empty(frame.PrimaryBodies);
            Assert.Empty(frame.SecondaryBodies);
        }

        /// <summary>The producer's "no body" contributes nothing rather than a null
        /// the reader has to step over.</summary>
        [Fact]
        public void DropsTheNoBodyIndexRatherThanNamingIt()
        {
            var descriptor = new FakeFrameParameters(
                ParentDirection,
                centre: -1,
                primary: new int[0],
                secondary: new[] { 1 });

            var frame = new SettingsReflection().FrameFromIndices(
                descriptor, new FakeCelestialNames(), "burn");

            Assert.Null(frame.PrimaryBody);
            Assert.Equal("Kerbin", frame.SecondaryBody);
        }

        /// <summary>
        /// A burn carries the bodies of its OWN frame, so a client holding the
        /// burn can name the frame its delta-v is quoted in.
        ///
        /// <para>The same frames also travel on the settings channel, as a bare
        /// list a client would have to index into by position, and the position is
        /// not the burn's: a manoeuvre whose frame cannot be read is dropped from
        /// that list rather than held open in it. That is why this is read here
        /// rather than joined there.</para>
        /// </summary>
        [Fact]
        public void APlannedBurnCarriesItsOwnFramesBodies()
        {
            var manoeuvre = new FakeManoeuvre(
                new FakeBurnFrameParameters(BodyCentredNonRotating, 1, -1, -1));

            var burn = PlanReader.Describe(
                manoeuvre, 0, 1, 0, 1000.0, new FakeCelestialNames());

            Assert.Equal(BodyCentredNonRotating, burn.FrameType);
            Assert.Equal("Kerbin", burn.Frame?.CentreBody);
        }

        /// <summary>
        /// No body table is a burn with a kind and no bodies, not a burn with the
        /// wrong ones. The reading runs headless in every test in this project and
        /// on the game's own thread in production, and only one of the two can name
        /// an index.
        /// </summary>
        [Fact]
        public void APlannedBurnWithNoBodyTableCarriesItsKindAlone()
        {
            var manoeuvre = new FakeManoeuvre(
                new FakeBurnFrameParameters(BodyCentredNonRotating, 1, -1, -1));

            var burn = PlanReader.Describe(manoeuvre, 0, 1, 0, 1000.0, celestials: null);

            Assert.Equal(BodyCentredNonRotating, burn.FrameType);
            Assert.Null(burn.Frame);
        }

        /// <summary>The bodies reach the wire on the burn itself.</summary>
        [Fact]
        public void PublishesABurnsFrameBodiesOnTheBurn()
        {
            var observation = new PlanObservation();
            observation.Burns.Add(new PlannedBurnObservation
            {
                Index = 0,
                FrameType = RotatingPulsating,
                Frame = new FrameObservation
                {
                    Selector = "burn",
                    Type = RotatingPulsating,
                    PrimaryBody = "Kerbol",
                    SecondaryBody = "Kerbin",
                    PrimaryBodies = new List<string> { "Kerbol", "Mun", "Minmus" },
                },
            });

            var payload = PlanBuilder.Build(observation);
            var burns = Assert.IsType<List<object?>>(payload["burns"]);
            var burn = Assert.IsType<Dictionary<string, object?>>(burns[0]);

            Assert.Equal("Kerbol", burn["primaryBody"]);
            Assert.Equal("Kerbin", burn["secondaryBody"]);
            Assert.Null(burn["centreBody"]);
            Assert.Equal(
                new[] { "Kerbol", "Mun", "Minmus" },
                Assert.IsType<string[]>(burn["primaryBodies"]));
            // One body a side says nothing the pair does not, so it sends nothing.
            Assert.Null(burn["secondaryBodies"]);
        }

        /// <summary>
        /// The sets reach the wire, and a side that is one body sends nothing at
        /// all rather than a one-entry array. A reader finding a list is being told
        /// something the pair cannot say.
        /// </summary>
        [Fact]
        public void PublishesTheSetsOnlyWhenTheySayMoreThanThePair()
        {
            var payload = SettingsBuilder.Build(new SettingsObservation
            {
                PlottingFrame = new FrameObservation
                {
                    Selector = "plotting",
                    Type = RotatingPulsating,
                    PrimaryBody = "Kerbol",
                    SecondaryBody = "Kerbin",
                    PrimaryBodies = new List<string> { "Kerbol", "Moho", "Eve" },
                },
            });

            var frame = Assert.IsType<Dictionary<string, object?>>(payload["plottingFrame"]);
            Assert.Equal(
                new[] { "Kerbol", "Moho", "Eve" },
                Assert.IsType<string[]>(frame["primaryBodies"]));
            Assert.Null(frame["secondaryBodies"]);
        }
    }
}
