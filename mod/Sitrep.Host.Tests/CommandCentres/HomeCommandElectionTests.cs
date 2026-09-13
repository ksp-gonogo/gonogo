using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    /// <summary>
    /// The home-command election through the REAL <see cref="Kernel"/>, and the stock
    /// claimant's rule: home is the CommNet home that alone carries <c>isKSC</c>.
    ///
    /// <para>The expected id is always read off <see cref="HomeCentreIds.Mint"/> over
    /// the same homes rather than spelled, because the claimant's promise is "the id the
    /// registry mints for that home", not any particular string.</para>
    /// </summary>
    public class HomeCommandElectionTests
    {
        private static HomeCommand StockAnswer(IReadOnlyList<HomeNodeFacts> homes) =>
            new StockHomeCommandProvider(() => homes).Identify();

        [Fact]
        public void Stock_OneFlaggedHome_IsHome_UnderTheIdTheRegistryMintsForIt()
        {
            var homes = new[]
            {
                new HomeNodeFacts(false, "Woomerang Station"),
                new HomeNodeFacts(true, "Kerbal Space Center"),
                new HomeNodeFacts(false, "Dessert Station"),
            };

            var answer = StockAnswer(homes);

            Assert.True(answer.IsIdentified);
            Assert.Equal(HomeCentreIds.Mint(homes)[1], answer.CentreId);
        }

        /// <summary>
        /// The comms-mod shape: every configured station carries the flag, so the flag
        /// names none of them. A claimant that took the first flagged home would put the
        /// career ledger at whichever station the scene happened to enumerate first.
        /// </summary>
        [Fact]
        public void Stock_EveryHomeFlagged_IsNotIdentified()
        {
            var answer = StockAnswer(new[]
            {
                new HomeNodeFacts(true, "DSS 14 - Goldstone"),
                new HomeNodeFacts(true, "DSS 43 - Canberra"),
                new HomeNodeFacts(true, "Cape Canaveral"),
            });

            Assert.False(answer.IsIdentified);
            Assert.Null(answer.CentreId);
            Assert.Same(HomeCommand.NotIdentified, answer);
        }

        [Fact]
        public void Stock_NoHomes_IsNotIdentified()
        {
            Assert.Same(HomeCommand.NotIdentified, StockAnswer(new HomeNodeFacts[0]));
        }

        [Fact]
        public void Stock_HomesButNoneFlagged_IsNotIdentified()
        {
            Assert.Same(HomeCommand.NotIdentified, StockAnswer(new[]
            {
                new HomeNodeFacts(false, "Woomerang Station"),
                new HomeNodeFacts(false, "Dessert Station"),
            }));
        }

        [Fact]
        public void Identified_RefusesAnEmptyId()
        {
            Assert.Throws<System.ArgumentException>(() => HomeCommand.Identified(""));
        }

        private sealed class FixedClaimant : IHomeCommandProvider
        {
            private readonly HomeCommand _answer;

            public FixedClaimant(string id, HomeCommand answer)
            {
                ProviderId = id;
                _answer = answer;
            }

            public string ProviderId { get; }

            public HomeCommand Identify() => _answer;
        }

        private static readonly IReadOnlyList<HomeNodeFacts> StockHomes = new[]
        {
            new HomeNodeFacts(true, "Kerbal Space Center"),
        };

        private static Kernel KernelWith(params (string Id, double Priority)[] claimants)
        {
            var kernel = new Kernel();
            HomeCommandElection.RegisterCapability(kernel, () => StockHomes);
            foreach (var (id, priority) in claimants)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = HomeCommandCapability.Id,
                    Id = id,
                    Priority = priority,
                    Factory = _ => new FixedClaimant(id, HomeCommand.Identified("ground:" + id)),
                });
            }

            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void NoClaimantRegistered_StockVanillaIsElected()
        {
            var elected = HomeCommandElection.Elected(KernelWith());

            Assert.NotNull(elected);
            Assert.Equal(StockHomeCommandProvider.Id, elected!.ProviderId);
            Assert.Equal(HomeCentreIds.Mint(StockHomes)[0], elected.Identify().CentreId);
        }

        [Fact]
        public void RegisteredClaimant_BeatsTheStockVanilla()
        {
            var elected = HomeCommandElection.Elected(KernelWith(("overhaul", 20.0)));

            Assert.NotNull(elected);
            Assert.Equal("overhaul", elected!.ProviderId);
            Assert.Equal("ground:overhaul", elected.Identify().CentreId);
        }

        /// <summary>
        /// The registration the capability's doc comment prescribes when a career
        /// overhaul and a comms mod are installed together: distinct priorities, the
        /// career overhaul higher.
        /// </summary>
        [Fact]
        public void CareerOverhaulAndCommsClaimantsBothRegistered_TheHigherPriorityWins()
        {
            var elected = HomeCommandElection.Elected(KernelWith(("comms-mod", 10.0), ("overhaul", 20.0)));

            Assert.Equal("overhaul", elected!.ProviderId);
        }

        /// <summary>
        /// Why the priorities must differ: a tie is not broken by registration order, it
        /// throws out of resolution.
        /// </summary>
        [Fact]
        public void TwoClaimantsAtTheSamePriority_FailResolutionRatherThanPickOne()
        {
            Assert.Throws<AmbiguousResolutionError>(() => KernelWith(("comms-mod", 10.0), ("overhaul", 10.0)));
        }
    }
}
