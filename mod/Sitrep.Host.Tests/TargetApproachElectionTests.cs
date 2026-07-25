using System;
using Sitrep.Contract;
using Sitrep.Host.Targeting;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The closest-approach backend election — a mirror of
    /// <see cref="CommsElectionTests"/>/the AGX election, driving the REAL
    /// <see cref="Kernel"/> through the two cases that matter for this phase:
    /// Principia absent ⇒ stock Kepler vanilla wins; Principia present ⇒ the
    /// registered provider wins; and the elected instance is queryable as an
    /// <see cref="ITargetApproachSolver"/>. The Principia backend itself is
    /// out of scope — a fake stands in for it, exactly as
    /// <see cref="CommsElectionTests"/> fakes its mod provider.
    /// </summary>
    public class TargetApproachElectionTests
    {
        private sealed class FakeSolver : ITargetApproachSolver
        {
            public FakeSolver(string id) => BackendId = id;
            public string BackendId { get; }
            public ClosestApproach? Solve(double fromUt) => null;
        }

        private static Kernel ResolvedKernel(bool principiaPresent)
        {
            var kernel = new Kernel();
            TargetApproachElection.RegisterCapability(kernel, _ => new FakeSolver("stock-kepler"));
            if (principiaPresent)
            {
                TargetApproachElection.RegisterPrincipiaProvider(kernel, _ => new FakeSolver("principia"));
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void PrincipiaAbsent_StockKeplerVanillaWins()
        {
            var kernel = ResolvedKernel(principiaPresent: false);

            var elected = TargetApproachElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.Equal("stock-kepler", elected!.BackendId);
        }

        [Fact]
        public void PrincipiaPresent_PrincipiaWins()
        {
            var kernel = ResolvedKernel(principiaPresent: true);

            var elected = TargetApproachElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.Equal("principia", elected!.BackendId);
        }

        [Fact]
        public void ExactlyOneSolverIsElected()
        {
            var kernel = ResolvedKernel(principiaPresent: true);

            // Query throws unless the exclusive capability resolves to exactly
            // one instance -- so a successful Query IS the "exactly one" assertion.
            var elected = kernel.Query<ITargetApproachSolver>(TargetApproachElection.CapabilityId);

            Assert.NotNull(elected);
        }

        [Fact]
        public void ElectedBefore_Resolve_IsNullNotThrow()
        {
            var kernel = new Kernel();
            TargetApproachElection.RegisterCapability(kernel, _ => new FakeSolver("stock-kepler"));

            // Query before Resolve throws internally; Elected swallows it to null.
            Assert.Null(TargetApproachElection.Elected(kernel));
        }
    }
}
