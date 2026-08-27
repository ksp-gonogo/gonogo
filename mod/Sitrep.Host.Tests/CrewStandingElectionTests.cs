using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Crew;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The crew-standing election, driven through the REAL <see cref="Kernel"/>,
    /// and the mapping either answer produces.
    ///
    /// <para>The case these exist for is a specific one, so it is worth stating
    /// plainly. RP-1 retires a kerbal by writing stock's <c>Dead</c> into
    /// <c>rosterStatus</c> and remembering the name in a private set of its own.
    /// Every reading of the stock field therefore reported a living retiree as a
    /// fatality, on a mission-control board, and no amount of care in reading the
    /// field could have caught it: the difference is not in the field.</para>
    ///
    /// <para>So the interesting assertions below are not "does the election
    /// work". They are: a backend that corrects ONE kerbal does not have to
    /// answer for the rest of the roster; the default it declines into is the
    /// stock map rather than a hole; and stock's own answer never invents a
    /// retirement it has no concept of.</para>
    /// </summary>
    public class CrewStandingElectionTests
    {
        private const double ProviderPriority = 10.0;

        /// <summary>
        /// The stock backend's standing for one ordinal. A helper because a dozen
        /// cases here vary ONLY by the ordinal, and an applicant is expressed by
        /// withholding the ordinal rather than by passing a value beside a flag.
        /// </summary>
        private static CrewStanding StockStanding(int? ordinal, bool isApplicant) =>
            new StockCrewStandingBackend().Read(new CrewStandingQuery
            {
                KerbalName = "Anybody Kerman",
                RosterStatusOrdinal = isApplicant ? null : ordinal,
                IsApplicant = isApplicant,
            })!.Standing!.Value;

        /// <summary>
        /// A career overhaul's backend, standing in for RP-1: one named retiree,
        /// silence about everyone else.
        /// </summary>
        private sealed class FakeOverhaulBackend : ICrewStandingBackend
        {
            public string ProviderId => "fake-overhaul";

            public CrewStandingReading? Read(CrewStandingQuery query) =>
                query.KerbalName == "Wernher Kerman"
                    ? new CrewStandingReading { Standing = CrewStanding.Retired }
                    : null;
        }

        private sealed class CapabilityOwningUplink : ISitrepUplink, IUplinkCapabilityDeclarer
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "spaceCenter", Version = "1.0.0" };
            public void DeclareCapabilities(Kernel kernel) => CrewStandingElection.RegisterCapability(kernel);
            public void Register(IUplinkHost host) { }
        }

        private sealed class ProviderOnlyUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "fake-overhaul", Version = "1.0.0" };
            public void Register(IUplinkHost host) =>
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CrewStandingElection.CapabilityId,
                    Id = "fake-overhaul",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeOverhaulBackend(),
                });
        }

        private static Kernel ResolvedKernel(bool providerPresent)
        {
            var kernel = new Kernel();
            CrewStandingElection.RegisterCapability(kernel);
            if (providerPresent)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CrewStandingElection.CapabilityId,
                    Id = "fake-overhaul",
                    Priority = ProviderPriority,
                    Factory = _ => new FakeOverhaulBackend(),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void ProviderAbsent_StockVanillaWins()
        {
            var elected = CrewStandingElection.Elected(ResolvedKernel(providerPresent: false));

            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.ProviderId);
        }

        [Fact]
        public void ProviderPresent_ProviderWins()
        {
            var elected = CrewStandingElection.Elected(ResolvedKernel(providerPresent: true));

            Assert.NotNull(elected);
            Assert.Equal("fake-overhaul", elected!.ProviderId);
        }

        /// <summary>
        /// The adversarial ordering a two-pass registration exists for: the
        /// provider uplink is discovered BEFORE the capability owner. Get this
        /// wrong on an RP-1 install and the roster silently reverts to reporting
        /// retirees as fatalities, which is the failure this whole capability was
        /// added to end.
        /// </summary>
        [Fact]
        public void ProviderDiscoveredBeforeCapability_ProviderStillWins()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");

            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(new ProviderOnlyUplink(), ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(new CapabilityOwningUplink(), ContractVersion.Major, ContractVersion.Minor),
            });
            engine.Start();

            engine.ResolveCapabilities();

            var elected = CrewStandingElection.Elected(engine.Kernel);
            Assert.NotNull(elected);
            Assert.Equal("fake-overhaul", elected!.ProviderId);
        }

        /// <summary>
        /// Not SpineCritical: an unregistered capability is a null rather than a
        /// throw, and the roster then publishes the stock map, which is exactly
        /// what it published before the capability existed.
        /// </summary>
        [Fact]
        public void UnregisteredCapabilityResolvesToNullRatherThanThrowing()
        {
            var kernel = new Kernel();
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Null(CrewStandingElection.Elected(kernel));
        }

        /// <summary>
        /// The elected backend answers for the ONE kerbal it knows about and
        /// declines for the rest, which is the ordinary shape of a correction: a
        /// mature RP-1 career has a handful of retirees and a roster of dozens.
        /// A backend obliged to answer for everyone would have to reimplement the
        /// stock map, and a mod's copy of core's map is a copy that drifts.
        /// </summary>
        [Fact]
        public void AnOverhaulCorrectsOnlyWhatItKnowsAndDeclinesForEveryoneElse()
        {
            var backend = new FakeOverhaulBackend();

            Assert.Equal(
                CrewStanding.Retired,
                backend.Read(CrewStandingQueries.Crew("Wernher Kerman", KspRosterStatus.Dead))!.Standing);
            Assert.Null(backend.Read(CrewStandingQueries.Crew("Jebediah Kerman", KspRosterStatus.Available)));
        }

        /// <summary>
        /// What stock's roster status means, pinned member by member. The stock
        /// backend is a real reader rather than a shrug, and this is the whole of
        /// its model.
        /// </summary>
        [Theory]
        [InlineData((int)KspRosterStatus.Available, CrewStanding.Available)]
        [InlineData((int)KspRosterStatus.Assigned, CrewStanding.Assigned)]
        [InlineData((int)KspRosterStatus.Dead, CrewStanding.Dead)]
        [InlineData((int)KspRosterStatus.Missing, CrewStanding.Missing)]
        public void StockMapsEveryRosterStatusItHas(int ordinal, CrewStanding expected)
        {
            Assert.Equal(expected, StockStanding(ordinal, isApplicant: false));
        }

        /// <summary>
        /// An applicant answers <see cref="CrewStanding.Applicant"/> without the
        /// ordinal being consulted at all, because an applicant has none: the
        /// ordinal is passed as null and the answer is still definite.
        /// </summary>
        [Fact]
        public void StockCallsAnApplicantAnApplicantWithNoOrdinalToGoOn()
        {
            Assert.Equal(
                CrewStanding.Applicant,
                new StockCrewStandingBackend().Read(CrewStandingQueries.Applicant("Dilsby Kerman"))!.Standing);
        }

        /// <summary>
        /// An ordinal stock does not declare is <see cref="CrewStanding.Unknown"/>
        /// and not the friendliest guess. Unknown is a third answer: it is not
        /// "available" (we cannot promise the kerbal can fly) and it is not
        /// "dead" (we have no grounds to say so).
        /// </summary>
        [Fact]
        public void StockRefusesToGuessAtAnOrdinalItDoesNotDeclare()
        {
            Assert.Equal(CrewStanding.Unknown, StockStanding(9, isApplicant: false));
            Assert.Equal(CrewStanding.Unknown, StockStanding(null, isApplicant: false));
        }

        /// <summary>
        /// Stock has no retirement and never reports one. This is the guard on
        /// the other direction of the same defect: a correction that leaked into
        /// the stock path would tell a stock player their dead astronauts had
        /// retired, which is worse than the bug it fixed.
        /// </summary>
        [Fact]
        public void StockNeverReportsARetirementItHasNoConceptOf()
        {
            for (var ordinal = -1; ordinal <= 6; ordinal++)
            {
                Assert.NotEqual(CrewStanding.Retired, StockStanding(ordinal, isApplicant: false));
                Assert.NotEqual(CrewStanding.Retired, StockStanding(ordinal, isApplicant: true));
            }
        }

        /// <summary>
        /// The stock backend and the contract's own default are ONE declaration,
        /// not two that agree today. The default is what the view provider falls
        /// back to with no Kernel wired, so a divergence would mean a bare host
        /// and a resolved host disagreed about the same roster.
        /// </summary>
        [Fact]
        public void TheStockBackendAndTheContractDefaultAreTheSameMap()
        {
            for (var ordinal = -1; ordinal <= 6; ordinal++)
            {
                foreach (var isApplicant in new[] { false, true })
                {
                    Assert.Equal(
                        CrewStandings.FromRosterStatus(ordinal, isApplicant),
                        StockStanding(ordinal, isApplicant));
                }
            }
        }

        /// <summary>
        /// EVERY standing except the two that mean "free" is unavailable, and
        /// this is driven off <c>Enum.GetValues</c> rather than a list, so a
        /// member added to the contract is covered without anybody editing it.
        /// </summary>
        /// <remarks>
        /// The property under test is the DIRECTION of the rule.
        /// <see cref="CrewStandings.CanFly"/> is a whitelist, so a standing
        /// nobody has thought about yet fails closed. Written as a blocklist the
        /// same code would pass today and quietly hand a flight to whatever
        /// committed-but-idle standing gets added next, which is exactly how a
        /// kerbal mid-course reached the wire free to fly.
        /// </remarks>
        [Fact]
        public void OnlyTheTwoFreeStandingsCanFly()
        {
            foreach (CrewStanding standing in System.Enum.GetValues(typeof(CrewStanding)))
            {
                var free = standing == CrewStanding.Available || standing == CrewStanding.Applicant;
                Assert.Equal(free, CrewStandings.CanFly(standing));

                // The reason is empty exactly when there is nothing to say: the
                // kerbal is free, or the standing is one nobody could read.
                // "Unknown" in a tooltip beside a disabled control reads as a
                // diagnosis rather than as an absence.
                var reason = CrewStandings.UnavailableReason(standing);
                Assert.Equal(
                    free || standing == CrewStanding.Unknown,
                    string.IsNullOrEmpty(reason));
            }
        }

        /// <summary>
        /// The derivation folds every axis, not just the roster status: a kerbal
        /// whose status is <c>Available</c> but who is standing down is
        /// <see cref="CrewStanding.Resting"/>, unavailable, and dated.
        /// </summary>
        /// <remarks>
        /// The case the split derivation could not express. The standing was
        /// decided in the capture and availability in the view provider, and
        /// <c>inactive</c> was visible to neither, so this kerbal published
        /// <c>available: true</c> with an empty reason for a release.
        /// </remarks>
        [Fact]
        public void AStandDownIsAStandingAndNotJustAFlagBesideOne()
        {
            var resolution = CrewStandings.Resolve(
                CrewStandingQueries.Crew(
                    "Bill Kerman",
                    KspRosterStatus.Available,
                    inactive: true,
                    inactiveUntilUt: 8_000_000.0),
                new StockCrewStandingBackend().Read(CrewStandingQueries.Crew(
                    "Bill Kerman",
                    KspRosterStatus.Available,
                    inactive: true,
                    inactiveUntilUt: 8_000_000.0)),
                CrewStandings.StockSource);

            Assert.Equal(CrewStanding.Resting, resolution.Standing);
            Assert.False(resolution.Available);
            Assert.Equal("Standing down", resolution.UnavailableReason);
            Assert.Equal(8_000_000.0, resolution.StandingEndsAtUt);
        }

        /// <summary>
        /// A kerbal crewing a vessel is <see cref="CrewStanding.Assigned"/>
        /// whatever the stand-down flag says. The more specific answer wins, and
        /// KSP leaves the flag set from the last rest period, so reading it here
        /// would relabel half the crew in flight.
        /// </summary>
        [Fact]
        public void BeingOnAMissionOutranksALeftoverStandDownFlag()
        {
            var query = CrewStandingQueries.Crew(
                "Jeb Kerman",
                KspRosterStatus.Assigned,
                inactive: true,
                inactiveUntilUt: 8_000_000.0);

            Assert.Equal(CrewStanding.Assigned, CrewStandings.FromQuery(query));
            Assert.Null(CrewStandings.Resolve(query, null, null).StandingEndsAtUt);
        }

        /// <summary>
        /// A backend that answers ONLY a scheduled retirement leaves the standing
        /// to the stock derivation and is not credited with it.
        /// </summary>
        /// <remarks>
        /// This is how a kerbal reads <c>Resting</c>, from stock's own reading of
        /// stock's own field, while carrying a career overhaul's retirement date.
        /// A backend having something to add about one axis must not cost the
        /// others their answer, or a mod would have to restate core's whole map
        /// to contribute one date.
        /// </remarks>
        [Fact]
        public void ADateWithNoStandingLeavesTheStandingAloneAndTheSourceStock()
        {
            var resolution = CrewStandings.Resolve(
                CrewStandingQueries.Crew(
                    "Bill Kerman",
                    KspRosterStatus.Available,
                    inactive: true,
                    inactiveUntilUt: 8_000_000.0),
                new CrewStandingReading { RetiresAtUt = 9_000_000.0 },
                "fake-overhaul");

            Assert.Equal(CrewStanding.Resting, resolution.Standing);
            Assert.Equal(CrewStandings.StockSource, resolution.Source);
            Assert.Equal(8_000_000.0, resolution.StandingEndsAtUt);
            Assert.Equal(9_000_000.0, resolution.RetiresAtUt);
        }

        /// <summary>
        /// The two whens are separate fields because they are live at once: a
        /// kerbal is on a course that ends in a month and retires in a decade.
        /// Folded together, an operator planning around a crew's remaining career
        /// would read a course ETA as the end of it.
        /// </summary>
        [Fact]
        public void ACourseEtaAndARetirementDateAreBothCarried()
        {
            var resolution = CrewStandings.Resolve(
                CrewStandingQueries.Crew("Bill Kerman", KspRosterStatus.Available),
                new CrewStandingReading
                {
                    Standing = CrewStanding.Training,
                    StandingEndsAtUt = 1_000.0,
                    RetiresAtUt = 500_000.0,
                },
                "fake-overhaul");

            Assert.Equal(CrewStanding.Training, resolution.Standing);
            Assert.Equal("fake-overhaul", resolution.Source);
            Assert.False(resolution.Available);
            Assert.Equal("In training", resolution.UnavailableReason);
            Assert.Equal(1_000.0, resolution.StandingEndsAtUt);
            Assert.Equal(500_000.0, resolution.RetiresAtUt);
        }

        /// <summary>
        /// The standing does NOT mirror KSP's numbering, and that is deliberate:
        /// a mirror would tie growth here to Squad shipping a new roster status,
        /// which is the assumption that let a retiree read as a fatality. Pinned
        /// so a later tidy-up cannot quietly align the two and make an ordinal
        /// mix-up silent.
        /// </summary>
        [Fact]
        public void TheStandingDeliberatelyDoesNotShareKspsNumbering()
        {
            Assert.NotEqual((int)KspRosterStatus.Available, (int)CrewStanding.Available);
            Assert.NotEqual((int)KspRosterStatus.Assigned, (int)CrewStanding.Assigned);
            Assert.NotEqual((int)KspRosterStatus.Dead, (int)CrewStanding.Dead);
            Assert.NotEqual((int)KspRosterStatus.Missing, (int)CrewStanding.Missing);
        }
    }
}
