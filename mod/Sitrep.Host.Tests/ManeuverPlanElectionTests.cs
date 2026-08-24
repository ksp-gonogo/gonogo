using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Maneuver;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The maneuver-plan election's MULTI-MEMBER path.
    ///
    /// <para>Untested until now, for the same reason the write-path guard it
    /// enables was untested: nothing has ever competed for this capability, so the
    /// vanilla has always won by default. That makes the guard unreachable in
    /// production however correct its rule is, which is why this file is part of
    /// the same change.</para>
    ///
    /// <para>Two fakes rather than stock's own backend, deliberately: that backend
    /// reads <c>patchedConicSolver</c> and so cannot compile here. What is being
    /// asserted is the election, not the planner.</para>
    /// </summary>
    public class ManeuverPlanElectionTests
    {
        private sealed class FakePlanSource : IManeuverPlanSource
        {
            public FakePlanSource(string id) => ProviderId = id;

            public string ProviderId { get; }

            public IList<Sitrep.Contract.ManeuverNode>? Plan() => null;

            public CommandResult SendPlan(SendManeuverPlanArgs plan) => CommandResult.Ok();
        }

        private static Kernel Resolved(bool withCompetitor)
        {
            var kernel = new Kernel();
            ManeuverPlanElection.RegisterCapability(kernel, _ => new FakePlanSource("vanilla"));
            if (withCompetitor)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = ManeuverPlanElection.CapabilityId,
                    Id = "competitor",
                    Priority = 100,
                    Factory = _ => new FakePlanSource("competitor"),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel;
        }

        [Fact]
        public void TheVanillaIsElectedWithNoCompetitor()
        {
            Assert.Equal("vanilla", ManeuverPlanElection.Elected(Resolved(false))?.ProviderId);
        }

        [Fact]
        public void ARegisteredProviderIsElectedOverTheVanilla()
        {
            // The path that makes the write-path refusal reachable at all.
            Assert.Equal("competitor", ManeuverPlanElection.Elected(Resolved(true))?.ProviderId);
        }
    }
}
