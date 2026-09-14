using System;
using System.Collections.Generic;
using Gonogo.RealAntennasUplink;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.RealAntennasUplink.Tests
{
    /// <summary>
    /// The RealAntennas home-command claimant: the ground station nearest KSP's space
    /// centre, on the same body, and its standing in the election against the stock
    /// vanilla and a career overhaul's claimant.
    ///
    /// <para>The stock vanilla lives in core, which this project may not reference, so
    /// the election runs through the real <see cref="Kernel"/> with a stand-in in its
    /// place. The rule under test is the kernel's, which does not care who the vanilla
    /// is.</para>
    /// </summary>
    public class RaHomeCommandTests
    {
        private const int Kerbin = 1;
        private const int Mun = 2;

        /// <summary>Stock's space centre, where <c>SpaceCenter.Start</c> puts it on Kerbin.</summary>
        private static readonly SpaceCentreFix StockSpaceCentre = new SpaceCentreFix(Kerbin, -0.0972, -74.5577);

        private static ICommandCentre Ground(string id, int? body, double? latitude, double? longitude) =>
            new Centre(id, CommandCentreKind.GroundStation, body, latitude, longitude);

        private static HomeCommand Answer(SpaceCentreFix? spaceCentre, params ICommandCentre[] centres) =>
            new RaHomeCommandProvider(() => spaceCentre).Identify(centres);

        [Fact]
        public void TheStationNearestTheSpaceCentre_IsHome_UnderTheIdCoreHandedIn()
        {
            var answer = Answer(
                StockSpaceCentre,
                Ground("ground:Woomerang Station", Kerbin, 45.29, 136.11),
                Ground("ground:Kerbal Space Center", Kerbin, 0.09694, -74.0),
                Ground("ground:Dessert Station", Kerbin, -6.56, -144.04));

            Assert.Equal("ground:Kerbal Space Center", answer.CentreId);
        }

        /// <summary>
        /// The RSS shape: a pack builds its launch-site station beside a network of
        /// deep-space stations, several of them nearer each other than to the Cape.
        /// </summary>
        [Fact]
        public void OnRss_TheCapeIsHome_NotTheFirstStationListed()
        {
            const int earth = 3;
            var answer = Answer(
                new SpaceCentreFix(earth, 28.6084, -80.6043),
                Ground("ground:DSS 14 - Goldstone", earth, 35.426, -116.89),
                Ground("ground:DSS 63 - Madrid", earth, 40.431, -4.248),
                Ground("ground:US - Cape Canaveral", earth, 28.608, -80.604),
                Ground("ground:DSS 43 - Canberra", earth, -35.402, 148.98));

            Assert.Equal("ground:US - Cape Canaveral", answer.CentreId);
        }

        /// <summary>
        /// Latitude and longitude alone put this Mun station closest, which is the
        /// mistake: a position on another body is no distance from anything on Kerbin.
        /// </summary>
        [Fact]
        public void AStationOnAnotherBody_IsIgnored_HoweverCloseItsCoordinates()
        {
            var answer = Answer(
                StockSpaceCentre,
                Ground("ground:Mun Relay", Mun, -0.0972, -74.5577),
                Ground("ground:Woomerang Station", Kerbin, 45.29, 136.11));

            Assert.Equal("ground:Woomerang Station", answer.CentreId);
        }

        /// <summary>Two stations mirrored across the space centre's meridian are exactly as far; the smaller id wins, whatever order the scene lists them in.</summary>
        [Fact]
        public void ATieAtEqualDistance_IsDecidedByTheSmallerId_InEitherOrder()
        {
            var centre = new SpaceCentreFix(Kerbin, 0.0, 0.0);
            var east = Ground("ground:Relay#2", Kerbin, 0.0, 10.0);
            var west = Ground("ground:Relay", Kerbin, 0.0, -10.0);

            Assert.Equal("ground:Relay", Answer(centre, east, west).CentreId);
            Assert.Equal("ground:Relay", Answer(centre, west, east).CentreId);
        }

        /// <summary>
        /// Across the antimeridian the stations are neighbours. Distance measured on
        /// raw longitude difference would put the far one nearer.
        /// </summary>
        [Fact]
        public void Distance_IsGreatCircle_SoTheAntimeridianIsNoWall()
        {
            var answer = Answer(
                new SpaceCentreFix(Kerbin, 0.0, 179.0),
                Ground("ground:Across", Kerbin, 0.0, -179.0),
                Ground("ground:Same Side", Kerbin, 0.0, 170.0));

            Assert.Equal("ground:Across", answer.CentreId);
        }

        [Fact]
        public void OnlyGroundStationsAreCandidates_NotALandedCrewedVessel()
        {
            var answer = Answer(
                StockSpaceCentre,
                new Centre("vessel:on-the-pad", CommandCentreKind.CrewedVessel, Kerbin, -0.0972, -74.5577),
                Ground("ground:Woomerang Station", Kerbin, 45.29, 136.11));

            Assert.Equal("ground:Woomerang Station", answer.CentreId);
        }

        [Fact]
        public void NoSpaceCentreReadable_IsNotIdentified()
        {
            Assert.Same(
                HomeCommand.NotIdentified,
                Answer(null, Ground("ground:Kerbal Space Center", Kerbin, 0.09694, -74.0)));
        }

        [Fact]
        public void NoGroundStations_IsNotIdentified()
        {
            Assert.Same(HomeCommand.NotIdentified, Answer(StockSpaceCentre));
        }

        [Fact]
        public void NoStationOnTheSpaceCentresBody_IsNotIdentified()
        {
            Assert.Same(
                HomeCommand.NotIdentified,
                Answer(StockSpaceCentre, Ground("ground:Mun Relay", Mun, 0.0, 0.0)));
        }

        /// <summary>A station whose position could not be read is not a candidate, rather than a station at (0, 0).</summary>
        [Fact]
        public void AStationWithNoPosition_IsNotACandidate()
        {
            var centre = new SpaceCentreFix(Kerbin, 0.0, 0.0);

            Assert.Same(HomeCommand.NotIdentified, Answer(centre, Ground("ground:Unread", Kerbin, null, null)));
            Assert.Equal(
                "ground:Far",
                Answer(centre, Ground("ground:Unread", Kerbin, null, null), Ground("ground:Far", Kerbin, 60.0, 60.0)).CentreId);
        }

        [Fact]
        public void Registration_IsPriorityTen_WithoutIsDefault()
        {
            var registration = RaHomeCommandProvider.Registration(() => StockSpaceCentre);

            Assert.Equal(HomeCommandCapability.Id, registration.Capability);
            Assert.Equal(RaHomeCommandProvider.Id, registration.Id);
            Assert.Equal(10.0, registration.Priority);
            Assert.False(registration.IsDefault);
        }

        private static Kernel ElectionWith(params ProviderRegistration[] claimants)
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = HomeCommandCapability.Id,
                Exclusive = true,
                Vanilla = _ => new StandInClaimant("stock"),
            });
            foreach (var claimant in claimants)
            {
                kernel.RegisterProvider(claimant);
            }

            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        private static readonly ICommandCentre[] StockStations =
        {
            Ground("ground:Woomerang Station", Kerbin, 45.29, 136.11),
            Ground("ground:Kerbal Space Center", Kerbin, 0.09694, -74.0),
        };

        [Fact]
        public void Election_TheRaClaimantAlone_BeatsTheStockVanilla()
        {
            var kernel = ElectionWith(RaHomeCommandProvider.Registration(() => StockSpaceCentre));

            var elected = kernel.Query<IHomeCommandProvider>(HomeCommandCapability.Id);

            Assert.Equal(RaHomeCommandProvider.Id, elected.ProviderId);
            Assert.Equal("ground:Kerbal Space Center", elected.Identify(StockStations).CentreId);
        }

        [Fact]
        public void Election_TheRaClaimant_LosesToACareerOverhaulClaimantAtTwenty()
        {
            var kernel = ElectionWith(
                RaHomeCommandProvider.Registration(() => StockSpaceCentre),
                new ProviderRegistration
                {
                    Capability = HomeCommandCapability.Id,
                    Id = "career-overhaul",
                    Priority = 20.0,
                    Factory = _ => new StandInClaimant("career-overhaul"),
                });

            var elected = kernel.Query<IHomeCommandProvider>(HomeCommandCapability.Id);

            Assert.Equal("career-overhaul", elected.ProviderId);
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
            public Centre(string id, CommandCentreKind kind, int? bodyIndex, double? latitude, double? longitude)
            {
                Id = id;
                Kind = kind;
                BodyIndex = bodyIndex;
                Latitude = latitude;
                Longitude = longitude;
            }

            public string Id { get; }
            public string DisplayName => Id;
            public CommandCentreKind Kind { get; }
            public int? BodyIndex { get; }
            public double? Latitude { get; }
            public double? Longitude { get; }
            public bool IsActiveNow() => true;
        }
    }
}
