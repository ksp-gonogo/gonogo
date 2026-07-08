using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;
using Xunit.Abstractions;

using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Sibling to <see cref="WireFixtureGeneratorTests"/> — same
    /// <see cref="ReplayKspHost"/> -&gt; <see cref="ChannelEngine"/> ->
    /// real <c>ClientWebSocket</c> pipeline, same raw-wire-frame capture
    /// idiom, but replaying FOUR newly captured recordings that each carry
    /// data the original 2026-07-07 reference session lacks (maneuver node
    /// ids, a live docking approach, populated career/facility/strategy
    /// state, and a real comms connected/disconnected/reconnected
    /// transition) into their OWN per-domain fixtures. Deliberately a
    /// SEPARATE file/class from <see cref="WireFixtureGeneratorTests"/> so
    /// that class — and the existing
    /// <c>local_docs/telemetry-mod/recordings/reference-wire-fixture.json</c>
    /// it produces, which a parallel migration batch's TS tests already
    /// depend on — is never touched by this addition.
    ///
    /// <para>All four recordings and generated fixtures are gitignored/
    /// local-only (<c>local_docs/</c> is blanket-ignored), same posture as
    /// the original generator: regenerated on demand by running this test
    /// class, never committed.</para>
    /// </summary>
    public class DomainWireFixtureGeneratorTests
    {
        private readonly ITestOutputHelper _output;

        public DomainWireFixtureGeneratorTests(ITestOutputHelper output)
        {
            _output = output;
        }

        private static readonly TimeSpan TickTimeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan ReaderPollTimeout = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan FinalDrainDelay = TimeSpan.FromMilliseconds(750);

        private static string RecordingsDir([CallerFilePath] string sourceFilePath = "")
        {
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "..", "local_docs", "telemetry-mod", "recordings");
        }

        [Fact]
        public async Task GeneratesManeuverWireFixtureFromManeuveringRecording()
        {
            const string recordingFileName = "reference-maneuver-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-maneuver.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[]
            {
                VesselViewProvider.ManeuverTopic,
                VesselViewProvider.TargetTopic,
                VesselViewProvider.OrbitTopic,
                VesselViewProvider.IdentityTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestVesselExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var maneuverFrames = ParsePayloads(capture.Frames, VesselViewProvider.ManeuverTopic);
            Assert.True(maneuverFrames.Count > 0, "expected at least one vessel.maneuver frame");

            var nodeIds = maneuverFrames
                .SelectMany(p => (p.TryGetValue("nodes", out var raw) ? raw as IEnumerable<object?> : null) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .Select(n => n.TryGetValue("id", out var id) ? id as string : null)
                .Where(id => !string.IsNullOrEmpty(id))
                .ToList();
            Assert.True(nodeIds.Count > 0, "expected at least one maneuver node carrying a real (non-empty) id");

            var targetFrames = ParsePayloads(capture.Frames, VesselViewProvider.TargetTopic);
            Assert.True(targetFrames.Count > 0, "expected at least one vessel.target frame");
            Assert.Contains(targetFrames, t => (t.TryGetValue("name", out var name) ? name as string : null) == "Mun");

            _output.WriteLine($"maneuver fixture: {maneuverFrames.Count} vessel.maneuver frames, {nodeIds.Count} node-id occurrences, {targetFrames.Count} vessel.target frames.");
            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesDockWireFixtureFromDockingRecording()
        {
            const string recordingFileName = "reference-dock-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-dock.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[]
            {
                VesselViewProvider.DockTopic,
                VesselViewProvider.TargetTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestVesselExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var dockFrames = ParsePayloads(capture.Frames, VesselViewProvider.DockTopic);
            Assert.True(dockFrames.Count > 0, "expected at least one vessel.dock frame");
            Assert.Contains(dockFrames, d => d.TryGetValue("forwardDot", out var fd) && fd is double);

            _output.WriteLine($"dock fixture: {dockFrames.Count} vessel.dock frames.");
            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesCareerWireFixtureFromCareerRecording()
        {
            const string recordingFileName = "reference-career-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-career.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[] { CareerViewProvider.Topic };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestCareerExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var careerFrames = ParsePayloads(capture.Frames, CareerViewProvider.Topic);
            Assert.True(careerFrames.Count > 0, "expected at least one career.status frame");

            Assert.Contains(careerFrames, c =>
                c.TryGetValue("economy", out var econ) &&
                econ is IDictionary<string, object?> econDict &&
                econDict.TryGetValue("funds", out var funds) &&
                funds is double);

            Assert.Contains(careerFrames, c =>
                c.TryGetValue("facilities", out var fac) &&
                fac is IDictionary<string, object?> facDict &&
                facDict.Values.OfType<IDictionary<string, object?>>()
                    .Any(f => f.TryGetValue("upgradeCost", out var cost) && cost is double));

            Assert.Contains(careerFrames, c =>
                c.TryGetValue("strategies", out var strat) &&
                strat is IDictionary<string, object?> stratDict &&
                stratDict.TryGetValue("active", out var active) &&
                active is IEnumerable<object?> activeList &&
                activeList.OfType<IDictionary<string, object?>>()
                    .Any(s => !string.IsNullOrEmpty(s.TryGetValue("title", out var title) ? title as string : null)));

            _output.WriteLine($"career fixture: {careerFrames.Count} career.status frames.");
            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        /// <summary>
        /// REAL-SHAPE SYNTHETIC fixture for the M3b career-DETAIL widget
        /// batch (ContractManager/Objectives/TechTree/SpaceCenterStatus/
        /// Strategies). <see cref="GeneratesCareerWireFixtureFromCareerRecording"/>
        /// above replays the REAL <c>reference-career-2026-07-08.json</c>
        /// capture — but that recording predates the 3069438 capture-extend
        /// session (facilities integer tiers, contract id/parameters,
        /// strategy list, tech nodes): every facility's <c>currentTier</c>/
        /// <c>maxTier</c>/<c>upgradeCost</c> is null on that wire, and
        /// contracts/strategies.all/tech.nodes are all empty arrays (verified
        /// by inspecting the generated <c>reference-wire-fixture-career.json</c>
        /// directly). Blocking the five detail widgets' migration on a fresh
        /// Space Center capture would stall momentum, so this test instead
        /// hand-authors a synthetic "career" RAW snapshot dict carrying the
        /// EXTENDED shape (matching <c>Gonogo.KSP.KspHost.BuildCareer</c>'s
        /// documented output — see <see cref="CareerViewProvider"/>'s own doc
        /// comment for the exact raw encoding) and replays it through the
        /// REAL <see cref="CareerViewProvider.BuildCareer"/> mapper via the
        /// same <see cref="ReplayAndCaptureAsync"/> plumbing every other
        /// fixture in this file uses. The resulting WIRE SHAPE is therefore
        /// the provider's genuine mapping output, not a hand-guessed shape —
        /// only the underlying VALUES are synthetic/invented. Real-recording
        /// validation is deferred to the user's next Space Center capture;
        /// see <c>.superpowers/sdd/m3-career-detail-report.md</c>.
        /// </summary>
        [Fact]
        public async Task GeneratesSyntheticCareerDetailWireFixtureFromHandAuthoredRealShapeSnapshot()
        {
            const string fixtureFileName = "reference-wire-fixture-career-synthetic.json";
            var session = BuildSyntheticCareerSession();
            var topics = new[] { CareerViewProvider.Topic };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestCareerExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var careerFrames = ParsePayloads(capture.Frames, CareerViewProvider.Topic);
            Assert.True(careerFrames.Count > 0, "expected at least one career.status frame");

            Assert.Contains(careerFrames, c =>
                c.TryGetValue("economy", out var econ) &&
                econ is IDictionary<string, object?> econDict &&
                econDict.TryGetValue("funds", out var funds) &&
                funds is double fundsD && fundsD > 0);

            // Extended facilities: real integer currentTier/maxTier + a
            // positive upgradeCost — the exact fields
            // GeneratesCareerWireFixtureFromCareerRecording's real (pre-extend)
            // recording carries as null for every facility.
            Assert.Contains(careerFrames, c =>
                c.TryGetValue("facilities", out var fac) &&
                fac is IDictionary<string, object?> facDict &&
                facDict.TryGetValue("LaunchPad", out var lpRaw) &&
                lpRaw is IDictionary<string, object?> lp &&
                lp.TryGetValue("currentTier", out var tier) && tier is double tierD && tierD == 1 &&
                lp.TryGetValue("maxTier", out var maxTier) && maxTier is double maxTierD && maxTierD == 2 &&
                lp.TryGetValue("upgradeCost", out var cost) && cost is double costD && costD > 0);

            // Extended contracts: stable `id` + non-empty `parameters` — the
            // exact fields map-topic.ts's (pre-migration) gap comment says
            // the old wire lacked entirely.
            Assert.Contains(careerFrames, c =>
                c.TryGetValue("contracts", out var contractsRaw) &&
                contractsRaw is IDictionary<string, object?> contracts &&
                contracts.TryGetValue("active", out var activeRaw) &&
                activeRaw is IEnumerable<object?> active &&
                active.OfType<IDictionary<string, object?>>().Any(entry =>
                    !string.IsNullOrEmpty(entry.TryGetValue("id", out var id) ? id as string : null) &&
                    entry.TryGetValue("parameters", out var parsRaw) &&
                    parsRaw is IEnumerable<object?> pars &&
                    pars.OfType<IDictionary<string, object?>>().Any()));

            // Extended strategies: a 3+-entry `all` roster (active + at least
            // two inactive) each with a stable `id` and real cost fields.
            Assert.Contains(careerFrames, c =>
                c.TryGetValue("strategies", out var stratRaw) &&
                stratRaw is IDictionary<string, object?> strat &&
                strat.TryGetValue("all", out var allRaw) &&
                allRaw is IEnumerable<object?> allEnumerable &&
                allEnumerable.OfType<IDictionary<string, object?>>().ToList() is var all &&
                all.Count(s => !string.IsNullOrEmpty(s.TryGetValue("id", out var id) ? id as string : null)) >= 3 &&
                all.Any(s => s.TryGetValue("isActive", out var isActive) && isActive is bool isActiveB && !isActiveB) &&
                all.Any(s => s.TryGetValue("initialCostReputation", out var repCost) && repCost is double repCostD && repCostD > 0));

            // Extended tech: id/title/scienceCost/unlocked/parents, including
            // a multi-parent node (a real tech-tree edge shape).
            Assert.Contains(careerFrames, c =>
                c.TryGetValue("tech", out var techRaw) &&
                techRaw is IDictionary<string, object?> tech &&
                tech.TryGetValue("nodes", out var nodesRaw) &&
                nodesRaw is IEnumerable<object?> nodes &&
                nodes.OfType<IDictionary<string, object?>>().Any(n =>
                    n.TryGetValue("parents", out var parentsRaw) &&
                    parentsRaw is IEnumerable<object?> parents &&
                    parents.Count() >= 2));

            _output.WriteLine(
                $"synthetic career-detail fixture: {careerFrames.Count} career.status frames; " +
                "extended facilities/contracts/strategies/tech fields asserted present (real-shape synthetic — " +
                "values hand-authored, wire shape produced by the real CareerViewProvider mapper).");
            WriteFixture(fixtureFileName, "(hand-authored synthetic snapshot — no source recording file)", session.Entries.Count, topics, capture);
        }

        /// <summary>
        /// Builds the hand-authored synthetic <see cref="RecordedSession"/>
        /// backing <see cref="GeneratesSyntheticCareerDetailWireFixtureFromHandAuthoredRealShapeSnapshot"/>.
        /// Two identical-content snapshot entries (T=0 and T=15, inside one
        /// <see cref="CareerUplink"/> keyframe window) so the fixture
        /// carries more than one captured frame, same shape every other
        /// generator in this file produces from a real multi-tick recording.
        /// The raw "career" dict mirrors EXACTLY the shape
        /// <see cref="CareerViewProvider"/>'s own doc comment documents
        /// <c>Gonogo.KSP.KspHost.BuildCareer</c> must populate at
        /// <c>Values["career"]</c> — see that class's doc comment for the
        /// authoritative field list this method is built against.
        /// </summary>
        private static RecordedSession BuildSyntheticCareerSession()
        {
            var career = BuildSyntheticCareerRaw();

            var entries = new List<RecordedEntry>();
            foreach (var t in new[] { 0.0, 15.0 })
            {
                entries.Add(new RecordedEntry
                {
                    T = t,
                    Kind = "snapshot",
                    WallClockUtc = DateTime.UtcNow,
                    Seq = entries.Count,
                    Snapshot = new RecordedSnapshotPayload
                    {
                        // BuildCareer rebuilds fresh Dictionary trees per
                        // Sample() call in the real host — a NEW raw dict per
                        // entry (rather than the same reference twice) keeps
                        // that same "no shared mutable state across ticks"
                        // shape, even though the content is identical.
                        Values = new Dictionary<string, object?> { ["career"] = BuildSyntheticCareerRaw() },
                    },
                });
            }

            return new RecordedSession
            {
                SchemaVersion = RecordedSessionCodec.CurrentSchemaVersion,
                StartUt = 0.0,
                Entries = entries,
            };
        }

        private static Dictionary<string, object?> BuildSyntheticCareerRaw()
        {
            return new Dictionary<string, object?>
            {
                ["economy"] = new Dictionary<string, object?>
                {
                    ["funds"] = 525000.75,
                    ["reputation"] = 62.3,
                    ["science"] = 310.5,
                },
                ["facilities"] = BuildSyntheticFacilities(),
                ["contracts"] = new Dictionary<string, object?>
                {
                    ["active"] = BuildSyntheticActiveContracts(),
                    ["offered"] = BuildSyntheticOfferedContracts(),
                },
                ["strategies"] = BuildSyntheticStrategies(),
                ["tech"] = BuildSyntheticTech(),
            };
        }

        private static Dictionary<string, object?> BuildSyntheticFacilities()
        {
            // Mirrors the exact 9 SpaceCenterFacility enum-name keys observed
            // in the real (pre-extend) reference-wire-fixture-career.json —
            // see this class's own doc comment on the generator above.
            return new Dictionary<string, object?>
            {
                ["LaunchPad"] = Facility(currentTier: 1, maxTier: 2, upgradeCost: 150000.0),
                ["Runway"] = Facility(currentTier: 0, maxTier: 2, upgradeCost: 30000.0),
                ["VehicleAssemblyBuilding"] = Facility(currentTier: 2, maxTier: 2, upgradeCost: null),
                ["SpaceplaneHangar"] = Facility(currentTier: 1, maxTier: 2, upgradeCost: 175000.0),
                ["MissionControl"] = Facility(currentTier: 2, maxTier: 2, upgradeCost: null),
                ["TrackingStation"] = Facility(currentTier: 1, maxTier: 2, upgradeCost: 115000.0),
                ["Administration"] = Facility(currentTier: 0, maxTier: 2, upgradeCost: 55000.0),
                ["ResearchAndDevelopment"] = Facility(currentTier: 1, maxTier: 2, upgradeCost: 225000.0),
                ["AstronautComplex"] = Facility(currentTier: 1, maxTier: 2, upgradeCost: 65000.0),
            };

            static Dictionary<string, object?> Facility(int currentTier, int maxTier, double? upgradeCost) =>
                new Dictionary<string, object?>
                {
                    ["currentTier"] = currentTier,
                    ["maxTier"] = maxTier,
                    ["upgradeCost"] = upgradeCost,
                };
        }

        private static List<object?> BuildSyntheticActiveContracts()
        {
            return new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["id"] = "8834021456123789",
                    ["title"] = "Rescue Kerbal from orbit of Kerbin",
                    ["agent"] = "Kerbin Space Agency Rescue Division",
                    ["state"] = "Active",
                    ["fundsAdvance"] = 5000.0,
                    ["fundsCompletion"] = 25000.0,
                    ["fundsFailure"] = -10000.0,
                    ["scienceCompletion"] = 15.0,
                    ["reputationCompletion"] = 8.0,
                    ["reputationFailure"] = -5.0,
                    ["dateAccepted"] = 1500000.0,
                    ["dateDeadline"] = 2500000.0,
                    ["dateExpire"] = 0.0,
                    ["parameters"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["title"] = "Rescue Buzz Kerman", ["state"] = "Incomplete" },
                        new Dictionary<string, object?> { ["title"] = "Return to Kerbin", ["state"] = "Incomplete" },
                    },
                },
                new Dictionary<string, object?>
                {
                    ["id"] = "9012345678901234",
                    ["title"] = "Explore the Mun's surface",
                    ["agent"] = "Global Exploration Society",
                    ["state"] = "Active",
                    ["fundsAdvance"] = 10000.0,
                    ["fundsCompletion"] = 50000.0,
                    ["fundsFailure"] = 0.0,
                    ["scienceCompletion"] = 40.0,
                    ["reputationCompletion"] = 12.0,
                    ["reputationFailure"] = 0.0,
                    ["dateAccepted"] = 1200000.0,
                    ["dateDeadline"] = 0.0,
                    ["dateExpire"] = 0.0,
                    ["parameters"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["title"] = "Land near the Mun's north pole", ["state"] = "Complete" },
                        new Dictionary<string, object?> { ["title"] = "Plant a flag", ["state"] = "Incomplete" },
                    },
                },
            };
        }

        private static List<object?> BuildSyntheticOfferedContracts()
        {
            return new List<object?>
            {
                new Dictionary<string, object?>
                {
                    ["id"] = "1122334455667788",
                    ["title"] = "Test RT-10 solid fuel booster in flight",
                    ["agent"] = "Kerbin Space Program",
                    ["state"] = "Offered",
                    ["fundsAdvance"] = 0.0,
                    ["fundsCompletion"] = 8500.0,
                    ["fundsFailure"] = 0.0,
                    ["scienceCompletion"] = 5.0,
                    ["reputationCompletion"] = 3.0,
                    ["reputationFailure"] = -2.0,
                    ["dateAccepted"] = 0.0,
                    ["dateDeadline"] = 0.0,
                    ["dateExpire"] = 3000000.0,
                    ["parameters"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["title"] = "Test RT-10 while in flight over Kerbin", ["state"] = "Incomplete" },
                    },
                },
                new Dictionary<string, object?>
                {
                    ["id"] = "2233445566778899",
                    ["title"] = "Contract: Satellite around Kerbin",
                    ["agent"] = "Communications Guild",
                    ["state"] = "Offered",
                    ["fundsAdvance"] = 2000.0,
                    ["fundsCompletion"] = 18000.0,
                    ["fundsFailure"] = -5000.0,
                    ["scienceCompletion"] = 0.0,
                    ["reputationCompletion"] = 6.0,
                    ["reputationFailure"] = -4.0,
                    ["dateAccepted"] = 0.0,
                    ["dateDeadline"] = 0.0,
                    ["dateExpire"] = 2800000.0,
                    ["parameters"] = new List<object?>
                    {
                        new Dictionary<string, object?> { ["title"] = "Achieve orbit around Kerbin", ["state"] = "Incomplete" },
                    },
                },
            };
        }

        private static Dictionary<string, object?> BuildSyntheticStrategies()
        {
            var aggressiveNegotiations = new Dictionary<string, object?>
            {
                ["id"] = "AggressiveNegotiations",
                ["title"] = "Aggressive Negotiations",
                ["description"] = "Push harder on every deal.",
                ["department"] = "Operations",
                ["isActive"] = true,
                ["factor"] = 0.15,
                ["dateActivated"] = 33246.0,
                ["requiredReputation"] = -10.0,
                ["initialCostFunds"] = 0.0,
                ["initialCostScience"] = 0.0,
                ["initialCostReputation"] = 14.5,
                ["hasFactorSlider"] = true,
                ["factorSliderDefault"] = 0.05,
                ["factorSliderSteps"] = 20,
                ["canActivate"] = false,
                ["activateBlockedReason"] = "Strategy already active.",
                ["canDeactivate"] = true,
                ["deactivateBlockedReason"] = "",
                ["effect"] = "Effects: -1.5% funds off launch costs.",
            };
            var fundraisingCampaign = new Dictionary<string, object?>
            {
                ["id"] = "FundraisingCampaignCfg",
                ["title"] = "Fundraising Campaign",
                ["description"] = "Reach out to the public for monetary donations.",
                ["department"] = "Finances",
                ["isActive"] = false,
                ["factor"] = 0.05,
                ["dateActivated"] = 0.0,
                ["requiredReputation"] = -437.5,
                ["initialCostFunds"] = 0.0,
                ["initialCostScience"] = 0.0,
                ["initialCostReputation"] = 7.3,
                ["hasFactorSlider"] = true,
                ["factorSliderDefault"] = 0.05,
                ["factorSliderSteps"] = 20,
                ["canActivate"] = true,
                ["activateBlockedReason"] = "",
                ["canDeactivate"] = false,
                ["deactivateBlockedReason"] = "Strategy is not active",
                ["effect"] = "Effects: takes 5% reputation gains.",
            };
            var patriotismDrive = new Dictionary<string, object?>
            {
                ["id"] = "PatriotismDriveCfg",
                ["title"] = "Patriotism Drive",
                ["description"] = "Instill a sense of national pride in the populace.",
                ["department"] = "Public Relations",
                ["isActive"] = false,
                ["factor"] = 0.05,
                ["dateActivated"] = 0.0,
                ["requiredReputation"] = 750.0,
                ["initialCostFunds"] = 0.0,
                ["initialCostScience"] = 0.0,
                ["initialCostReputation"] = 0.0,
                ["hasFactorSlider"] = false,
                ["factorSliderDefault"] = 0.05,
                ["factorSliderSteps"] = 1,
                ["canActivate"] = false,
                ["activateBlockedReason"] = "Requires more reputation than the program has earned.",
                ["canDeactivate"] = false,
                ["deactivateBlockedReason"] = "Strategy is not active",
                ["effect"] = "",
            };

            return new Dictionary<string, object?>
            {
                ["active"] = new List<object?> { aggressiveNegotiations },
                ["all"] = new List<object?> { aggressiveNegotiations, fundraisingCampaign, patriotismDrive },
                ["activeCount"] = 1,
            };
        }

        private static Dictionary<string, object?> BuildSyntheticTech()
        {
            return new Dictionary<string, object?>
            {
                ["unlockedCount"] = 3,
                ["unlockedIds"] = new List<object?> { "basicRocketry", "engineering101", "survivability" },
                ["nodes"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "basicRocketry",
                        ["title"] = "Basic Rocketry",
                        ["scienceCost"] = 0.0,
                        ["unlocked"] = true,
                        ["parents"] = new List<object?>(),
                    },
                    new Dictionary<string, object?>
                    {
                        ["id"] = "engineering101",
                        ["title"] = "General Rocketry",
                        ["scienceCost"] = 15.0,
                        ["unlocked"] = true,
                        ["parents"] = new List<object?> { "basicRocketry" },
                    },
                    new Dictionary<string, object?>
                    {
                        ["id"] = "survivability",
                        ["title"] = "Survivability",
                        ["scienceCost"] = 15.0,
                        ["unlocked"] = true,
                        ["parents"] = new List<object?> { "basicRocketry" },
                    },
                    new Dictionary<string, object?>
                    {
                        ["id"] = "stability",
                        ["title"] = "Stability",
                        ["scienceCost"] = 45.0,
                        ["unlocked"] = false,
                        // Multi-parent edge — a real tech-tree shape (a node
                        // gated on two prerequisite nodes at once).
                        ["parents"] = new List<object?> { "engineering101", "survivability" },
                    },
                    new Dictionary<string, object?>
                    {
                        ["id"] = "advRocketry",
                        ["title"] = "Advanced Rocketry",
                        ["scienceCost"] = 45.0,
                        ["unlocked"] = false,
                        ["parents"] = new List<object?> { "engineering101" },
                    },
                },
            };
        }

        [Fact]
        public async Task GeneratesCommsWireFixtureFromCommsTransitionRecording()
        {
            const string recordingFileName = "reference-comms-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-comms.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[] { VesselViewProvider.CommsTopic };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestVesselExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var commsStream = ParseStreamFrames(capture.Frames, VesselViewProvider.CommsTopic);
            Assert.True(commsStream.Count > 0, "expected at least one vessel.comms frame");

            // ChannelEngine's own doc comment (see ChannelEngine.cs around the
            // "born"/tombstone tracking): once a channel has emitted a
            // non-null value, a subsequent null mapper result emits exactly
            // ONE tombstone frame (present -> null), then null -> null is
            // suppressed. This recording's disconnection window is
            // represented as a live vessel.comms record with
            // connected:false/signalStrength:0 the whole time -- the comms
            // GROUP itself never goes absent again after the vessel is born
            // -- so no present -> null tombstone is expected from the
            // True -> False -> True window itself; only the "connected"
            // boolean flips inside an always-present payload. Recorded here
            // for the SDK absence-model design: don't wait for a null
            // payload to detect signal loss on this channel, watch
            // `connected`.
            var connectedSequence = commsStream
                .Select(sd => sd.Payload is IDictionary<string, object?> p && p.TryGetValue("connected", out var c) && c is bool b ? (bool?)b : null)
                .ToList();

            var sawTrue1 = false;
            var sawFalse = false;
            var sawTrue2 = false;
            foreach (var connected in connectedSequence)
            {
                if (!sawTrue1 && connected == true)
                {
                    sawTrue1 = true;
                }
                else if (sawTrue1 && !sawFalse && connected == false)
                {
                    sawFalse = true;
                }
                else if (sawFalse && !sawTrue2 && connected == true)
                {
                    sawTrue2 = true;
                }
            }
            Assert.True(sawTrue1 && sawFalse && sawTrue2, "expected a connected True -> False -> True sequence across the captured vessel.comms frames");

            var tombstoneCount = commsStream.Count(sd => sd.Payload == null);
            _output.WriteLine($"comms fixture: {commsStream.Count} vessel.comms frames; True->False->True transition confirmed; {tombstoneCount} null-payload (tombstone) frames observed.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesScienceWireFixtureFromScienceRecording()
        {
            const string recordingFileName = "reference-science-parts-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-science.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            // All three science.* channels, INCLUDING lab/deployed even
            // though this particular recording never populates them (no
            // science lab or Breaking Ground deployed experiment onboard).
            // Subscribing to them proves out ChannelEngine's own "born"
            // semantics (see its doc comment around _born): a channel whose
            // mapper NEVER returns a non-null value is never "born" and
            // therefore emits ZERO wire frames — not a tombstone, not a
            // null-payload keyframe, nothing at all. So a widget backed by
            // science.lab/deployed against THIS fixture will see silence
            // indistinguishable from "not subscribed", not an explicit
            // null/absent signal — asserted below rather than assumed.
            var topics = new[]
            {
                ScienceViewProvider.ExperimentsTopic,
                ScienceViewProvider.LabTopic,
                ScienceViewProvider.DeployedTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestScienceExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            // ScienceViewProvider.BuildExperiments's payload IS the entry
            // list itself (see its doc comment / BuildList), not a wrapping
            // dict keyed "experiments" — same shape as parts.robotics below
            // — so parse the raw StreamData payloads rather than
            // ParsePayloads' IDictionary-only filter.
            var experimentsStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.ExperimentsTopic);
            Assert.True(experimentsStream.Count > 0, "expected at least one science.experiments frame");

            var experimentEntries = experimentsStream
                .SelectMany(sd => (sd.Payload as IEnumerable<object?>) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .ToList();
            Assert.Contains(experimentEntries, e =>
                (e.TryGetValue("experimentId", out var id) ? id as string : null) == "mysteryGoo" &&
                !string.IsNullOrEmpty(e.TryGetValue("subjectId", out var subj) ? subj as string : null));

            var situations = experimentEntries
                .Select(e => e.TryGetValue("situation", out var s) ? s as string : null)
                .Where(s => !string.IsNullOrEmpty(s))
                .Distinct()
                .ToList();
            Assert.True(situations.Count >= 2, $"expected experiments across >=2 distinct situations, saw: {string.Join(", ", situations)}");

            var labStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.LabTopic);
            var deployedStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.DeployedTopic);
            Assert.True(labStream.Count == 0, "expected ZERO science.lab frames — this recording never carries a lab, so the channel is never 'born' (see ChannelEngine's _born doc comment) and should stay silent, not tombstone");
            Assert.True(deployedStream.Count == 0, "expected ZERO science.deployed frames — this recording never carries a deployed experiment, so the channel is never 'born' and should stay silent, not tombstone");

            _output.WriteLine(
                $"science fixture: {experimentsStream.Count} science.experiments frames, {experimentEntries.Count} experiment entries, " +
                $"situations {{{string.Join(",", situations)}}}; science.lab {labStream.Count} frames; " +
                $"science.deployed {deployedStream.Count} frames — both zero (never captured this session, channel never born) as expected.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesLabWireFixtureFromLabRecording()
        {
            const string recordingFileName = "reference-lab-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-lab.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            // Sibling to GeneratesScienceWireFixtureFromScienceRecording above,
            // but replaying a session where a Mobile Processing Lab IS
            // onboard — OPERATIONAL and crewed (2 scientists) but IDLE (no
            // data loaded, dataStored/scienceRate both 0). Subscribes
            // science.lab + science.experiments (not deployed — this
            // recording carries no Breaking Ground ground experiment).
            var topics = new[]
            {
                ScienceViewProvider.LabTopic,
                ScienceViewProvider.ExperimentsTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestScienceExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            // ScienceViewProvider.BuildLab's payload IS the entry list itself
            // (see BuildList), not a wrapping dict — parse the raw
            // StreamData payloads rather than ParsePayloads' IDictionary-only
            // filter, same as the science.experiments/parts.robotics channels
            // above.
            var labStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.LabTopic);
            Assert.True(labStream.Count > 0, "expected at least one science.lab frame");

            var labEntries = labStream
                .SelectMany(sd => (sd.Payload as IEnumerable<object?>) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .ToList();
            // JsonReader (see its own doc comment) always parses numbers to
            // double regardless of the writer-side C# type — scientistCount
            // (int on the wire-build side) and dataStorage both come back as
            // double after the real wire round-trip, same as every other
            // numeric assertion in this file (career funds, dock forwardDot).
            Assert.Contains(labEntries, l =>
                (l.TryGetValue("isOperational", out var op) && op is bool opb && opb) &&
                (l.TryGetValue("scientistCount", out var sc) && sc is double scD && scD == 2) &&
                (l.TryGetValue("dataStorage", out var ds) && ds is double dsD && dsD == 750));

            var experimentsStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.ExperimentsTopic);

            _output.WriteLine(
                $"lab fixture: {labStream.Count} science.lab frames, {labEntries.Count} lab entries " +
                $"(operational/2 scientists/750 storage confirmed); {experimentsStream.Count} science.experiments frames.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        /// <summary>
        /// REAL-SHAPE SYNTHETIC fixture for the M3 science-domain finale
        /// (DeployedScience). Sibling to
        /// <see cref="GeneratesSyntheticCareerDetailWireFixtureFromHandAuthoredRealShapeSnapshot"/>
        /// above — same rationale, different domain: the deployed-science
        /// global-capture fix (<c>.superpowers/sdd/deployed-science-fix-report.md</c>,
        /// <c>Gonogo.KSP.KspHost.BuildDeployedScience</c>) landed and
        /// redeployed, but no recording carries deployed-science data yet
        /// (the user hasn't re-captured with a Breaking Ground cluster
        /// standing). Rather than block the DeployedScience migration on
        /// that re-capture, this test hand-authors a synthetic "science"
        /// RAW snapshot dict carrying a "deployed" sub-group that matches
        /// <see cref="ScienceViewProvider"/>'s own documented raw encoding
        /// EXACTLY (see its doc comment / <c>Gonogo.KSP.KspHost.
        /// BuildDeployedScience</c>'s doc comment for the authoritative
        /// field list) and replays it through the REAL
        /// <see cref="ScienceViewProvider.BuildDeployed"/> mapper via the
        /// same <see cref="ReplayAndCaptureAsync"/> plumbing every other
        /// fixture in this file uses. The resulting WIRE SHAPE is therefore
        /// the provider's genuine mapping output, not a hand-guessed shape —
        /// only the underlying VALUES are synthetic/invented. Real-recording
        /// validation is deferred to the user's next Space Center capture
        /// with a deployed Breaking Ground cluster in physics range; see
        /// <c>.superpowers/sdd/m3-deployedscience-report.md</c>.
        /// </summary>
        [Fact]
        public async Task GeneratesSyntheticDeployedScienceWireFixtureFromHandAuthoredRealShapeSnapshot()
        {
            const string fixtureFileName = "reference-wire-fixture-deployed-synthetic.json";
            var session = BuildSyntheticDeployedScienceSession();
            var topics = new[] { ScienceViewProvider.DeployedTopic };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestScienceExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            // ScienceViewProvider.BuildDeployed's payload IS the entry list
            // itself (see BuildList), not a wrapping dict — parse the raw
            // StreamData payloads, same as every other science.* channel in
            // this file.
            var deployedStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.DeployedTopic);
            Assert.True(deployedStream.Count > 0, "expected at least one science.deployed frame");

            var deployedEntries = deployedStream
                .SelectMany(sd => (sd.Payload as IEnumerable<object?>) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .ToList();
            // Two identical-content snapshot entries (T=0/T=15, see
            // BuildSyntheticDeployedScienceSession) each independently
            // re-emit the 3-entry list as its own keyframe (EmissionQuantum.
            // Absolute(0) — same behavior every other synthetic fixture in
            // this file exhibits), so 3 authored entries land as 6 captured
            // entries across the two frames.
            Assert.Equal(6, deployedEntries.Count);

            // Two distinct deployed-cluster vessels, neither the active
            // vessel — the exact regression shape ScienceViewProviderTests'
            // BuildDeployedMapsGroundExperimentsFromSeparateNonActiveVessels
            // guards at the C# unit level, now proven over the real wire.
            var vesselNames = deployedEntries
                .Select(e => e.TryGetValue("vesselName", out var v) ? v as string : null)
                .Where(v => !string.IsNullOrEmpty(v))
                .Distinct()
                .ToList();
            Assert.Equal(2, vesselNames.Count);

            // One experiment still transmitting (completed but not yet 100%).
            Assert.Contains(deployedEntries, e =>
                e.TryGetValue("scienceCompletedPercentage", out var comp) && comp is double compD && compD > 0 && compD < 100 &&
                e.TryGetValue("scienceTransmittedPercentage", out var trans) && trans is double transD && transD > 0 && transD < 100);

            // One experiment fully complete and fully transmitted.
            Assert.Contains(deployedEntries, e =>
                e.TryGetValue("scienceCompletedPercentage", out var comp) && comp is double compD && compD == 100 &&
                e.TryGetValue("scienceTransmittedPercentage", out var trans) && trans is double transD && transD == 100);

            // Varied power/connection states — at least one fully powered +
            // connected, at least one unpowered + disconnected.
            Assert.Contains(deployedEntries, e =>
                (e.TryGetValue("powerState", out var ps) ? ps as string : null) == "Powered" &&
                (e.TryGetValue("connectionState", out var cs) ? cs as string : null) == "Connected");
            Assert.Contains(deployedEntries, e =>
                (e.TryGetValue("powerState", out var ps) ? ps as string : null) == "NoPower" &&
                (e.TryGetValue("connectionState", out var cs) ? cs as string : null) == "NotConnected");

            // Every entry carries the full documented field set.
            foreach (var entry in deployedEntries)
            {
                Assert.False(string.IsNullOrEmpty(entry.TryGetValue("vesselName", out var vn) ? vn as string : null));
                Assert.False(string.IsNullOrEmpty(entry.TryGetValue("partName", out var pn) ? pn as string : null));
                Assert.False(string.IsNullOrEmpty(entry.TryGetValue("body", out var b) ? b as string : null));
                Assert.False(string.IsNullOrEmpty(entry.TryGetValue("situation", out var sit) ? sit as string : null));
                Assert.False(string.IsNullOrEmpty(entry.TryGetValue("biome", out var bi) ? bi as string : null));
                Assert.False(string.IsNullOrEmpty(entry.TryGetValue("experimentId", out var eid) ? eid as string : null));
                Assert.True(entry.TryGetValue("scienceValue", out var sv) && sv is double);
                Assert.True(entry.TryGetValue("scienceLimit", out var sl) && sl is double);
                Assert.True(entry.TryGetValue("deployedOnGround", out var dog) && dog is bool);
            }

            _output.WriteLine(
                $"synthetic deployed-science fixture: {deployedStream.Count} science.deployed frames, " +
                $"{deployedEntries.Count} deployed entries across {vesselNames.Count} distinct vessels " +
                "(real-shape synthetic — values hand-authored, wire shape produced by the real ScienceViewProvider mapper).");
            WriteFixture(fixtureFileName, "(hand-authored synthetic snapshot — no source recording file)", session.Entries.Count, topics, capture);
        }

        /// <summary>
        /// Builds the hand-authored synthetic <see cref="RecordedSession"/>
        /// backing <see cref="GeneratesSyntheticDeployedScienceWireFixtureFromHandAuthoredRealShapeSnapshot"/>.
        /// Two identical-content snapshot entries (T=0 and T=15) so the
        /// fixture carries more than one captured frame, same shape every
        /// other generator in this file produces. Three deployed
        /// experiments across TWO non-active ground-cluster vessels — the
        /// raw "science"/"deployed" list mirrors EXACTLY the shape
        /// <see cref="ScienceViewProvider"/>'s own doc comment documents
        /// <c>Gonogo.KSP.KspHost.BuildDeployedScience</c> must populate.
        /// </summary>
        private static RecordedSession BuildSyntheticDeployedScienceSession()
        {
            var entries = new List<RecordedEntry>();
            foreach (var t in new[] { 0.0, 15.0 })
            {
                entries.Add(new RecordedEntry
                {
                    T = t,
                    Kind = "snapshot",
                    WallClockUtc = DateTime.UtcNow,
                    Seq = entries.Count,
                    Snapshot = new RecordedSnapshotPayload
                    {
                        // BuildScience rebuilds fresh Dictionary trees per
                        // Sample() call in the real host — a NEW raw dict
                        // per entry keeps that same "no shared mutable state
                        // across ticks" shape, even though content is
                        // identical.
                        Values = new Dictionary<string, object?>
                        {
                            ["science"] = new Dictionary<string, object?>
                            {
                                ["deployed"] = BuildSyntheticDeployedScienceRaw(),
                            },
                        },
                    },
                });
            }

            return new RecordedSession
            {
                SchemaVersion = RecordedSessionCodec.CurrentSchemaVersion,
                StartUt = 0.0,
                Entries = entries,
            };
        }

        private static List<object?> BuildSyntheticDeployedScienceRaw()
        {
            return new List<object?>
            {
                // Mun cluster, experiment 1 — still transmitting (completed
                // past halfway, transmitted percentage lags completion, the
                // normal in-progress relay state).
                new Dictionary<string, object?>
                {
                    ["vesselName"] = "Mun Surface Science Base",
                    ["partName"] = "Atmospheric Fluid Spectro-Variometer",
                    ["body"] = "Mun",
                    ["situation"] = "LANDED",
                    ["biome"] = "Highlands",
                    ["experimentId"] = "surfaceExperimentAtmosphericFluidSpectroVariometer",
                    ["scienceCompletedPercentage"] = 62.5,
                    ["scienceTransmittedPercentage"] = 30.0,
                    ["scienceValue"] = 18.75,
                    ["scienceLimit"] = 30.0,
                    ["powerState"] = "Powered",
                    ["connectionState"] = "Connected",
                    ["deployedOnGround"] = true,
                },
                // Mun cluster, experiment 2 — fully complete and fully
                // transmitted (the "done" state).
                new Dictionary<string, object?>
                {
                    ["vesselName"] = "Mun Surface Science Base",
                    ["partName"] = "Seismic Accelerometer",
                    ["body"] = "Mun",
                    ["situation"] = "LANDED",
                    ["biome"] = "Highlands",
                    ["experimentId"] = "surfaceExperimentSeismicAccelerometer",
                    ["scienceCompletedPercentage"] = 100.0,
                    ["scienceTransmittedPercentage"] = 100.0,
                    ["scienceValue"] = 30.0,
                    ["scienceLimit"] = 30.0,
                    ["powerState"] = "Powered",
                    ["connectionState"] = "Connected",
                    ["deployedOnGround"] = true,
                },
                // Minmus cluster — a separate vessel entirely, unpowered and
                // disconnected (a brownout/no-relay-in-view state).
                new Dictionary<string, object?>
                {
                    ["vesselName"] = "Minmus Flats Outpost",
                    ["partName"] = "Barometer",
                    ["body"] = "Minmus",
                    ["situation"] = "LANDED",
                    ["biome"] = "Flats",
                    ["experimentId"] = "surfaceExperimentBarometer",
                    ["scienceCompletedPercentage"] = 15.0,
                    ["scienceTransmittedPercentage"] = 0.0,
                    ["scienceValue"] = 4.5,
                    ["scienceLimit"] = 30.0,
                    ["powerState"] = "NoPower",
                    ["connectionState"] = "NotConnected",
                    ["deployedOnGround"] = true,
                },
            };
        }

        [Fact]
        public async Task GeneratesPartsWireFixtureFromPartsRecording()
        {
            const string recordingFileName = "reference-science-parts-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-parts.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[]
            {
                PartsViewProvider.PowerTopic,
                PartsViewProvider.RoboticsTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepUplink[] { new TestPartsExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var powerFrames = ParsePayloads(capture.Frames, PartsViewProvider.PowerTopic);
            Assert.True(powerFrames.Count > 0, "expected at least one parts.power frame");
            Assert.Contains(powerFrames, p => p.TryGetValue("totalProductionEc", out var tp) && tp is double);
            Assert.Contains(powerFrames, p =>
                p.TryGetValue("solarPanels", out var raw) &&
                raw is IEnumerable<object?> panels &&
                panels.OfType<IDictionary<string, object?>>().Any(sp => !string.IsNullOrEmpty(sp.TryGetValue("partName", out var pn) ? pn as string : null)));

            // parts.robotics's own payload IS the list (see PartsViewProvider.BuildRobotics
            // — it returns List<object?> directly, not a wrapping dict), so
            // ParsePayloads' IDictionary-only filter would yield nothing
            // useful for this channel; parse the raw StreamData payloads
            // instead.
            var roboticsStream = ParseStreamFrames(capture.Frames, PartsViewProvider.RoboticsTopic);
            Assert.True(roboticsStream.Count > 0, "expected at least one parts.robotics frame");
            var roboticsEntries = roboticsStream
                .SelectMany(sd => (sd.Payload as IEnumerable<object?>) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .ToList();
            Assert.Contains(roboticsEntries, r => (r.TryGetValue("type", out var t) ? t as string : null) == "hinge");
            var rotorPresent = roboticsEntries.Any(r => (r.TryGetValue("type", out var t) ? t as string : null) == "rotor");

            _output.WriteLine(
                $"parts fixture: {powerFrames.Count} parts.power frames, {roboticsStream.Count} parts.robotics frames, " +
                $"{roboticsEntries.Count} servo entries; rotor present: {rotorPresent}.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        // ----------------------------------------------------------------
        // Shared replay/capture/fixture-writing plumbing
        // ----------------------------------------------------------------

        private sealed record CaptureResult(List<string> Frames, HashSet<int> Epochs, int RewindCount);

        /// <summary>
        /// Same replay-and-capture idiom as
        /// <see cref="WireFixtureGeneratorTests.GeneratesReferenceWireFixtureFromRealRecordingForSdkValidation"/>,
        /// factored out so each of this class's four fixture tests doesn't
        /// hand-copy the ~80-line engine/client/reader/drive plumbing.
        /// </summary>
        private async Task<CaptureResult> ReplayAndCaptureAsync(
            RecordedSession session,
            IEnumerable<ISitrepUplink> uplinks,
            string[] topics)
        {
            var topicSet = new HashSet<string>(topics);
            var frames = new List<string>();
            var epochsSeen = new HashSet<int>();
            var rewindCount = 0;

            using var server = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0.0);
            foreach (var uplink in uplinks)
            {
                server.RegisterUplink(uplink);
            }
            server.Start();

            try
            {
                var replay = new ReplayKspHost(session);
                var lifecycleEvents = new List<KspLifecycleEvent>();
                replay.Lifecycle += lifecycleEvents.Add;

                await using var client = await TestClient.ConnectAsync(server.BoundPort, TickTimeout);
                foreach (var topic in topics)
                {
                    await SubscribeAsync(client, topic, TickTimeout);
                }

                using var readerCts = new CancellationTokenSource();
                var reader = Task.Run(async () =>
                {
                    while (!readerCts.IsCancellationRequested)
                    {
                        string raw;
                        try
                        {
                            raw = await client.ReceiveAsync(ReaderPollTimeout);
                        }
                        catch (OperationCanceledException)
                        {
                            continue;
                        }

                        object parsed;
                        try
                        {
                            parsed = EnvelopeCodec.ParseServerMessage(raw);
                        }
                        catch (Exception)
                        {
                            continue;
                        }

                        string? frameTopic = parsed switch
                        {
                            StreamData sd => sd.Topic,
                            EventMsg evt => evt.Topic,
                            _ => null,
                        };
                        if (frameTopic == null || !topicSet.Contains(frameTopic))
                        {
                            continue;
                        }

                        int epoch = parsed switch
                        {
                            StreamData sd => sd.Meta.TimelineEpoch,
                            EventMsg evt => evt.Meta.TimelineEpoch,
                            _ => 0,
                        };
                        epochsSeen.Add(epoch);
                        frames.Add(raw);
                    }
                });

                double? lastTickUt = null;
                while (true)
                {
                    var lifecycleCountBefore = lifecycleEvents.Count;
                    if (!replay.Step())
                    {
                        break;
                    }

                    if (lifecycleEvents.Count > lifecycleCountBefore)
                    {
                        continue;
                    }

                    var ut = replay.NowUt();
                    if (lastTickUt.HasValue && ut < lastTickUt.Value)
                    {
                        rewindCount++;
                    }
                    lastTickUt = ut;

                    server.TickAndWait(ut, replay.Sample(), TickTimeout);
                }

                await Task.Delay(FinalDrainDelay);
                readerCts.Cancel();
                try
                {
                    await reader;
                }
                catch (Exception)
                {
                    // best-effort drain only
                }
            }
            finally
            {
                server.Stop();
            }

            return new CaptureResult(frames, epochsSeen, rewindCount);
        }

        /// <summary>Parses every captured frame for <paramref name="topic"/>, returning only the non-null <c>StreamData</c> payload dictionaries — the common case for "does this domain's data actually look right" assertions.</summary>
        private static List<IDictionary<string, object?>> ParsePayloads(IEnumerable<string> frames, string topic)
        {
            var result = new List<IDictionary<string, object?>>();
            foreach (var raw in frames)
            {
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData sd && sd.Topic == topic && sd.Payload is IDictionary<string, object?> payload)
                {
                    result.Add(payload);
                }
            }
            return result;
        }

        /// <summary>Parses every captured frame for <paramref name="topic"/> into its raw <c>StreamData</c>, INCLUDING null-payload (tombstone) frames — needed for the comms present/absent transition assertion, where a null payload is itself meaningful.</summary>
        private static List<StreamData> ParseStreamFrames(IEnumerable<string> frames, string topic)
        {
            var result = new List<StreamData>();
            foreach (var raw in frames)
            {
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData sd && sd.Topic == topic)
                {
                    result.Add(sd);
                }
            }
            return result;
        }

        /// <summary>Serialization shape mirrors <see cref="WireFixtureGeneratorTests"/>'s private <c>WireFixture</c> — duplicated (not shared) so this file never needs to touch that class.</summary>
        private sealed class WireFixture
        {
            public string GeneratedAtUtc { get; set; } = "";
            public string RecordingFile { get; set; } = "";
            public int RecordingEntries { get; set; }
            public double NetworkDelaySeconds { get; set; }
            public string[] SubscribedTopics { get; set; } = Array.Empty<string>();
            public int FrameCount { get; set; }
            public int[] EpochsSeen { get; set; } = Array.Empty<int>();
            public string[] Frames { get; set; } = Array.Empty<string>();
        }

        private void WriteFixture(string fixtureFileName, string recordingFileName, int recordingEntries, string[] topics, CaptureResult capture)
        {
            var fixture = new WireFixture
            {
                GeneratedAtUtc = DateTime.UtcNow.ToString("o"),
                RecordingFile = recordingFileName,
                RecordingEntries = recordingEntries,
                NetworkDelaySeconds = 0.0,
                SubscribedTopics = topics,
                FrameCount = capture.Frames.Count,
                EpochsSeen = capture.Epochs.OrderBy(e => e).ToArray(),
                Frames = capture.Frames.ToArray(),
            };

            var outputPath = Path.Combine(RecordingsDir(), fixtureFileName);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            var fixtureJson = JsonSerializer.Serialize(
                fixture,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            // BOM-less UTF-8, same rationale as WireFixtureGeneratorTests: the
            // TS-side fixture tests read this straight through JSON.parse,
            // which does not strip a leading BOM.
            File.WriteAllText(outputPath, fixtureJson, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

            _output.WriteLine(
                $"Wrote wire fixture to \"{outputPath}\": {capture.Frames.Count} frames across topics " +
                $"{string.Join(", ", topics)}; epochs {{{string.Join(",", fixture.EpochsSeen)}}}; " +
                $"{capture.RewindCount} rewinds detected.");
        }
    }
}
