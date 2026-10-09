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

        private sealed class FakeStrength : IPersistableLinkStrength
        {
            private readonly double _bits;

            public FakeStrength(double bits) => _bits = bits;

            public string ModelId => "fake.v1";

            public Dictionary<string, object?> Describe() => new Dictionary<string, object?> { ["bits"] = _bits };

            public ContactHopFacts FactsAt(double ut, double separationMeters) =>
                new ContactHopFacts(0.5, new Dictionary<string, object?> { ["fake"] = new Dictionary<string, object?> { ["bits"] = _bits, ["metres"] = separationMeters } });
        }

        private static IContactLinkStrength? RestoreFake(string model, IReadOnlyDictionary<string, object?> data) =>
            model == "fake.v1" && data.TryGetValue("bits", out var bits) && bits is double d ? new FakeStrength(d) : null;

        [Fact]
        public void AStrengthModelACraftWasHeardWithComesBackAndAnswersAsItDid()
        {
            var links = new Dictionary<string, CraftLink> { ["ground:ksc"] = new CraftLink(2.5e9, null, new FakeStrength(6.0)), ["vessel:b"] = new CraftLink(null, null) };
            var heard = CraftState.Orbiting("vessel:a", 120.0, 1, Orbit, null, 9000.0, true, links);
            var encoded = HeardSnapshotCodec.Encode(new HeardSnapshot(new[] { new HeardAtCentre("ground:ksc", new[] { heard }, new Dictionary<string, bool>()) }));

            var state = HeardSnapshotCodec.Decode(encoded, RestoreFake)!.Centres.Single().States.Single();

            var facts = state.Links["ground:ksc"].Strength!.FactsAt(0.0, 11.0);
            var fake = Assert.IsType<Dictionary<string, object?>>(facts.Extensions!["fake"]);
            Assert.Equal(6.0, fake["bits"]);
            Assert.Equal(11.0, fake["metres"]);
            Assert.Null(state.Links["vessel:b"].Strength);
        }

        private sealed class FakeRestorer : ILinkStrengthRestorer
        {
            public IContactLinkStrength? RestoreLinkStrength(string modelId, IReadOnlyDictionary<string, object?> data) => RestoreFake(modelId, data);
        }

        [Fact]
        public void TheFakeBackendMeetsTheRestorerConformanceAssertion()
        {
            Sitrep.Contract.TestSupport.LinkStrengthPersistenceConformance.AssertRestorerContract(
                new FakeRestorer(), new FakeStrength(6.0), described => described, new[] { 10.0, 1e6, 1e9 });
        }

        private sealed class BulkyStrength : IPersistableLinkStrength
        {
            private readonly string _craft;

            public BulkyStrength(string craft) => _craft = craft;

            public string ModelId => "bulky.v1";

            public Dictionary<string, object?> Describe()
            {
                var antennas = new List<object?>();
                for (var i = 0; i < 6; i++)
                {
                    antennas.Add(new Dictionary<string, object?> { ["id"] = _craft + "/" + i, ["txPowerDbm"] = 40.0 + i, ["band"] = "S", ["note"] = new string('x', 120) });
                }
                return new Dictionary<string, object?> { ["from"] = antennas, ["to"] = antennas, ["label"] = _craft };
            }

            public ContactHopFacts FactsAt(double ut, double separationMeters) => new ContactHopFacts(0.5);
        }

        private static int EncodedSize(int craft, int centres, bool strengths)
        {
            var heardAt = new List<HeardAtCentre>();
            for (var c = 0; c < centres; c++)
            {
                var states = new List<CraftState>();
                for (var a = 0; a < craft; a++)
                {
                    var links = new Dictionary<string, CraftLink>();
                    for (var b = 0; b < craft; b++)
                    {
                        if (a != b)
                        {
                            links["vessel:" + b] = new CraftLink(1e9, null, strengths ? new BulkyStrength("vessel:" + a) : null);
                        }
                    }
                    states.Add(CraftState.Orbiting("vessel:" + a, 100.0, 1, Orbit, null, 9000.0, true, links));
                }
                heardAt.Add(new HeardAtCentre("ground:" + c, states, new Dictionary<string, bool>()));
            }
            return HeardSnapshotCodec.Encode(new HeardSnapshot(heardAt)).Length;
        }

        [Fact]
        public void TheStrengthModelsAddToASaveByTheCraftAndNotByTheCraftTimesTheCentresTimesTheLinks()
        {
            const int craft = 6;
            const int centres = 16;
            var described = System.Text.Encoding.UTF8.GetByteCount(
                System.Text.Json.JsonSerializer.Serialize(new BulkyStrength("vessel:0").Describe())) * 4 / 3;

            var added = EncodedSize(craft, centres, true) - EncodedSize(craft, centres, false);

            var written = (double)craft * (craft - 1) * centres * described;
            Assert.True(added < written * 0.1, "the models add " + added + " bytes where writing each in full would add " + (long)written);
            var more = EncodedSize(craft, centres * 2, true) - EncodedSize(craft, centres * 2, false);
            Assert.True(more < added * 2.5, "doubling the centres more than doubled what the models add: " + added + " to " + more);
        }

        [Fact]
        public void AStrengthModelNoBackendCanBuildAgainLeavesThePairWithoutOne()
        {
            var links = new Dictionary<string, CraftLink> { ["ground:ksc"] = new CraftLink(2.5e9, null, new FakeStrength(6.0)) };
            var heard = CraftState.Orbiting("vessel:a", 120.0, 1, Orbit, null, 9000.0, true, links);
            var encoded = HeardSnapshotCodec.Encode(new HeardSnapshot(new[] { new HeardAtCentre("ground:ksc", new[] { heard }, new Dictionary<string, bool>()) }));

            Assert.Null(HeardSnapshotCodec.Decode(encoded)!.Centres.Single().States.Single().Links["ground:ksc"].Strength);
            Assert.Null(HeardSnapshotCodec.Decode(encoded, (model, data) => throw new System.InvalidOperationException("unreadable"))!.Centres.Single().States.Single().Links["ground:ksc"].Strength);
        }

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
                },
                SignalQuantity.DataRateHeadroom)
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
            Assert.Equal(SignalQuantity.DataRateHeadroom, a.Quantity);
            Assert.True(a.Hops[0].ToIsCraft);
            Assert.False(a.Hops[1].ToIsCraft);
            Assert.Null(a.Hops[1].Extensions);
            var b = back.Single(r => r.CraftId == "vessel:b");
            Assert.False(b.Connected);
            Assert.Null(b.Degrade.Level);
            Assert.Empty(b.Hops);
        }

        [Fact]
        public void WhereACentreHadSeenAnObjectToBeComesBackAndSoDoesOneSeenToBeGone()
        {
            var listed = new Dictionary<string, object?>
            {
                ["vesselId"] = "junk", ["name"] = "Spent stage", ["vesselType"] = (int)VesselType.Debris, ["situation"] = 32, ["bodyIndex"] = 1,
                ["crewCount"] = 4,
                ["orbit"] = new Dictionary<string, object?> { ["sma"] = 700_000.0 },
            };
            var snapshot = new HeardSnapshot(new[]
            {
                new HeardAtCentre(
                    "ground:ksc",
                    new CraftState[0],
                    new Dictionary<string, bool>(),
                    null,
                    new[] { CraftSighting.Of("vessel:junk", 12.0, listed), CraftSighting.Gone("vessel:lost", 15.0) }),
            });

            var back = HeardSnapshotCodec.Decode(HeardSnapshotCodec.Encode(snapshot))!.Centres.Single().Sightings;

            var junk = back.Single(s => s.Id == "vessel:junk");
            Assert.True(junk.Exists);
            Assert.Equal(12.0, junk.CapturedUt);
            Assert.Equal("Spent stage", junk.Listed!["name"]);
            Assert.Equal((int)VesselType.Debris, junk.Listed["vesselType"]);
            Assert.Equal(1, junk.Listed["bodyIndex"]);
            Assert.False(junk.Listed.ContainsKey("crewCount"));
            Assert.Equal(700_000.0, ((Dictionary<string, object?>)junk.Listed["orbit"]!)["sma"]);
            Assert.False(back.Single(s => s.Id == "vessel:lost").Exists);
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
