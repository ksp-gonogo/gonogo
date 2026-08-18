using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Maneuver;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The maneuver-plan election, and the distinction it exists to carry: a
    /// craft with no planner is not a craft with an empty plan.
    /// </summary>
    public class ManeuverPlanElectionTests
    {
        [Fact]
        public void AKernelWithNoProviderElectsTheVanilla()
        {
            var kernel = new Kernel();
            ManeuverPlanElection.RegisterCapability(kernel, _ => new FakePlanSource("vanilla", new List<ManeuverNode>()));
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            var elected = ManeuverPlanElection.Elected(kernel);
            Assert.NotNull(elected);
            Assert.Equal("vanilla", elected!.ProviderId);
        }

        /// <summary>
        /// Registering IS the gate: an exclusive capability with one registered
        /// provider selects it and falls back to the vanilla with none, so a
        /// provider that only registers when its own planner is loaded needs no
        /// version-string gymnastics.
        /// </summary>
        [Fact]
        public void ARegisteredProviderWinsOverTheVanilla()
        {
            var kernel = new Kernel();
            ManeuverPlanElection.RegisterCapability(kernel, _ => new FakePlanSource("vanilla", new List<ManeuverNode>()));
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = ManeuverPlanElection.CapabilityId,
                Id = "other-planner",
                Priority = 10,
                Factory = _ => new FakePlanSource("other-planner", null),
            });
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Equal("other-planner", ManeuverPlanElection.Elected(kernel)!.ProviderId);
        }

        /// <summary>
        /// The whole reason the seam carries a nullable plan. An empty list
        /// means "a planner, with nothing queued"; null means "no planner",
        /// which stock reaches on an un-upgraded Tracking Station. A consumer
        /// that cannot tell them apart tells an operator their plan is empty
        /// when the truth is that they cannot make one.
        /// </summary>
        [Fact]
        public void ANullPlanAndAnEmptyPlanAreDifferentAnswers()
        {
            Assert.Null(new FakePlanSource("none", null).Plan());
            Assert.Empty(new FakePlanSource("some", new List<ManeuverNode>()).Plan()!);
        }

        private sealed class FakePlanSource : IManeuverPlanSource
        {
            private readonly IList<ManeuverNode>? _plan;

            public FakePlanSource(string id, IList<ManeuverNode>? plan)
            {
                ProviderId = id;
                _plan = plan;
            }

            public string ProviderId { get; }

            public IList<ManeuverNode>? Plan() => _plan;
        }
    }
}
