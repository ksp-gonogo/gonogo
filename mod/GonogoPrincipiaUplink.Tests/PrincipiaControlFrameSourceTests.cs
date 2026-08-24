using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The producer's plotting frame, answered as the generalised control frame.
    ///
    /// <para><b>The ordinals get their own assertions and that is not padding.</b>
    /// A previous table of these numbers was keyed 0 to 4, in an order matching
    /// neither the producer's declaration nor its numbering, so every real frame
    /// fell through to the unknown branch. Its test could not see the fault
    /// because it asserted the same invented keys the table was built from: the
    /// table and the test were wrong together and agreed. Every case below names
    /// the producer's own number literally, so a renumbering shows up here as a
    /// failure rather than as every frame quietly reading Unspecified.</para>
    /// </summary>
    public class PrincipiaControlFrameSourceTests
    {
        [Theory]
        [InlineData(6000, ControlFrameKind.BodyCentredInertial)]
        [InlineData(6001, ControlFrameKind.BarycentricRotating)]
        [InlineData(6002, ControlFrameKind.BodyCentredBodyDirection)]
        [InlineData(6003, ControlFrameKind.BodySurface)]
        [InlineData(6004, ControlFrameKind.RotatingPulsating)]
        public void EachProducerOrdinalMapsToItsOwnKind(int ordinal, ControlFrameKind expected)
        {
            Assert.Equal(expected, PrincipiaControlFrameSource.KindOf(ordinal));
        }

        [Theory]
        [InlineData(null)]
        [InlineData(0)]
        [InlineData(6005)]
        public void AnOrdinalTheProducerDoesNotHaveReadsAsUnspecified(int? ordinal)
        {
            // Including 0, which is what the earlier wrong table keyed the first
            // frame as. A guess here would put a frame on the wire the producer
            // does not have, and every reader would draw in it.
            Assert.Equal(ControlFrameKind.Unspecified, PrincipiaControlFrameSource.KindOf(ordinal));
        }

        [Fact]
        public void NothingObservedIsNoFrameRatherThanAnEmptyOne()
        {
            // A frame with no kind reads as an answer to anything that only checks
            // for a value, which is how a client ends up drawing in a frame nobody
            // selected.
            Assert.Null(PrincipiaControlFrameSource.Map(null));
        }

        [Fact]
        public void TheTargetFrameCarriesItsFlagRatherThanAnInventedKind()
        {
            // The target frame sits orthogonally to the kind enum: its selector
            // carries no kind at all. The flag is what says so.
            var frame = PrincipiaControlFrameSource.Map(new FrameObservation
            {
                Selector = "plotting",
                Type = null,
                TargetFrameSelected = true,
                TargetVesselId = "abc",
            });

            Assert.Equal(ControlFrameKind.Unspecified, frame?.Kind);
            Assert.True(frame?.TargetFrameSelected);
            Assert.Equal("abc", frame?.TargetId);
        }

        [Fact]
        public void ASideWithOnlyAHeadTravelsWithoutASet()
        {
            // Empty means "the head is the whole of it" rather than "not read", so
            // an empty array would make a reader choose between treating it as the
            // head and treating it as nothing.
            var frame = PrincipiaControlFrameSource.Map(new FrameObservation
            {
                Selector = "plotting",
                Type = 6000,
                CentreBody = "Kerbin",
            });

            Assert.Equal("Kerbin", frame?.CentreBody);
            Assert.Null(frame?.PrimaryBodies);
            Assert.Null(frame?.SecondaryBodies);
        }

        [Fact]
        public void APulsatingFrameCarriesBothWholeSidesAndNotJustTheHeads()
        {
            // The reason the sets travel at all: a Sun-Earth pulsating frame's
            // primary side is Sun, Mercury and Venus, and the origin is defined by
            // the mass of the whole side. Publishing the head alone loses two
            // bodies out of it, silently, because the head is the name a reader
            // recognises.
            var observed = new FrameObservation
            {
                Selector = "plotting",
                Type = 6004,
                PrimaryBody = "Sun",
                SecondaryBody = "Earth",
            };
            observed.PrimaryBodies.AddRange(new[] { "Sun", "Mercury", "Venus" });
            observed.SecondaryBodies.AddRange(new[] { "Earth", "Moon" });

            var frame = PrincipiaControlFrameSource.Map(observed);

            Assert.Equal(ControlFrameKind.RotatingPulsating, frame?.Kind);
            Assert.Equal(new[] { "Sun", "Mercury", "Venus" }, frame?.PrimaryBodies);
            Assert.Equal(new[] { "Earth", "Moon" }, frame?.SecondaryBodies);
            // The heads still lead their sides, so a reader wanting the pair takes
            // the heads and a reader computing the frame takes the sets.
            Assert.Equal("Sun", frame?.PrimaryBodies?[0]);
            Assert.Equal("Earth", frame?.SecondaryBodies?[0]);
        }

        [Fact]
        public void MovingTheProducersViewIsRefusedWithAReasonRatherThanReportingSuccess()
        {
            var source = new PrincipiaControlFrameSource(() => null);

            var result = source.SetFrame(new SetControlFrameArgs
            {
                Kind = ControlFrameKind.BodySurface,
            });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }
    }
}
