using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The refusal register, and the two structural properties that make it worth
    /// having: nothing can be called that the register has not cleared, and nothing
    /// the register clears is unreachable through the gates.
    /// </summary>
    public class PrincipiaCallsTests
    {
        public static IEnumerable<object[]> RefusedByName() =>
            PrincipiaCalls.Refused.Keys.Select(name => new object[] { name });

        [Theory]
        [MemberData(nameof(RefusedByName))]
        public void EveryRefusedCallIsRefusedWithItsOwnReason(string name)
        {
            var thrown = Assert.Throws<PrincipiaRefusedCallException>(
                () => PrincipiaCalls.RequireAllowed(name));

            Assert.Contains(name, thrown.Message);
            Assert.Contains(PrincipiaCalls.Refused[name], thrown.Message);
        }

        /// <summary>
        /// The five collision entry points are one indivisible transaction with no
        /// cancel, so entering it at all commits us to finishing it in that frame.
        /// They were missed by the first enumeration because they are named after
        /// their mechanism rather than the surface they serve, which is why they are
        /// pinned by name here rather than left to a family screen.
        /// </summary>
        [Theory]
        [InlineData("CollisionNewPredictionExecutor")]
        [InlineData("CollisionNewFlightPlanExecutor")]
        [InlineData("CollisionGetLatitudeLongitude")]
        [InlineData("CollisionSetRadius")]
        [InlineData("CollisionDeleteExecutor")]
        public void TheWholeCollisionTransactionIsRefused(string name) =>
            Assert.Throws<PrincipiaRefusedCallException>(() => PrincipiaCalls.RequireAllowed(name));

        [Theory]
        [InlineData("FlightPlanRenderedApsides")]
        [InlineData("FlightPlanRenderedNodes")]
        [InlineData("FlightPlanRenderedClosestApproaches")]
        [InlineData("FlightPlanRenderedSegment")]
        [InlineData("RenderedPredictionApsides")]
        [InlineData("RenderedPredictionNodes")]
        [InlineData("RenderedPredictionClosestApproaches")]
        // Not a member of the family today. The screen has to refuse the name
        // SHAPE, not the seven names we happen to know, or a release that adds one
        // gets it cleared by our not having heard of it.
        [InlineData("VesselRenderedTrajectory")]
        public void TheWholeRenderedFamilyIsRefused(string name) =>
            Assert.Throws<PrincipiaRefusedCallException>(() => PrincipiaCalls.RequireAllowed(name));

        [Theory]
        [InlineData("FlightPlanCreate")]
        [InlineData("FlightPlanDelete")]
        [InlineData("FlightPlanInsert")]
        [InlineData("FlightPlanRemoveLast")]
        [InlineData("FlightPlanReplace")]
        [InlineData("FlightPlanSelect")]
        [InlineData("FlightPlanSetAdaptiveStepParameters")]
        [InlineData("FlightPlanRebase")]
        [InlineData("FlightPlanDuplicate")]
        [InlineData("FlightPlanUpdateFromOptimization")]
        [InlineData("FlightPlanOptimizationDriverInProgress")]
        [InlineData("UpdatePrediction")]
        public void WritesAreRefusedWhereverTheVerbAppearsInTheName(string name) =>
            Assert.Throws<PrincipiaRefusedCallException>(() => PrincipiaCalls.RequireAllowed(name));

        /// <summary>
        /// The verb screen matches WORDS, and this is the case that decides it.
        ///
        /// <para>A substring screen refuses <c>FlightPlanSelected</c>, a cleared
        /// read the ten-slot plan model needs, for containing <c>Select</c>, which
        /// is a different word. A prefix screen is no use at all, because none of
        /// the writes starts with its verb. Splitting the PascalCase name is what
        /// separates the two.</para>
        /// </summary>
        [Fact]
        public void ASelectedReadIsNotASelectWrite()
        {
            PrincipiaCalls.RequireAllowed("FlightPlanSelected");
            Assert.Throws<PrincipiaRefusedCallException>(
                () => PrincipiaCalls.RequireAllowed("FlightPlanSelect"));
        }

        [Theory]
        [InlineData("NavballOrientation")]
        [InlineData("PartGetActualRigidMotion")]
        [InlineData("PartIsTruthful")]
        [InlineData("VesselGetPlottingFramePayload")]
        [InlineData("UnmanageableVesselVelocity")]
        [InlineData("HasEncounteredApocalypse")]
        [InlineData("EquipotentialCount")]
        [InlineData("PlanetariumPlotPsychohistory")]
        [InlineData("GraphNewGraph")]
        public void ReadShapedCallsWhoseBodiesWereNeverReadAreRefused(string name)
        {
            var thrown = Assert.Throws<PrincipiaRefusedCallException>(
                () => PrincipiaCalls.RequireAllowed(name));

            Assert.Contains(name, thrown.Message);
        }

        [Fact]
        public void AnUnknownCallIsRefusedRatherThanAssumedHarmless()
        {
            var thrown = Assert.Throws<PrincipiaRefusedCallException>(
                () => PrincipiaCalls.RequireAllowed("VesselSomethingNobodyHasRead"));

            Assert.Contains("not on the audited list", thrown.Message);
        }

        [Fact]
        public void TheAllowlistAndTheRefusalsAreDisjoint()
        {
            var overlap = PrincipiaCalls.Allowed
                .Where(name => PrincipiaCalls.Refused.ContainsKey(name))
                .ToList();

            Assert.Empty(overlap);
        }

        /// <summary>
        /// Nothing on the allowlist trips the screens, which is the check that
        /// stops the two halves drifting apart. An entry that trips a screen is a
        /// call that would be refused at bind time anyway, so it would be a claim
        /// of coverage the register does not have.
        /// </summary>
        [Fact]
        public void EveryAllowedCallSurvivesItsOwnScreens()
        {
            foreach (var name in PrincipiaCalls.Allowed)
            {
                PrincipiaCalls.RequireAllowed(name);
            }
        }

        /// <summary>
        /// The completeness ratchet, run in both directions.
        ///
        /// <para>Every call the port names must be cleared, so no unaudited call
        /// can be reached; and every cleared call must be named by the port, so the
        /// allowlist cannot grow entries nothing uses and quietly become a list of
        /// things somebody once thought about. The report the safety analysis makes
        /// about its own method applies here: an enumeration that cannot certify
        /// its completeness reports the same "all clear" as an empty one.</para>
        ///
        /// <para>The port carries the WRITE half too, so the cleared set is the
        /// union of the two registers. Keeping them as two lists and one union is
        /// the point: the read register refuses anything with a write verb, which is
        /// what stops a write being acquired by adding a name to the read list.</para>
        /// </summary>
        [Fact]
        public void ThePortAndTheAllowlistNameExactlyTheSameCalls()
        {
            var portType = typeof(PrincipiaSession).Assembly
                .GetType("GonogoPrincipiaUplink.IPrincipiaPlugin");
            Assert.NotNull(portType);

            var portNames = portType!.GetMethods()
                .Select(m => m.Name)
                // Neither of these is a Principia call. WritesBound reports whether
                // the write half BOUND, and BurnType reports the type off a bound
                // signature; both are on the port because only the port knows.
                .Where(n => n != "WritesBound" && n != "BurnType")
                .OrderBy(n => n)
                .ToArray();
            var allowed = PrincipiaCalls.Allowed
                .Concat(PrincipiaWriteCalls.Allowed)
                .Concat(PrincipiaWriteCalls.AllowedReads)
                .OrderBy(n => n)
                .ToArray();

            Assert.Equal(allowed, portNames);
        }

        /// <summary>
        /// The port stays internal, so nothing outside this assembly can hold the
        /// unguarded surface. The gates are the public API and the raw calls are
        /// not reachable around them.
        /// </summary>
        [Fact]
        public void ThePortIsNotPublic()
        {
            var portType = typeof(PrincipiaSession).Assembly
                .GetType("GonogoPrincipiaUplink.IPrincipiaPlugin");

            Assert.NotNull(portType);
            Assert.False(portType!.IsPublic);
        }

        /// <summary>
        /// The binder refuses BEFORE it looks at the type, so the refusal holds in
        /// a process with no Principia in it. A guard that only fires once the mod
        /// is installed is a guard that never fires in a test.
        /// </summary>
        [Fact]
        public void TheBinderRefusesARefusedNameWithoutTouchingTheType()
        {
            Assert.Throws<PrincipiaRefusedCallException>(
                () => Bind(typeof(NotPrincipia), "FlightPlanRenderedApsides"));
            Assert.Throws<PrincipiaRefusedCallException>(
                () => Bind(typeof(NotPrincipia), "CollisionDeleteExecutor"));
        }

        [Fact]
        public void TheBinderResolvesAnAllowedNameWhenTheShapeMatches()
        {
            Assert.NotNull(Bind(typeof(NotPrincipia), "HasVessel"));
            Assert.Null(Bind(typeof(NotPrincipia), "CurrentTime"));
        }

        /// <summary>Stands in for Principia's forwarder: one audited name present,
        /// one absent, so both branches of the bind are reachable with the mod
        /// gone.</summary>
        private static class NotPrincipia
        {
            internal static bool HasVessel(IntPtr plugin, string vesselGuid) => false;
        }

        private static MethodInfo? Bind(Type forwarder, string name)
        {
            var binder = typeof(PrincipiaSession).Assembly
                .GetType("GonogoPrincipiaUplink.ReflectedPrincipiaPlugin");
            Assert.NotNull(binder);
            var method = binder!.GetMethod(
                "BindMethod", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
            Assert.NotNull(method);
            try
            {
                return (MethodInfo?)method!.Invoke(null, new object?[] { forwarder, name });
            }
            catch (TargetInvocationException ex) when (ex.InnerException != null)
            {
                throw ex.InnerException;
            }
        }
    }
}
