using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Whether anything in production can make a craft's trajectory be published as
    /// INTEGRATED, asserted by running the election rather than by setting the flag
    /// the election feeds.
    ///
    /// <para><b>This is the check the shipped-dead slice did not have, and could not
    /// have had in the shape it was tested.</b> The consumer's gate is
    /// <c>elected is IIntegratedTrajectorySource</c>. Every test of the integrator
    /// behind that gate opened it by handing the consumer a lambda returning true,
    /// so all of them passed while nothing in the whole repository implemented the
    /// interface and the horizon reported closed-form on every live frame. A test
    /// that sets the gate cannot notice that; one that RESOLVES the gate has to.</para>
    ///
    /// <para><b>What each side owns.</b> This file owns the Uplink's half: a real
    /// <see cref="Kernel"/>, the real <c>Register</c>, a real <c>Resolve</c>, and
    /// then the same question the consumer asks of the winner. Core's half, that the
    /// capability is declared exclusive with a two-body vanilla and that its own
    /// resolver answers this question the same way, is pinned in
    /// <c>PropagationElectionTests</c>. The two meet on
    /// <see cref="PropagationCapability.Id"/>, which is one constant in the shared
    /// contract precisely so neither side can hold a copy that drifts.</para>
    /// </summary>
    public class TrajectoryElectionTests
    {
        private static PrincipiaUplink Available() =>
            new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 215)));

        /// <summary>
        /// The elected propagation provider says its trajectories are integrated,
        /// with nothing hand-set anywhere in the chain.
        ///
        /// <para>Registration alone is not the claim: a provider can register and
        /// lose, or register and fail activation, and either leaves the vanilla in
        /// place with no symptom. So this resolves and then asks the winner.</para>
        /// </summary>
        [Fact]
        public void TheElectedPropagationProviderSaysItsTrajectoriesAreIntegrated()
        {
            var host = new RecordingUplinkHost();

            Available().Register(host);
            host.Kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            var elected = host.Kernel.Query<IPropagationProvider>(PropagationCapability.Id);

            Assert.NotNull(elected);
            Assert.IsAssignableFrom<IIntegratedTrajectorySource>(elected);
        }

        /// <summary>
        /// With no Uplink registering anything, the winner is the vanilla and it does
        /// NOT claim to integrate.
        ///
        /// <para>The paired half of the test above, and the half that makes it mean
        /// something: a gate that opens for everything is not a gate. If this ever
        /// passes for the wrong reason the assertion above stops being evidence.</para>
        /// </summary>
        [Fact]
        public void WithNoUplinkRegisteringAnythingTheWinnerDoesNotClaimToIntegrate()
        {
            var host = new RecordingUplinkHost();

            host.Kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            var elected = host.Kernel.Query<IPropagationProvider>(PropagationCapability.Id);

            Assert.NotNull(elected);
            Assert.False(
                elected is IIntegratedTrajectorySource,
                "the stand-in two-body vanilla claimed integrated trajectories, so this file's "
                + "positive assertion would pass with the Uplink registering nothing at all");
        }

        /// <summary>
        /// An install without the producer elects nothing, so its trajectories stay
        /// closed-form.
        ///
        /// <para>The guard runs before every registration, and this is what says so
        /// for the propagation half specifically: a provider registered on an install
        /// with no n-body physics would claim integrated trajectories for a game
        /// running two-body ones.</para>
        /// </summary>
        [Fact]
        public void AnAbsentProducerElectsNoIntegratingProvider()
        {
            var host = new RecordingUplinkHost();

            new PrincipiaUplink(PrincipiaGuardResult.Fail("Principia not detected")).Register(host);
            host.Kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            Assert.False(
                host.Kernel.Query<IPropagationProvider>(PropagationCapability.Id)
                    is IIntegratedTrajectorySource);
        }

        /// <summary>
        /// The elected provider is registered whether or not a force model was, and
        /// that is deliberate rather than incidental.
        ///
        /// <para>The producer's gravity-model config is guarded on a planet pack, so
        /// an install running it against the stock system publishes no model. Standing
        /// the propagation registration down in that case would publish conic
        /// elements with nothing attached saying why, which reads exactly like a
        /// working analytic install. Elected, the horizon says integrated and the
        /// missing model is a stated refusal.</para>
        /// </summary>
        [Fact]
        public void TheIntegratingProviderIsElectedEvenWithNoForceModelPublished()
        {
            var host = new RecordingUplinkHost();

            Available().Register(host);
            host.Kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            // A headless build attaches no reader, so nothing wins the force-model
            // capability. That is the same state a game install with no gravity-model
            // config is in, and both reach a client as the same stated refusal.
            Assert.Empty(host.Kernel.Active(GravityModelCapability.Id));
            Assert.IsAssignableFrom<IIntegratedTrajectorySource>(
                host.Kernel.Query<IPropagationProvider>(PropagationCapability.Id));
        }

        /// <summary>
        /// Every closed-form question reaches the solver this provider displaced, and
        /// none of them is answered here.
        ///
        /// <para>Winning propagation means answering the visibility sweep and the
        /// encounter search too. A provider that returned a default for any of them
        /// would put a craft at the centre of its primary, or report no encounter
        /// ever, and the silence predictor would believe it. The recorder below fails
        /// the assertion by omission: a member that stops forwarding leaves its name
        /// out of the calls list.</para>
        /// </summary>
        [Fact]
        public void EveryClosedFormQuestionIsForwardedToTheDisplacedSolver()
        {
            var conics = new RecordingConics();
            var provider = new PrincipiaPropagationProvider(conics);
            var target = PropagationTarget.Body(1);
            var frame = PropagationFrame.CentredOn(0);

            provider.Solve(target, frame, 10.0);
            provider.SolveMany(target, frame, new[] { 10.0 }, new StateVector[1]);
            provider.CharacteristicCycleSeconds(target);
            provider.RadiusExtremesOf(target);
            provider.CanPropagate(target, frame, 10.0, 20.0);
            provider.SolveClosestApproach(target, PropagationTarget.Body(2), frame, 10.0, 20.0);

            Assert.Equal(
                new[]
                {
                    "Solve", "SolveMany", "CharacteristicCycleSeconds", "RadiusExtremesOf",
                    "CanPropagate", "SolveClosestApproach",
                },
                conics.Calls);
        }

        [Fact]
        public void AProviderWithNoDisplacedSolverIsRefusedRatherThanAnsweringZero()
        {
            Assert.Throws<ArgumentNullException>(() => new PrincipiaPropagationProvider(null!));
        }

        /// <summary>
        /// The displaced two-body solver, recording which questions reached it. It is
        /// deliberately NOT an integrated trajectory source: it stands in for the
        /// thing whose absence of that marker is what the gate distinguishes.
        /// </summary>
        private sealed class RecordingConics : IPropagationProvider
        {
            public List<string> Calls { get; } = new List<string>();

            public string ProviderId => "recording-conics";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut)
            {
                Calls.Add("Solve");
                return new StateVector(new Vector3d(1, 2, 3), new Vector3d(4, 5, 6));
            }

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into) =>
                Calls.Add("SolveMany");

            public double? CharacteristicCycleSeconds(PropagationTarget target)
            {
                Calls.Add("CharacteristicCycleSeconds");
                return 99.0;
            }

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target)
            {
                Calls.Add("RadiusExtremesOf");
                return null;
            }

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt)
            {
                Calls.Add("CanPropagate");
                return true;
            }

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt)
            {
                Calls.Add("SolveClosestApproach");
                return null;
            }
        }
    }
}
