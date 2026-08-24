using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Which frame a burn built here is expressed in, taken from the frame the
    /// operator is looking at by the producer's own rule.
    /// </summary>
    public class PrincipiaComposedFrameTests
    {
        private static FrameObservation Viewing(
            int type, int? selected = 1, int? parent = 0, bool target = false) =>
            new FrameObservation
            {
                Selector = "plotting",
                Type = type,
                SelectedBodyIndex = selected,
                ParentBodyIndex = parent,
                TargetFrameSelected = target,
            };

        private static bool Resolve(
            FrameObservation? frame,
            out int extension,
            out int centre,
            out int primary,
            out int secondary) =>
            PrincipiaComposedFrame.TryResolve(
                frame, out extension, out centre, out primary, out secondary, out _);

        [Theory]
        [InlineData(6000)]
        [InlineData(6003)]
        public void ACentredViewGivesACentredBurnFrameOnTheSameBody(int type)
        {
            Assert.True(Resolve(Viewing(type), out var extension, out var centre, out var primary, out var secondary));

            Assert.Equal(type, extension);
            Assert.Equal(1, centre);
            // The pair slots stay empty: this kind never reads them, and an index
            // left in one is a claim nobody made.
            Assert.Equal(-1, primary);
            Assert.Equal(-1, secondary);
        }

        /// <summary>
        /// The direction kind names the pair with the SELECTED body first. That is
        /// the producer's own inversion rather than an ordering we chose: the body
        /// it wants held fixed is the one the selector sits on, and the frame it
        /// builds calls the held body the primary. Reversed, the burn is planned in
        /// a frame that turns the other way and every component means something
        /// else.
        /// </summary>
        [Fact]
        public void ADirectionViewNamesTheSelectedBodyFirst()
        {
            Assert.True(Resolve(Viewing(6002), out var extension, out var centre, out var primary, out var secondary));

            Assert.Equal(6002, extension);
            Assert.Equal(1, primary);
            Assert.Equal(0, secondary);
            // No body, because this kind does not centre on one. What actually
            // reaches the struct's centre slot is decided where the burn is
            // written, which is where the producer's own default belongs.
            Assert.Equal(-1, centre);
        }

        /// <summary>
        /// A pulsating view resolves to the direction frame on the same pair, which
        /// is what the producer's own planner falls back to. A burn cannot be
        /// expressed in a pulsating frame at all: reaching its factory is a fatal
        /// log, which ends the process.
        /// </summary>
        [Fact]
        public void APulsatingViewFallsBackToTheDirectionFrameOnItsPair()
        {
            Assert.True(
                Resolve(Viewing(6004), out var extension, out _, out var primary, out var secondary));

            Assert.Equal(6002, extension);
            Assert.Equal(1, primary);
            Assert.Equal(0, secondary);
        }

        /// <summary>
        /// The deprecated barycentric kind is not one this Uplink writes: it carries
        /// five constructor invariants, one of which fires when a frame names the
        /// same body twice. It resolves the same way the pulsating kind does.
        /// </summary>
        [Fact]
        public void ABarycentricViewAlsoResolvesToTheDirectionFrame()
        {
            Assert.True(Resolve(Viewing(6001), out var extension, out _, out _, out _));

            Assert.Equal(6002, extension);
        }

        /// <summary>
        /// A target frame is defined against a VESSEL and carries no kind at all, so
        /// there is no descriptor to build a burn from. Said rather than guessed at:
        /// picking a kind here would put a frame on the burn the operator never
        /// chose.
        /// </summary>
        [Fact]
        public void ATargetFrameIsRefusedRatherThanGuessedAt()
        {
            Assert.False(
                PrincipiaComposedFrame.TryResolve(
                    Viewing(6000, target: true), out _, out _, out _, out _, out var refusal));

            Assert.Contains("target vessel", refusal);
        }

        [Fact]
        public void AFrameThatHasNotBeenReadIsRefused()
        {
            Assert.False(
                PrincipiaComposedFrame.TryResolve(
                    null, out _, out _, out _, out _, out var refusal));

            Assert.Contains("has not been read", refusal);
        }

        /// <summary>
        /// A frame that turns about a pair needs both of them. The root body has no
        /// parent, and half a pair is not a frame.
        /// </summary>
        [Fact]
        public void ADirectionFrameOnABodyWithNoParentIsRefused()
        {
            Assert.False(
                PrincipiaComposedFrame.TryResolve(
                    Viewing(6002, selected: 0, parent: null),
                    out _, out _, out _, out _, out var refusal));

            Assert.Contains("incomplete", refusal);
        }
    }
}
