using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// A closest approach is published only as far as the provider vouches for both
    /// craft. The geometry is the two coplanar circles of
    /// <c>ClosestApproachIsAPropagationQuestionTests</c>, so the approach and its
    /// instant come from the real two-body solver, and only the horizon is staged.
    /// </summary>
    public class VouchedClosestApproachTests
    {
        private const int Kerbin = 0;
        private const double Mu = 3.5316e12;

        private static readonly PropagationTarget Inner = Craft("inner", 700_000.0, 0.0);
        private static readonly PropagationTarget Outer = Craft("outer", 900_000.0, 1.0);
        private static readonly PropagationFrame Frame = PropagationFrame.CentredOn(Kerbin);
        private static readonly double Window = 20.0 * PeriodOf(900_000.0);

        private static PropagationTarget Craft(string id, double radius, double phase) =>
            PropagationTarget.Vessel(
                id,
                Kerbin,
                new OrbitElements(
                    sma: radius, ecc: 0.0, inc: 0.0, lan: 0.0, argPe: 0.0,
                    meanAnomalyAtEpoch: phase, epoch: 0.0, mu: Mu));

        private static double PeriodOf(double radius) =>
            2.0 * Math.PI * Math.Sqrt(radius * radius * radius / Mu);

        private static double ApproachTime() =>
            new KeplerProvider().SolveClosestApproach(Inner, Outer, Frame, 0.0, Window)!.Time;

        [Fact]
        public void AnApproachInsideBothHorizonsIsTheProvidersOwn()
        {
            var at = ApproachTime();
            var provider = new HorizonProvider(new Dictionary<string, double>
            {
                ["inner"] = at + 60.0,
                ["outer"] = at + 60.0,
            });

            var approach = VouchedClosestApproach.Solve(provider, Inner, Outer, Frame, 0.0, Window);

            Assert.NotNull(approach);
            Assert.Equal(at, approach!.Time, 6);
            Assert.Equal(200_000.0, approach.Distance, 0);
        }

        [Fact]
        public void AnApproachPastTheSubjectsHorizonIsRefused()
        {
            var at = ApproachTime();
            var provider = new HorizonProvider(new Dictionary<string, double>
            {
                ["inner"] = at - 60.0,
                ["outer"] = at + 60.0,
            });

            Assert.Null(VouchedClosestApproach.Solve(provider, Inner, Outer, Frame, 0.0, Window));
        }

        [Fact]
        public void AnApproachPastTheOtherCraftsHorizonIsRefused()
        {
            var at = ApproachTime();
            var provider = new HorizonProvider(new Dictionary<string, double>
            {
                ["inner"] = at + 60.0,
                ["outer"] = at - 60.0,
            });

            Assert.Null(VouchedClosestApproach.Solve(provider, Inner, Outer, Frame, 0.0, Window));
        }

        [Fact]
        public void NoApproachStaysNoApproach()
        {
            var provider = new HorizonProvider(new Dictionary<string, double>
            {
                ["inner"] = Window,
                ["outer"] = Window,
            });

            Assert.Null(VouchedClosestApproach.Solve(provider, Inner, Outer, Frame, 0.0, 1.0));
        }

        /// <summary>
        /// The two-body solver with a horizon per craft, which is what an integrating
        /// provider looks like through the seam.
        /// </summary>
        private sealed class HorizonProvider : IPropagationProvider
        {
            private readonly IPropagationProvider _conics = new KeplerProvider();
            private readonly IReadOnlyDictionary<string, double> _spans;

            public HorizonProvider(IReadOnlyDictionary<string, double> spans)
            {
                _spans = spans;
            }

            public string ProviderId => "horizon-stub";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                _conics.Solve(target, frame, ut);

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into) =>
                _conics.SolveMany(target, frame, uts, into);

            public double? CharacteristicCycleSeconds(PropagationTarget target) =>
                _conics.CharacteristicCycleSeconds(target);

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) =>
                _conics.RadiusExtremesOf(target);

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) =>
                _conics.CanPropagate(target, frame, fromUt, toUt)
                && (target.Kind != PropagationTargetKind.Vessel
                    || toUt - fromUt <= _spans[target.Id!]);

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) =>
                _conics.SolveClosestApproach(subject, other, frame, fromUt, toUt);
        }
    }
}
