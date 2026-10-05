using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class HeardSnapshotCodecTests
    {
        private static readonly OrbitElements Orbit = new OrbitElements(700_000.0, 0.01, 0.2, 0.3, 0.4, 0.5, 60.0, 3.5316e12);

        private static HeardSnapshot RoundTrip(params CraftState[] states) =>
            HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(new HeardSnapshot(new[]
            {
                new HeardAtCentre("ground:ksc", states, new Dictionary<string, bool> { ["vessel:a"] = false }),
            })))!;

        [Fact]
        public void AnOrbitingCraftComesBackAsItWasHeardWithItsListingAndItsRangesAndNoLinkModel()
        {
            var links = new Dictionary<string, CraftLink> { ["ground:ksc"] = new CraftLink(2.5e9, null), ["vessel:b"] = new CraftLink(null, null) };
            var listed = new Dictionary<string, object?> { ["vesselId"] = "a", ["name"] = "Alpha", ["vesselType"] = (int)VesselType.Probe, ["crewCount"] = 2, ["commsConnected"] = true };
            var secular = new SecularOrbit(Orbit, 1e-7, 2e-7, 1e-3, 5000.0, SecularBasis.J2Estimate);
            var heard = CraftState.Orbiting("vessel:a", 120.0, 1, Orbit, secular, 9000.0, true, links, settled: false).Named("Alpha").Listed(listed);

            var back = RoundTrip(heard).Centres.Single();

            Assert.Equal("ground:ksc", back.Centre);
            Assert.False(back.Links["vessel:a"]);
            var state = back.States.Single();
            Assert.Equal("vessel:a", state.Id);
            Assert.Equal(120.0, state.CapturedUt);
            Assert.True(state.Exists);
            Assert.True(state.Plannable);
            Assert.False(state.Settled);
            Assert.Equal(1, state.BodyIndex);
            Assert.Equal(Orbit.Sma, state.Orbit!.Value.Sma);
            Assert.Equal(Orbit.Mu, state.Orbit.Value.Mu);
            Assert.Equal(Orbit.Epoch, state.Orbit.Value.Epoch);
            Assert.Equal(9000.0, state.ValidUntilUt);
            Assert.Equal(1e-3, state.Secular!.Value.MeanAnomalyRate);
            Assert.Equal(SecularBasis.J2Estimate, state.Secular.Value.Basis);
            Assert.Equal(5000.0, state.Secular.Value.ValidUntilUt);
            Assert.Equal("Alpha", state.Name);
            Assert.Equal(2, state.Roster!["crewCount"]);
            Assert.Equal((int)VesselType.Probe, state.Roster["vesselType"]);
            Assert.Equal(true, state.Roster["commsConnected"]);
            Assert.Equal(2.5e9, state.Links["ground:ksc"].MaxRangeMeters);
            Assert.Null(state.Links["vessel:b"].MaxRangeMeters);
            Assert.All(state.Links.Values, link => Assert.Null(link.Link));
            Assert.NotNull(state.ToPlanNode());
        }

        [Fact]
        public void ACraftHeardToBeACommandCentreComesBackAsOne()
        {
            var entry = new CommandCentreEntry
            {
                Id = "vessel:a", DisplayName = "Alpha", Kind = "CrewedVessel", BodyIndex = 2, Active = true, IsHome = true, IsHomeFallback = true, DelayQuality = "routed",
            };
            var centre = CraftState.Orbiting("vessel:a", 1.0, 1, Orbit, null, null, true, new Dictionary<string, CraftLink>()).AsCentre(entry);
            var plain = CraftState.Orbiting("vessel:b", 1.0, 1, Orbit, null, null, true, new Dictionary<string, CraftLink>());

            var back = RoundTrip(centre, plain).Centres.Single().States;

            Assert.True(CentreRoster.Same(entry, back.Single(s => s.Id == "vessel:a").Centre));
            Assert.Null(back.Single(s => s.Id == "vessel:b").Centre);
        }

        [Fact]
        public void ARadioReadingACentreHadHeardComesBackWithItsPathAndItsHopFacts()
        {
            var reading = new ContactRadio(
                "vessel:a",
                true,
                0.62,
                new CommsDegrade { ModelId = "m", ModelName = "Model", Level = 0.3 },
                new[]
                {
                    new RadioHop("a", "relay", true, new Dictionary<string, object?> { ["ra"] = new Dictionary<string, object?> { ["band"] = "X", ["rate"] = 1200.0 } }),
                    new RadioHop("relay", "KSC", false),
                })
            {
                CapturedUt = 55.0,
            };
            var ungraded = new ContactRadio("vessel:b", false, 0.0, new CommsDegrade { ModelId = "unknown" }) { CapturedUt = 60.0 };
            var snapshot = new HeardSnapshot(new[]
            {
                new HeardAtCentre("ground:ksc", new CraftState[0], new Dictionary<string, bool>(), new[] { reading, ungraded }),
            });

            var back = HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(snapshot))!.Centres.Single().Radios;

            var a = back.Single(r => r.CraftId == "vessel:a");
            Assert.Equal(55.0, a.CapturedUt);
            Assert.True(a.SaysTheSameAs(reading));
            Assert.Equal("Model", a.Degrade.ModelName);
            Assert.True(a.Hops[0].ToIsCraft);
            Assert.False(a.Hops[1].ToIsCraft);
            Assert.Null(a.Hops[1].Extensions);
            var b = back.Single(r => r.CraftId == "vessel:b");
            Assert.False(b.Connected);
            Assert.Null(b.Degrade.Level);
            Assert.Empty(b.Hops);
        }

        [Fact]
        public void ASaveFromBeforeReadingsWereKeptCarriesNone()
        {
            var old = new HeardSnapshot(new[] { new HeardAtCentre("ground:ksc", new CraftState[0], new Dictionary<string, bool>()) });

            Assert.Empty(HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(old))!.Centres.Single().Radios);
        }

        [Fact]
        public void ALandedCraftAGoneOneAndOneWithNoRadioEachComeBackAsWhatTheyWere()
        {
            var surface = RotatingGroundStation.FromLatitudeLongitude(10.0, 20.0, 0.0, 21_549.425, 600_000.0, 75.0);
            var landed = CraftState.Landed("vessel:l", 5.0, 1, surface, new Dictionary<string, CraftLink>());
            var gone = CraftState.Gone("vessel:g", 6.0);
            var junk = CraftState.WithoutARadio("vessel:j", 7.0, new Dictionary<string, object?> { ["vesselId"] = "j", ["vesselType"] = (int)VesselType.Debris });

            var back = RoundTrip(landed, gone, junk).Centres.Single().States.ToDictionary(s => s.Id);

            var position = back["vessel:l"].Surface!.Value.PositionAt(1234.0);
            Assert.Equal(0.0, (position - surface.PositionAt(1234.0)).Magnitude(), 3);
            Assert.False(back["vessel:g"].Exists);
            Assert.Equal(6.0, back["vessel:g"].CapturedUt);
            Assert.True(back["vessel:j"].Exists);
            Assert.False(back["vessel:j"].Plannable);
            Assert.Null(back["vessel:j"].ToPlanNode());
            Assert.Equal((int)VesselType.Debris, back["vessel:j"].Roster!["vesselType"]);
        }

        [Fact]
        public void ASaveThisBuildCannotReadCarriesNothing()
        {
            Assert.Null(HeardSnapshotCodec.Decode(null));
            Assert.Null(HeardSnapshotCodec.Decode(""));
            Assert.Null(HeardSnapshotCodec.Decode("not base64 at all"));
            Assert.Null(HeardSnapshotCodec.Decode(System.Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("{\"version\":99,\"centres\":[]}"))));
        }
    }
}
