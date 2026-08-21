using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// The launch refusal KSP already knows how to make, and used to make on its
    /// own button while the console launched anyway.
    ///
    /// <para><c>PreFlightTests.IPreFlightTest</c> is the game's launch refusal
    /// vocabulary and it is designed to be enumerated: <c>Test()</c> is a pure
    /// query and the four string members are the game's own words for the
    /// answer. What this exercises is the WALK over that set: that a failing
    /// test stops the launch, that the first failure in stock's order is the one
    /// reported, and that the refusal carries the game's sentence rather than
    /// one composed here.</para>
    ///
    /// <para>The tests themselves are faked, deliberately. Every real
    /// implementation reaches something a headless process does not have
    /// (<c>PSystemSetup</c>, <c>Funding</c>, <c>ShipConstruction</c>,
    /// <c>PartLoader</c>), but the interface is just an interface, so the walk
    /// over them is enterable while the bodies are not. Which stock tests get
    /// built, and with which limits, is asserted against the decompiled
    /// registration in <see cref="Gonogo.KSP.LaunchPreflight"/>'s own doc
    /// comment; it cannot be run here.</para>
    /// </summary>
    public class LaunchPreflightTests
    {
        [Fact]
        public void ALaunchWithEveryPreFlightTestPassingIsNotRefused()
        {
            var refusal = LaunchPreflight.FirstRefusal(new[]
            {
                Check(passes: true, CommandErrorCode.InsufficientFunds),
                Check(passes: true, CommandErrorCode.LimitReached),
            });

            Assert.Null(refusal);
        }

        [Fact]
        public void AFailingPreFlightTestRefusesTheLaunchWithItsOwnCode()
        {
            var refusal = LaunchPreflight.FirstRefusal(new[]
            {
                Check(passes: true, CommandErrorCode.InsufficientFunds),
                Check(passes: false, CommandErrorCode.LimitReached, "Craft is too heavy"),
            });

            Assert.NotNull(refusal);
            Assert.False(refusal!.Success);
            Assert.Equal(CommandErrorCode.LimitReached, refusal.ErrorCode);
        }

        /// <summary>
        /// The description is what the player would have read on the game's own
        /// warning dialog, so it is what the console quotes.
        /// </summary>
        [Fact]
        public void TheRefusalQuotesTheGamesOwnWordsForIt()
        {
            var refusal = LaunchPreflight.FirstRefusal(new[]
            {
                Check(passes: false, CommandErrorCode.SiteOccupied, "There is a vessel on the Launch Pad"),
            });

            Assert.Equal("There is a vessel on the Launch Pad", refusal!.Detail);
        }

        /// <summary>
        /// A title-only test (KSP caches several descriptions lazily and returns
        /// empty until it has) still says something rather than nothing.
        /// </summary>
        [Fact]
        public void ARefusalWithNoDescriptionFallsBackToTheGamesTitle()
        {
            var refusal = LaunchPreflight.FirstRefusal(new[]
            {
                Check(passes: false, CommandErrorCode.FacilityDamaged, description: "", title: "Facility Closed"),
            });

            Assert.Equal("Facility Closed", refusal!.Detail);
        }

        /// <summary>
        /// Stock runs its tests in a fixed order and shows the first failure.
        /// Reporting a later one would tell the operator to fix the wrong thing.
        /// </summary>
        [Fact]
        public void TheFirstFailureInStocksOrderIsTheOneReported()
        {
            var refusal = LaunchPreflight.FirstRefusal(new[]
            {
                Check(passes: false, CommandErrorCode.LimitReached, "Too many parts"),
                Check(passes: false, CommandErrorCode.InsufficientFunds, "Cannot afford"),
            });

            Assert.Equal(CommandErrorCode.LimitReached, refusal!.ErrorCode);
        }

        /// <summary>
        /// The limits are numbers, and a refusal that carries them can say "412 t
        /// against 140 t" instead of asking the operator to go and look.
        /// </summary>
        [Fact]
        public void ALimitRefusalCarriesTheComparisonThatCausedIt()
        {
            var breach = new LimitBreach
            {
                Facility = "LaunchPad",
                Quantity = "mass",
                Limit = 140,
                Actual = 412,
                Unit = Units.Tonnes,
            };

            var refusal = LaunchPreflight.FirstRefusal(new[]
            {
                new LaunchCheck(new FakePreFlightTest(false, "Too heavy", "Too heavy"),
                    CommandErrorCode.LimitReached, breach),
            });

            Assert.Same(breach, refusal!.Breach);
        }

        /// <summary>
        /// A test whose own <c>Test()</c> throws must not launch the craft. An
        /// unreadable gate is not a passed one, which is the direction every
        /// gate in this mod fails in.
        /// </summary>
        [Fact]
        public void APreFlightTestThatThrowsRefusesRatherThanPassing()
        {
            var refusal = LaunchPreflight.FirstRefusal(new[]
            {
                new LaunchCheck(new ThrowingPreFlightTest(), CommandErrorCode.LimitReached),
            });

            Assert.NotNull(refusal);
            Assert.False(refusal!.Success);
        }

        private static LaunchCheck Check(
            bool passes,
            CommandErrorCode code,
            string description = "because",
            string title = "Cannot Launch") =>
            new LaunchCheck(new FakePreFlightTest(passes, title, description), code);

        private sealed class FakePreFlightTest : PreFlightTests.IPreFlightTest
        {
            private readonly bool _passes;
            private readonly string _title;
            private readonly string _description;

            public FakePreFlightTest(bool passes, string title, string description)
            {
                _passes = passes;
                _title = title;
                _description = description;
            }

            public bool Test() => _passes;
            public string GetWarningTitle() => _title;
            public string GetWarningDescription() => _description;
            public string GetProceedOption() => null!;
            public string GetAbortOption() => null!;
        }

        private sealed class ThrowingPreFlightTest : PreFlightTests.IPreFlightTest
        {
            public bool Test() => throw new System.InvalidOperationException("no scene");
            public string GetWarningTitle() => "";
            public string GetWarningDescription() => "";
            public string GetProceedOption() => null!;
            public string GetAbortOption() => null!;
        }
    }
}
