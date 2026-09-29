using System;
using System.Reflection;
using Gonogo.KSP.Tests.CurrencyDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>
    /// <c>ksp.launch</c> on a craft this install cannot build, and on a save that
    /// throws on the way into flight. On the rig, KSP logged "Could not locate
    /// root part" and the launch went ahead; the save inside
    /// <c>FlightDriver.StartWithNewLaunch</c> then threw a
    /// <c>ReflectionTypeLoadException</c>, which reached the engine as a handler
    /// throw and marked <c>ksp.launch</c> unavailable for the rest of the session.
    /// </summary>
    public class LaunchRuleTests
    {
        [Fact]
        public void ACraftWhosePartsAllResolveAndHasARootIsNotRefused()
        {
            Assert.Null(LaunchRule.UnresolvedCraft(Array.Empty<string>(), rootLocated: true));
        }

        [Fact]
        public void ACraftWithMissingPartsIsRefusedNamingThem()
        {
            var refusal = LaunchRule.UnresolvedCraft(new[] { "kxRadiator", "bdbMercuryPod" }, rootLocated: true);

            Assert.NotNull(refusal);
            Assert.False(refusal!.Success);
            Assert.Equal(CommandErrorCode.CapabilityMismatch, refusal.ErrorCode);
            Assert.Contains("kxRadiator", refusal.Detail);
            Assert.Contains("bdbMercuryPod", refusal.Detail);
        }

        /// <summary>
        /// A craft can use one missing part many times; the refusal names it
        /// once, and a long list is summarised rather than quoted whole.
        /// </summary>
        [Fact]
        public void MissingPartNamesAreQuotedOnceAndALongListIsSummarised()
        {
            var refusal = LaunchRule.UnresolvedCraft(
                new[] { "a", "a", "b", "c", "d", "e", "f", "g" }, rootLocated: true);

            Assert.Equal("the craft uses parts this install does not have: a, b, c, d, e and 2 more", refusal!.Detail);
        }

        /// <summary>
        /// The rig's craft: every part may be known, and KSP still could not
        /// root the tree. <c>ShipTemplate.LoadShip</c> only logs that.
        /// </summary>
        [Fact]
        public void ACraftWhoseRootCannotBeLocatedIsRefused()
        {
            var refusal = LaunchRule.UnresolvedCraft(Array.Empty<string>(), rootLocated: false);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.CapabilityMismatch, refusal!.ErrorCode);
            Assert.Contains("root part", refusal.Detail);
        }

        [Fact]
        public void MissingPartsAreReportedAheadOfTheMissingRoot()
        {
            var refusal = LaunchRule.UnresolvedCraft(new[] { "kxRadiator" }, rootLocated: false);

            Assert.Contains("kxRadiator", refusal!.Detail);
        }

        [Fact]
        public void APlacementThatDoesNotThrowSucceeds()
        {
            var calls = 0;

            var result = LaunchRule.Place(() => calls++);

            Assert.True(result.Success);
            Assert.Equal(1, calls);
        }

        /// <summary>
        /// The save's throw comes back as this call's refusal. Were it to escape,
        /// the engine's fail-soft would mark the command unavailable for the
        /// session, and every later launch would be refused without running.
        /// </summary>
        [Fact]
        public void ASaveThatThrowsRefusesThisCallInsteadOfEscaping()
        {
            var result = LaunchRule.Place(() =>
                throw new ReflectionTypeLoadException(Array.Empty<Type>(), null, "Unable to load one or more of the requested types."));

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Contains("Unable to load one or more of the requested types.", result.Detail);
        }

        private static string LaunchBody() =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspFlightOpsActuator.cs"),
                "public CommandResult Launch(string shipName, EditorFacilityKind facility, string site, IReadOnlyList<string> crew)");

        /// <summary>
        /// The actuator reaches <c>FlightDriver</c> and <c>PartLoader</c>, none of
        /// which runs headlessly, so the wiring is read off the shipped source:
        /// the craft is judged before KSP's own launch tests, and the game is
        /// only ever entered through <see cref="LaunchRule.Place"/>.
        /// </summary>
        [Fact]
        public void LaunchRefusesAnUnresolvedCraftAndPlacesOnlyThroughTheRule()
        {
            var body = LaunchBody();

            var unresolved = body.IndexOf("LaunchRule.UnresolvedCraft(", StringComparison.Ordinal);
            var preflight = body.IndexOf("LaunchPreflight.FirstRefusal(", StringComparison.Ordinal);
            var place = body.IndexOf("LaunchRule.Place(() => FlightDriver.StartWithNewLaunch(", StringComparison.Ordinal);

            Assert.True(unresolved >= 0, "Launch must refuse a craft whose parts or root do not resolve");
            Assert.True(preflight >= 0 && unresolved < preflight, "the craft must be judged before KSP's launch tests run on it");
            Assert.True(place >= 0, "Launch must enter the game through LaunchRule.Place");
            Assert.Equal(
                body.IndexOf("FlightDriver.StartWithNewLaunch(", StringComparison.Ordinal),
                body.LastIndexOf("FlightDriver.StartWithNewLaunch(", StringComparison.Ordinal));
        }
    }
}
