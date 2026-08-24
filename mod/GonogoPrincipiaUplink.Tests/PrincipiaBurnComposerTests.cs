using System;
using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Building the FIRST burn of a plan, which is the one with no existing burn
    /// to copy.
    ///
    /// <para>The struct is constructed from a type the caller supplies, and in
    /// production that type is read off the loaded build's own
    /// <c>FlightPlanInsert</c> signature. Here it is the stand-in carrying the
    /// producer's field names, so the same reflection walk runs.</para>
    /// </summary>
    public class PrincipiaBurnComposerTests
    {
        private static readonly IReadOnlyCollection<int> Bodies = new[] { 0, 1, 5 };

        private static PrincipiaBurnComposer Composer() =>
            new PrincipiaBurnComposer(new PrincipiaBurnStruct());

        private static ComposedBurnRequest Request(
            int frameExtension = 6000,
            int centreBodyIndex = 5,
            int primaryBodyIndex = 0,
            int secondaryBodyIndex = 5,
            double thrust = 60,
            double isp = 320,
            double ignitionUt = 1000)
        {
            return new ComposedBurnRequest(
                ignitionUt: ignitionUt,
                deltaVTangent: 30,
                deltaVNormal: 4,
                deltaVBinormal: 0,
                inertiallyFixed: true,
                thrustKilonewtons: thrust,
                specificImpulseSeconds: isp,
                frameExtension: frameExtension,
                centreBodyIndex: centreBodyIndex,
                primaryBodyIndex: primaryBodyIndex,
                secondaryBodyIndex: secondaryBodyIndex);
        }

        [Fact]
        public void BuildsABurnCarryingEveryStatedValue()
        {
            var burn = Composer().Compose(
                typeof(FakeBurn), Request(), Bodies, out var refusal);

            Assert.Null(refusal);
            var built = Assert.IsType<FakeBurn>(burn);
            Assert.Equal(60, built.thrust_in_kilonewtons);
            Assert.Equal(320, built.specific_impulse_in_seconds_g0);
            Assert.Equal(1000, built.initial_time);
            Assert.True(built.is_inertially_fixed);
            Assert.Equal(30, built.intensity.xyz.x);
            Assert.Equal(4, built.intensity.xyz.y);
            Assert.Equal(0, built.intensity.xyz.z);
        }

        [Fact]
        public void WritesTheFrameOntoTheBurnRatherThanLeavingItZero()
        {
            // A zero extension is not a frame the producer has, and it reaches a
            // fatal log on the native side rather than an error return.
            var burn = Composer().Compose(
                typeof(FakeBurn), Request(frameExtension: 6002), Bodies, out _);

            Assert.Equal(6002, new PrincipiaBurnStruct().FrameExtension(burn!));
        }

        [Fact]
        public void CentresACentredFrameOnTheBodyThatWasAskedFor()
        {
            // The slot the producer's switch actually reads for this kind. Left at
            // a fresh struct's default it is zero, which is a real body and the
            // wrong one, so the burn would be planned around the Sun.
            var burn = Composer().Compose(
                typeof(FakeBurn),
                Request(frameExtension: 6000, centreBodyIndex: 5),
                Bodies,
                out _);

            var fields = new PrincipiaBurnStruct();
            Assert.Equal(5, fields.FrameCentreIndex(burn!));
            // And the pair slots are cleared, because this kind never reads them
            // and an index left in one is a claim nobody made.
            Assert.Equal(-1, fields.FramePrimaryIndex(burn!));
            Assert.Equal(-1, fields.FrameSecondaryIndex(burn!));
        }

        [Fact]
        public void BuildsADirectionFrameFromThePairRatherThanTheCentre()
        {
            var burn = Composer().Compose(
                typeof(FakeBurn),
                Request(frameExtension: 6002, primaryBodyIndex: 0, secondaryBodyIndex: 5),
                Bodies,
                out _);

            var fields = new PrincipiaBurnStruct();
            Assert.Equal(0, fields.FramePrimaryIndex(burn!));
            Assert.Equal(5, fields.FrameSecondaryIndex(burn!));
            // The centre carries the field's default rather than a body, which is
            // what the producer's own descriptor for this kind carries.
            Assert.Equal(0, fields.FrameCentreIndex(burn!));
        }

        [Fact]
        public void RefusesADirectionFrameNamingOneBodyTwice()
        {
            var burn = Composer().Compose(
                typeof(FakeBurn),
                Request(frameExtension: 6002, primaryBodyIndex: 5, secondaryBodyIndex: 5),
                Bodies,
                out var refusal);

            Assert.Null(burn);
            Assert.Contains("same body twice", refusal);
        }

        [Fact]
        public void RefusesADirectionFrameWhoseSecondBodyThisGameDoesNotHave()
        {
            // The pair kind reaches the same unguardable lookup as the centred one,
            // twice, and a check that only looked at the centre would let it past.
            var burn = Composer().Compose(
                typeof(FakeBurn),
                Request(frameExtension: 6002, primaryBodyIndex: 0, secondaryBodyIndex: 99),
                Bodies,
                out var refusal);

            Assert.Null(burn);
            Assert.Contains("No such body", refusal);
        }

        /// <summary>
        /// The built burn names what its three components MEAN.
        ///
        /// <para>The producer's enum starts at one and has no zero member, so a burn
        /// built from nothing carries a value that is not a member of it at all.
        /// Sending that across took the game down twice on the rig and left no
        /// diagnostic, because there is no case for it to land in. A copied burn
        /// cannot reach this: it arrives with the producer's own.</para>
        /// </summary>
        [Fact]
        public void NamesTheCoordinateSystemRatherThanLeavingItOutsideTheEnum()
        {
            var burn = Composer().Compose(typeof(FakeBurn), Request(), Bodies, out _);

            Assert.Equal(
                PrincipiaBurnStruct.CartesianTnb,
                new PrincipiaBurnStruct().CoordinateSystem(burn!));
        }

        [Fact]
        public void ComposesNothingWithoutTheProducersOwnType()
        {
            // The whole safety property: the shape comes from the loaded build. No
            // type means no build was read, and a shape written here instead would
            // be exactly the stale field set this avoids.
            var burn = Composer().Compose(null, Request(), Bodies, out var refusal);

            Assert.Null(burn);
            Assert.Contains("could not be read", refusal);
        }

        [Fact]
        public void RefusesABodyThisGameDoesNotHave()
        {
            // The one argument that reaches an unguardable native lookup. There is
            // no predicate on the producer's surface for a valid celestial index,
            // so the check has to happen here or not at all.
            var burn = Composer().Compose(
                typeof(FakeBurn), Request(centreBodyIndex: 99), Bodies, out var refusal);

            Assert.Null(burn);
            Assert.Contains("No such body", refusal);
        }

        [Fact]
        public void RefusesWhenTheBodyTableHasNotArrived()
        {
            // Not knowing the bodies is not the same as the index being fine, and
            // waving the check through on an empty table is how the check stops
            // meaning anything on a cold start.
            var burn = Composer().Compose(
                typeof(FakeBurn), Request(), Array.Empty<int>(), out var refusal);

            Assert.Null(burn);
            Assert.Contains("body table", refusal);
        }

        [Fact]
        public void RefusesAFrameABurnMayNotBeWrittenIn()
        {
            // 6004 is the pulsating frame: a burn is never expressed in one, and
            // the producer's own cast to a burn frame returns null for it.
            var burn = Composer().Compose(
                typeof(FakeBurn), Request(frameExtension: 6004), Bodies, out var refusal);

            Assert.Null(burn);
            Assert.Contains("not one a burn may be written in", refusal);
        }

        [Theory]
        [InlineData(0.0, 320.0)]
        [InlineData(60.0, 0.0)]
        public void RefusesAnEngineTheProducerWouldDivideByZeroOn(double thrust, double isp)
        {
            // Both divide inside the burn integration. The struct accepts zero
            // without complaint and every duration in the plan is then poisoned.
            var burn = Composer().Compose(
                typeof(FakeBurn), Request(thrust: thrust, isp: isp), Bodies, out var refusal);

            Assert.Null(burn);
            Assert.Contains("above zero", refusal);
        }

        [Fact]
        public void RefusesAnInstantThatIsNotANumber()
        {
            var burn = Composer().Compose(
                typeof(FakeBurn),
                Request(ignitionUt: double.NaN),
                Bodies,
                out var refusal);

            Assert.Null(burn);
            Assert.Contains("not a number", refusal);
        }

        [Fact]
        public void TheComposedBurnPassesTheSameCompletenessCheckACopiedOneDoes()
        {
            // The last gate before it leaves, and the same one the copy path runs.
            var burn = Composer().Compose(typeof(FakeBurn), Request(), Bodies, out _);

            Assert.Null(new PrincipiaBurnStruct().MissingBurnField(burn!));
        }
    }
}
