using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The control-frame election: who answers what frame the game's view is in,
    /// and who is allowed to move it.
    ///
    /// <para>A fake rather than stock's own source, deliberately: that one reads
    /// <c>FlightGlobals</c> and cannot compile here. What is asserted is the
    /// election and the refusals around it, not the frame.</para>
    /// </summary>
    public class ControlFrameElectionTests
    {
        private sealed class FakeFrameSource : IControlFrameSource
        {
            private readonly ControlFrame? _frame;
            private readonly bool _accepts;

            public FakeFrameSource(string id, ControlFrame? frame, bool accepts)
            {
                ProviderId = id;
                _frame = frame;
                _accepts = accepts;
            }

            public string ProviderId { get; }

            public SetControlFrameArgs? LastSet { get; private set; }

            public ControlFrame? Frame => _frame;

            public CommandResult SetFrame(SetControlFrameArgs frame)
            {
                LastSet = frame;
                return _accepts
                    ? CommandResult.Ok()
                    : CommandResult.Fail(CommandErrorCode.ModeUnavailable, "cannot be set");
            }
        }

        private static ControlFrame Kerbin() => new ControlFrame
        {
            Kind = ControlFrameKind.BodyCentredInertial,
            CentreBody = "Kerbin",
        };

        private static Kernel Resolved(FakeFrameSource vanilla, FakeFrameSource? competitor = null)
        {
            var kernel = new Kernel();
            ControlFrameElection.RegisterCapability(kernel, _ => vanilla);
            if (competitor != null)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = ControlFrameElection.CapabilityId,
                    Id = competitor.ProviderId,
                    Priority = 100,
                    Factory = _ => competitor,
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel;
        }

        [Fact]
        public void TheVanillaAnswersWithNoCompetitor()
        {
            var kernel = Resolved(new FakeFrameSource("vanilla", Kerbin(), accepts: false));

            Assert.Equal("Kerbin", ControlFrameElection.Elected(kernel)?.CentreBody);
        }

        [Fact]
        public void ARegisteredProviderIsElectedOverTheVanilla()
        {
            // The path that makes an n-body producer's frame reachable at all. The
            // two answers differ, so a test that read the vanilla's would fail
            // rather than pass on a coincidence.
            var kernel = Resolved(
                new FakeFrameSource("vanilla", Kerbin(), accepts: false),
                new FakeFrameSource(
                    "competitor",
                    new ControlFrame
                    {
                        Kind = ControlFrameKind.RotatingPulsating,
                        PrimaryBody = "Kerbol",
                        SecondaryBody = "Kerbin",
                    },
                    accepts: true));

            var frame = ControlFrameElection.Elected(kernel);
            Assert.Equal(ControlFrameKind.RotatingPulsating, frame?.Kind);
            Assert.Equal("Kerbin", frame?.SecondaryBody);
        }

        [Fact]
        public void TheSourceThatREPORTSTheViewIsTheOneAskedToMoveIt()
        {
            // The point of putting the write on the same interface. If the read and
            // the write could elect separately, an install could report one frame
            // and move another, and nothing downstream could tell.
            var vanilla = new FakeFrameSource("vanilla", Kerbin(), accepts: false);
            var competitor = new FakeFrameSource("competitor", Kerbin(), accepts: true);
            var kernel = Resolved(vanilla, competitor);

            var result = ControlFrameElection.Set(
                kernel, new SetControlFrameArgs { Kind = ControlFrameKind.BodySurface });

            Assert.True(result.Success);
            Assert.Equal(ControlFrameKind.BodySurface, competitor.LastSet?.Kind);
            Assert.Null(vanilla.LastSet);
        }

        [Fact]
        public void ASourceThatCannotHonourAFrameRefusesRatherThanReportingSuccess()
        {
            // Stock is this case in production: its frame follows the craft's
            // reference body. A success that moved nothing would leave an operator
            // reading the next number in the wrong frame.
            var kernel = Resolved(new FakeFrameSource("vanilla", Kerbin(), accepts: false));

            var result = ControlFrameElection.Set(
                kernel, new SetControlFrameArgs { Kind = ControlFrameKind.BodySurface });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Fact]
        public void AnUnsatisfiedCapabilityRefusesInsteadOfThrowing()
        {
            // "Nothing here owns the view" is an answer an operator can act on. A
            // throw here would surface as a dead command instead.
            var result = ControlFrameElection.Set(
                null, new SetControlFrameArgs { Kind = ControlFrameKind.BodySurface });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        [Fact]
        public void AFrameThatNeverArrivedRefusesRatherThanMovingTheViewToNothing()
        {
            var kernel = Resolved(new FakeFrameSource("vanilla", Kerbin(), accepts: true));

            var result = ControlFrameElection.Set(kernel, null);

            Assert.False(result.Success);
        }

        [Fact]
        public void NothingElectedReadsAsNoFrameRatherThanAGuess()
        {
            Assert.Null(ControlFrameElection.Elected(null));
        }
    }
}
