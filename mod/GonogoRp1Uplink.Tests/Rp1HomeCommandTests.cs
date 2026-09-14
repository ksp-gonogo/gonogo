using System;
using System.Collections.Generic;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The RP-1 home-command claimant: home is the oldest space centre RP-1 still
    /// holds, named by the ground station RP-1 associates with it, and its standing
    /// in the election against a comms claimant and the stock vanilla.
    ///
    /// <para>The centre roster is read through the production reflection walk
    /// against the stand-in graph in <c>Rp0Fixture.cs</c>. The stock vanilla and
    /// the comms claimant live in assemblies this project may not name, so the
    /// election runs through the real <see cref="Kernel"/> with stand-ins in their
    /// places.</para>
    /// </summary>
    [Collection("rp0-static-graph")]
    public class Rp1HomeCommandTests : IDisposable
    {
        // Claimed for the census in Sitrep.Host.IntegrationTests, which discovers which
        // capabilities an Uplink can win and fails on one nothing claims.
        //
        // exclusive-capability-starvation: homeCommand

        private const int Earth = 3;
        private const string Cape = "US - Cape Canaveral";
        private const string Baikonur = "KZ - Baikonur";

        public Rp1HomeCommandTests() => SpaceCenterManagement.Instance = null;

        public void Dispose() => SpaceCenterManagement.Instance = null;

        private static readonly ICommandCentre[] RssStations =
        {
            Ground("ground:DSS 14 - Goldstone"),
            Ground("ground:" + Baikonur),
            Ground("ground:" + Cape),
            Ground("ground:DSS 63 - Madrid"),
        };

        private static ICommandCentre Ground(string id) => new Centre(id, CommandCentreKind.GroundStation);

        private static LCSpaceCenter Site(string name, string? groundStation) =>
            new LCSpaceCenter { KSCName = name, GroundStation = groundStation };

        private static Rp1HomeCommandProvider Claimant() =>
            new Rp1HomeCommandProvider(new Rp1ScReflection().OldestCentreGroundStation);

        /// <summary>
        /// A career founded at the Cape that has since opened Baikonur and moved
        /// there. RP-1 appended Baikonur, so the Cape is still first, and the active
        /// site is not the question.
        /// </summary>
        [Fact]
        public void The_oldest_centre_is_home_over_a_newer_active_one()
        {
            var cape = Site("us_cape_canaveral", Cape);
            var baikonur = Site("kz_baikonur", Baikonur);
            SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { cape, baikonur }, ActiveSC = baikonur };

            Assert.Equal("ground:" + Cape, Claimant().Identify(RssStations).CentreId);
        }

        /// <summary>
        /// RP-1 drops a centre with nothing built at it that is not the active one
        /// when a save loads. The claimant holds no memory of the centre it named
        /// before, so the next-oldest is home on the next ask.
        /// </summary>
        [Fact]
        public void A_pruned_oldest_centre_leaves_the_next_oldest_as_home()
        {
            var scm = new SpaceCenterManagement { KSCs = { Site("us_cape_canaveral", Cape), Site("kz_baikonur", Baikonur) } };
            scm.ActiveSC = scm.KSCs[1];
            SpaceCenterManagement.Instance = scm;
            var claimant = Claimant();
            Assert.Equal("ground:" + Cape, claimant.Identify(RssStations).CentreId);

            scm.KSCs.RemoveAt(0);

            Assert.Equal("ground:" + Baikonur, claimant.Identify(RssStations).CentreId);
        }

        [Fact]
        public void No_centres_is_not_identified()
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement();

            Assert.Same(HomeCommand.NotIdentified, Claimant().Identify(RssStations));
        }

        [Fact]
        public void No_space_centre_manager_or_a_save_rp1_does_not_manage_is_not_identified()
        {
            Assert.Same(HomeCommand.NotIdentified, Claimant().Identify(RssStations));

            SpaceCenterManagement.Instance = new SpaceCenterManagement
            {
                KSCs = { Site("us_cape_canaveral", Cape) },
                enabledForSave = false,
            };

            Assert.Same(HomeCommand.NotIdentified, Claimant().Identify(RssStations));
        }

        /// <summary>
        /// The oldest centre is home whether or not a station can be named for it,
        /// so a newer centre that can be named does not stand in.
        /// </summary>
        [Fact]
        public void An_oldest_centre_with_no_ground_station_is_not_identified_rather_than_passed_over()
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement
            {
                KSCs = { Site("us_cape_canaveral", null), Site("kz_baikonur", Baikonur) },
            };

            Assert.Same(HomeCommand.NotIdentified, Claimant().Identify(RssStations));
        }

        /// <summary>The station whose name is the ground station, never one whose name merely starts with it.</summary>
        [Fact]
        public void A_station_matches_on_its_whole_name()
        {
            var centres = new[] { Ground("ground:US - Cape Canaveral SFS"), Ground("ground:" + Cape) };

            Assert.Equal("ground:" + Cape, Rp1HomeCommandProvider.CentreFor(Cape, centres));
            Assert.Null(Rp1HomeCommandProvider.CentreFor("US - Cape", centres));
        }

        /// <summary>
        /// A second station sharing a name is minted with a suffix. When it is the
        /// only active station minted from the name, it is the one there is.
        /// </summary>
        [Fact]
        public void A_suffixed_id_is_matched_when_it_is_the_only_station_minted_from_the_name()
        {
            var centres = new[] { Ground("ground:DSS 14 - Goldstone"), Ground("ground:" + Cape + "#2") };

            Assert.Equal("ground:" + Cape + "#2", Rp1HomeCommandProvider.CentreFor(Cape, centres));
        }

        /// <summary>
        /// Two active stations minted from the one name cannot be told apart by id,
        /// so neither is named rather than one being guessed.
        /// </summary>
        [Fact]
        public void Two_stations_minted_from_the_same_name_are_not_identified()
        {
            var centres = new[] { Ground("ground:" + Cape + "#2"), Ground("ground:" + Cape) };

            Assert.Null(Rp1HomeCommandProvider.CentreFor(Cape, centres));
        }

        /// <summary>A suffix is a hash and digits. A name that continues past the station's is a different station.</summary>
        [Fact]
        public void Only_a_hash_and_digits_count_as_a_suffix()
        {
            var centres = new[] { Ground("ground:" + Cape + "#North"), Ground("ground:" + Cape + "#") };

            Assert.Null(Rp1HomeCommandProvider.CentreFor(Cape, centres));
        }

        [Fact]
        public void Only_ground_stations_are_candidates()
        {
            var centres = new ICommandCentre[] { new Centre("ground:" + Cape, CommandCentreKind.Custom) };

            Assert.Null(Rp1HomeCommandProvider.CentreFor(Cape, centres));
        }

        [Fact]
        public void A_ground_station_no_active_centre_carries_is_not_identified()
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement { KSCs = { Site("us_cape_canaveral", Cape) } };

            Assert.Same(HomeCommand.NotIdentified, Claimant().Identify(new[] { Ground("ground:DSS 63 - Madrid") }));
        }

        [Fact]
        public void Registration_is_priority_twenty_without_IsDefault()
        {
            var registration = Rp1HomeCommandProvider.Registration(() => Cape, () => true);

            Assert.Equal(HomeCommandCapability.Id, registration.Capability);
            Assert.Equal(Rp1HomeCommandProvider.Id, registration.Id);
            Assert.Equal(20.0, registration.Priority);
            Assert.False(registration.IsDefault);
        }

        private static Kernel DeclaredKernel()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = HomeCommandCapability.Id,
                Exclusive = true,
                Vanilla = _ => new StandInClaimant("stock"),
            });
            return kernel;
        }

        private static ProviderRegistration StandInCommsClaimant() => new ProviderRegistration
        {
            Capability = HomeCommandCapability.Id,
            Id = "comms",
            Priority = 10.0,
            Factory = _ => new StandInClaimant("comms"),
        };

        private static IHomeCommandProvider Elected(params ProviderRegistration[] claimants)
        {
            var kernel = DeclaredKernel();
            foreach (var claimant in claimants)
            {
                kernel.RegisterProvider(claimant);
            }

            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel.Query<IHomeCommandProvider>(HomeCommandCapability.Id);
        }

        [Fact]
        public void Election_rp1_beats_a_comms_claimant_and_the_stock_vanilla()
        {
            var elected = Elected(
                StandInCommsClaimant(),
                Rp1HomeCommandProvider.Registration(() => Cape, () => true));

            Assert.Equal(Rp1HomeCommandProvider.Id, elected.ProviderId);
            Assert.Equal("ground:" + Cape, elected.Identify(RssStations).CentreId);
        }

        [Fact]
        public void Election_rp1_withdrawn_leaves_the_comms_claimant_the_winner()
        {
            var elected = Elected(
                StandInCommsClaimant(),
                Rp1HomeCommandProvider.Registration(() => Cape, () => false));

            Assert.Equal("comms", elected.ProviderId);
        }

        [Fact]
        public void The_kscswitcher_probe_finds_the_site_loader()
        {
            Assert.True(new Rp1ScReflection().IsKscSwitcherLoaded());
        }

        /// <summary>
        /// Registered by the Uplink itself and answering with nothing subscribed:
        /// the claimant reads RP-1 when it is asked rather than out of a capture
        /// the subscription gate could skip.
        /// </summary>
        [Fact]
        public void The_uplink_registers_the_claimant_and_it_answers_with_nothing_subscribed()
        {
            var baikonur = Site("kz_baikonur", Baikonur);
            SpaceCenterManagement.Instance = new SpaceCenterManagement
            {
                KSCs = { Site("us_cape_canaveral", Cape), baikonur },
                ActiveSC = baikonur,
            };
            var kernel = DeclaredKernel();
            kernel.RegisterProvider(StandInCommsClaimant());
            var host = new StarvationProbeHost(kernel);
            new Rp1ScUplink().Register(host);
            host.Resolve();

            host.DriveTicks(3, new KspSnapshot());

            var elected = kernel.Query<IHomeCommandProvider>(HomeCommandCapability.Id);
            Assert.Equal(Rp1HomeCommandProvider.Id, elected.ProviderId);
            Assert.Equal("ground:" + Cape, elected.Identify(RssStations).CentreId);
        }

        private sealed class StandInClaimant : IHomeCommandProvider
        {
            public StandInClaimant(string id) => ProviderId = id;

            public string ProviderId { get; }

            public HomeCommand Identify(IReadOnlyList<ICommandCentre> activeCentres) =>
                HomeCommand.Identified("ground:" + ProviderId);
        }

        private sealed class Centre : ICommandCentre
        {
            public Centre(string id, CommandCentreKind kind)
            {
                Id = id;
                Kind = kind;
            }

            public string Id { get; }
            public string DisplayName => Id;
            public CommandCentreKind Kind { get; }
            public int? BodyIndex => Earth;
            public double? Latitude => 0.0;
            public double? Longitude => 0.0;
            public bool IsActiveNow() => true;
        }
    }
}
