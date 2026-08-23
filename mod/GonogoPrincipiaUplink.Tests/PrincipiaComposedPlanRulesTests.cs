using System;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The rule that decides whether a plan composed at a command centre may be
    /// installed on the craft that received it, a light-time later.
    /// </summary>
    public class PrincipiaComposedPlanRulesTests
    {
        private static PrincipiaComposedBurn Burn(double ignitionUt, double tangent = 100) =>
            new PrincipiaComposedBurn
            {
                IgnitionUt = ignitionUt,
                DeltaVTangent = tangent,
                DeltaVNormal = 0,
                DeltaVBinormal = 0,
                InertiallyFixed = false,
            };

        private static PrincipiaPlanSendArgs Plan(params PrincipiaComposedBurn[] burns) =>
            new PrincipiaPlanSendArgs { VesselId = "v", RequestId = "r", Burns = burns };

        [Fact]
        public void AcceptsAPlanWhoseBurnsAreAllStillAhead()
        {
            var refusal = PrincipiaComposedPlanRules.Reject(
                Plan(Burn(2000), Burn(3000)), nowUt: 1000);

            Assert.Null(refusal);
        }

        [Fact]
        public void RefusesTheWHOLEPlanWhenOneBurnHasAlreadyPassed()
        {
            // The case the whole rule exists for. Composed when every burn was ahead,
            // arrived a light-time later with the first already gone. Installing burns
            // two and three would fly a plan nobody composed, around a gap the sender
            // does not yet know exists.
            var refusal = PrincipiaComposedPlanRules.Reject(
                Plan(Burn(900), Burn(2000), Burn(3000)), nowUt: 1000);

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.IgnitionInPast, refusal!.Value.Refusal);
            Assert.Contains("whole plan is refused", refusal.Value.Detail!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void JudgesAgainstArrivalRatherThanComposition()
        {
            // Identical plan, two arrival instants. At composition every burn was
            // comfortably ahead; the plan is only unusable because of how long it took
            // to get there, which is exactly what the sender cannot see.
            var plan = Plan(Burn(1500), Burn(2500));
            plan.ComposedAtViewUt = 1000;

            Assert.Null(PrincipiaComposedPlanRules.Reject(plan, nowUt: 1000));
            Assert.NotNull(PrincipiaComposedPlanRules.Reject(plan, nowUt: 1600));
        }

        [Fact]
        public void AMissingBurnListIsNotAnEmptyPlan()
        {
            // A command that lost its payload must not read as "clear this craft's
            // plan". The two are one null apart and one of them is destructive.
            var refusal = PrincipiaComposedPlanRules.Reject(
                new PrincipiaPlanSendArgs { VesselId = "v", Burns = null }, nowUt: 1000);

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.PlanMalformed, refusal!.Value.Refusal);
        }

        [Fact]
        public void AnEmptyPlanIsAllowedBecauseClearingIsAThingToSend()
        {
            var refusal = PrincipiaComposedPlanRules.Reject(
                Plan(Array.Empty<PrincipiaComposedBurn>()), nowUt: 1000);

            Assert.Null(refusal);
        }

        [Fact]
        public void RefusesBurnsThatAreNotInTimeOrder()
        {
            // Either composed wrongly or reordered in transit. Installing it puts a
            // manoeuvre before one it depends on.
            var refusal = PrincipiaComposedPlanRules.Reject(
                Plan(Burn(3000), Burn(2000)), nowUt: 1000);

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.PlanMalformed, refusal!.Value.Refusal);
        }

        [Fact]
        public void RefusesTwoBurnsAtTheSameInstant()
        {
            var refusal = PrincipiaComposedPlanRules.Reject(
                Plan(Burn(2000), Burn(2000)), nowUt: 1000);

            Assert.NotNull(refusal);
        }

        [Fact]
        public void RefusesAValueThatIsNotANumberRatherThanInstallingAGuess()
        {
            var refusal = PrincipiaComposedPlanRules.Reject(
                Plan(Burn(2000), Burn(3000, tangent: double.NaN)), nowUt: 1000);

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.ValueNotFinite, refusal!.Value.Refusal);
        }

        [Fact]
        public void RefusesMoreBurnsThanOneCommandMayInstall()
        {
            var many = new PrincipiaComposedBurn[PrincipiaComposedPlanRules.MaxBurns + 1];
            for (var i = 0; i < many.Length; i++)
            {
                many[i] = Burn(2000 + i * 10);
            }

            var refusal = PrincipiaComposedPlanRules.Reject(Plan(many), nowUt: 1000);

            Assert.NotNull(refusal);
            Assert.Equal(PrincipiaWriteRefusal.PlanMalformed, refusal!.Value.Refusal);
        }

        [Fact]
        public void RefusesAPlanThatEndsBeforeItsOwnLastBurn()
        {
            var plan = Plan(Burn(2000), Burn(3000));
            plan.DesiredFinalTimeUt = 2500;

            var refusal = PrincipiaComposedPlanRules.Reject(plan, nowUt: 1000);

            Assert.NotNull(refusal);
            Assert.Contains("last burn", refusal!.Value.Detail!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void ReportsHowStaleThePlanningStateWasOnArrival()
        {
            // Not a judgement. A large gap is normal at a distant vantage, and it is
            // what an operator needs to read a divergence between the trajectory they
            // approved and the one the craft is now on.
            var plan = Plan(Burn(5000));
            plan.ObservedAtUt = 400;

            Assert.Equal(1400, PrincipiaComposedPlanRules.PlanningAgeSeconds(plan, nowUt: 1800));
            plan.ObservedAtUt = null;
            Assert.Null(PrincipiaComposedPlanRules.PlanningAgeSeconds(plan, nowUt: 1800));
        }
    }
}
