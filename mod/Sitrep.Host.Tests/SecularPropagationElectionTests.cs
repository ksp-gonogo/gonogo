using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Comms;
using Sitrep.Host.Propagation;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Host.Tests
{
    public class SecularPropagationElectionTests
    {
        private const double KerbinMu = 3.5316e12;

        private static readonly PropagationTarget Craft = PropagationTarget.Vessel(
            "vessel:relay", 1, new OrbitElements(1_300_000.0, 0.2, 0.6, 1.0, 2.0, 3.0, 100.0, KerbinMu));

        private static Kernel Resolved(Action<Kernel>? registerProviders = null)
        {
            var kernel = new Kernel();
            PropagationElection.RegisterCapability(kernel);
            registerProviders?.Invoke(kernel);
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel;
        }

        private static Kernel Electing(IPropagationProvider provider) =>
            Resolved(k => k.RegisterProvider(new ProviderRegistration
            {
                Capability = PropagationElection.CapabilityId,
                Id = provider.ProviderId,
                Priority = 100.0,
                Factory = _ => provider,
            }));

        [Fact]
        public void TheStockSolverOffersNoSecularModel()
        {
            Assert.Null(PropagationElection.Secular(Resolved()));
            Assert.Null(PropagationElection.Secular(null));
        }

        [Fact]
        public void AnElectedProviderWithASecularModelIsReachedThroughTheElectionAndConforms()
        {
            var secular = PropagationElection.Secular(Electing(new DriftingProvider()));

            Assert.NotNull(secular);
            SecularPropagationConformance.AssertSecularPropagationContract(secular!, Craft, 100.0);
            Assert.Equal(SecularBasis.J2Estimate, secular!.SecularOrbitFor(Craft, 100.0)!.Value.Basis);
        }

        [Fact]
        public void TheConformanceAssertionRefusesASeedForABodyAndASeedThatEndsBeforeItStarts()
        {
            Assert.ThrowsAny<XunitException>(() =>
                SecularPropagationConformance.AssertSecularPropagationContract(new DriftingProvider(answersBodies: true), Craft, 100.0));
            Assert.ThrowsAny<XunitException>(() =>
                SecularPropagationConformance.AssertSecularPropagationContract(new DriftingProvider(span: -1.0), Craft, 100.0));
        }

        [Fact]
        public void AProviderThatThrowsOrHandsBackAnUnusableSeedLeavesTheCraftOnItsConic()
        {
            Assert.Null(ContactSeeds.Read(new ThrowingProvider(), Craft, 100.0));
            Assert.Null(ContactSeeds.Read(new DriftingProvider(span: -1.0), Craft, 100.0));
            Assert.NotNull(ContactSeeds.Read(new DriftingProvider(), Craft, 100.0));

            var orbit = Craft.Osculating!.Value;
            Assert.False(ContactSeeds.Usable(new SecularOrbit(orbit, double.NaN, 0.0, 1e-3, null, SecularBasis.J2Estimate), 100.0));
            var open = new OrbitElements(-1e7, 1.2, 0.0, 0.0, 0.0, 0.0, 100.0, KerbinMu);
            Assert.False(ContactSeeds.Usable(new SecularOrbit(open, 0.0, 0.0, 1e-3, null, SecularBasis.J2Estimate), 100.0));
        }

        private sealed class ThrowingProvider : ISecularPropagation
        {
            public SecularOrbit? SecularOrbitFor(PropagationTarget target, double ut) =>
                throw new InvalidOperationException("the provider's own state is broken");
        }

        /// <summary>A provider that rates a craft's drift from a fixed node and periapsis rate, the way a J2 estimate would.</summary>
        private sealed class DriftingProvider : IPropagationProvider, ISecularPropagation
        {
            private readonly bool _answersBodies;
            private readonly double _span;

            public DriftingProvider(bool answersBodies = false, double span = 86_400.0)
            {
                _answersBodies = answersBodies;
                _span = span;
            }

            public string ProviderId => "a-drifting-backend";

            public SecularOrbit? SecularOrbitFor(PropagationTarget target, double ut)
            {
                var elements = target.Osculating ?? new OrbitElements(1_000_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, ut, KerbinMu);
                if (target.Kind != PropagationTargetKind.Vessel && !_answersBodies)
                {
                    return null;
                }
                var meanMotion = Math.Sqrt(elements.Mu / Math.Pow(elements.Sma, 3));
                return new SecularOrbit(elements, -1e-6, 2e-6, meanMotion, elements.Epoch + _span, SecularBasis.J2Estimate);
            }

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(PropagationTarget target, PropagationFrame frame, IReadOnlyList<double> uts, StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => false;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject, PropagationTarget other, PropagationFrame frame, double fromUt, double toUt) => null;
        }
    }
}
