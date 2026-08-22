using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Propagation;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The propagation election: stock two-body vanilla always present, any provider
    /// elected over it generically.
    ///
    /// <para>Deliberately mirrors ReliabilityElection rather than CommsElection,
    /// which carries a mod-named public triple (<c>XProviderId</c>,
    /// <c>XPriority</c>, <c>RegisterXProvider</c>), the thing core is not supposed
    /// to do: a provider announces itself through
    /// <see cref="IPropagationProvider.ProviderId"/> and registers through the
    /// kernel's own generic path, so nothing here has ever heard of any particular
    /// physics mod.</para>
    /// </summary>
    public class PropagationElectionTests
    {
        private sealed class FakeProvider : IPropagationProvider
        {
            public FakeProvider(string id) => ProviderId = id;

            public string ProviderId { get; }

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target, PropagationFrame frame, IReadOnlyList<double> uts, StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;

            public bool CanPropagate(PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) =>
                false;
        }

        private static Kernel Resolved(Action<Kernel> registerProviders = null)
        {
            var kernel = new Kernel();
            PropagationElection.RegisterCapability(kernel);
            registerProviders?.Invoke(kernel);
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel;
        }

        [Fact]
        public void WithNoProviderTheStockTwoBodySolverIsElected()
        {
            var elected = PropagationElection.Elected(Resolved());

            Assert.NotNull(elected);
            Assert.Equal("kepler", elected!.ProviderId);
            Assert.IsType<KeplerProvider>(elected);
        }

        [Fact]
        public void ARegisteredProviderIsElectedOverTheVanilla()
        {
            var kernel = Resolved(k => k.RegisterProvider(new ProviderRegistration
            {
                Capability = PropagationElection.CapabilityId,
                Id = "some-nbody-mod",
                Priority = 100.0,
                Factory = _ => new FakeProvider("some-nbody-mod"),
            }));

            Assert.Equal("some-nbody-mod", PropagationElection.Elected(kernel)!.ProviderId);
        }

        [Fact]
        public void TheHigherPriorityProviderWinsWhenTwoCompete()
        {
            var kernel = Resolved(k =>
            {
                k.RegisterProvider(new ProviderRegistration
                {
                    Capability = PropagationElection.CapabilityId,
                    Id = "low",
                    Priority = 1.0,
                    Factory = _ => new FakeProvider("low"),
                });
                k.RegisterProvider(new ProviderRegistration
                {
                    Capability = PropagationElection.CapabilityId,
                    Id = "high",
                    Priority = 10.0,
                    Factory = _ => new FakeProvider("high"),
                });
            });

            Assert.Equal("high", PropagationElection.Elected(kernel)!.ProviderId);
        }

        [Fact]
        public void AProviderThatThrowsOnActivationFallsBackToTheStockSolver()
        {
            // Winning an election is not the same as being able to run: a provider
            // compiled against an older contract fails its vtable setup at
            // instantiation, long after selection declared it the winner. Falling
            // through to the vanilla is the whole reason the vanilla exists.
            var kernel = Resolved(k => k.RegisterProvider(new ProviderRegistration
            {
                Capability = PropagationElection.CapabilityId,
                Id = "broken",
                Priority = 100.0,
                Factory = _ => throw new InvalidOperationException("vtable"),
            }));

            Assert.Equal("kepler", PropagationElection.Elected(kernel)!.ProviderId);
        }

        [Fact]
        public void AnUnregisteredCapabilityResolvesToNullRatherThanThrowing()
        {
            // Defensive: a correctly bootstrapped engine always has at least the
            // vanilla, so this is a diagnostic path rather than a supported state.
            var kernel = new Kernel();
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            Assert.Null(PropagationElection.Elected(kernel));
        }

        /// <summary>
        /// The stock game's trajectories are closed-form, and the election says so.
        ///
        /// <para>This is the answer a client reads as "your elements ARE the curve,
        /// draw a conic". It was also the answer on every install of every kind for
        /// as long as the marker had no implementer, which is why the pair below
        /// matters more than either half.</para>
        /// </summary>
        [Fact]
        public void TheStockTwoBodySolverDoesNotClaimIntegratedTrajectories()
        {
            Assert.False(PropagationElection.ElectedIntegrates(Resolved()));
        }

        /// <summary>
        /// A provider carrying the marker turns the same question true, so a consumer
        /// stops authorising a conic for a path the craft will not fly.
        /// </summary>
        [Fact]
        public void AnElectedProviderCarryingTheMarkerIntegrates()
        {
            var kernel = Resolved(k => k.RegisterProvider(new ProviderRegistration
            {
                Capability = PropagationElection.CapabilityId,
                Id = "an-nbody-backend",
                Priority = 100.0,
                Factory = _ => new IntegratingProvider(),
            }));

            Assert.True(PropagationElection.ElectedIntegrates(kernel));
        }

        /// <summary>
        /// A provider that wins without the marker leaves trajectories closed-form.
        ///
        /// <para>The question is about the ANSWER's shape, not about who answered:
        /// a provider is free to displace the stock solver and still be analytic,
        /// and a check keyed on "somebody won" rather than on the marker would call
        /// that integrated.
        /// </para>
        /// </summary>
        [Fact]
        public void AWinningProviderWithoutTheMarkerStaysClosedForm()
        {
            var kernel = Resolved(k => k.RegisterProvider(new ProviderRegistration
            {
                Capability = PropagationElection.CapabilityId,
                Id = "another-analytic-solver",
                Priority = 100.0,
                Factory = _ => new FakeProvider("another-analytic-solver"),
            }));

            Assert.Equal("another-analytic-solver", PropagationElection.Elected(kernel)!.ProviderId);
            Assert.False(PropagationElection.ElectedIntegrates(kernel));
        }

        [Fact]
        public void AKernelThatIsNotUpYetIsClosedFormRatherThanAThrow()
        {
            // The resolver is installed during registration and asked on every
            // sample afterwards, so a caller whose kernel is not resolved yet is
            // asking a well-formed question. Closed-form is the withholding answer.
            Assert.False(PropagationElection.ElectedIntegrates(null));
            Assert.False(PropagationElection.ElectedIntegrates(new Kernel()));
        }

        private sealed class IntegratingProvider : IPropagationProvider, IIntegratedTrajectorySource
        {
            public string ProviderId => "an-nbody-backend";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => false;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }

        [Fact]
        public void PropagationIsNotSpineCriticalBecauseAnEngineWithoutItStillFlies()
        {
            // Nothing here asserts a behaviour the kernel does not already give us;
            // it pins the DECISION, which is that losing propagation degrades the
            // silence predictor rather than halting the spine.
            var kernel = new Kernel();
            PropagationElection.RegisterCapability(kernel);

            var notices = kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" }).Notices;

            Assert.Contains(notices, n =>
                n.Capability == PropagationElection.CapabilityId && n.Kind == "vanilla-fallback");
        }
    }
}
