using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The census of EXCLUSIVE capabilities, and the guard that every one an Uplink
    /// can win has a behavioural case proving it is not starved.
    ///
    /// <para><b>What starvation is.</b>
    /// <c>IUplinkHost.AddSampledSource</c>'s subscription-gated overload skips its
    /// main-thread capture entirely on any tick where nothing under its declared
    /// topic prefixes is subscribed. That is a pure early-out only for a capture
    /// whose whole effect is its return value. When a capture also WRITES state
    /// something else reads, and that something else is an exclusive capability's
    /// elected provider, the derived channel is starved: no exception, no log line,
    /// and because the capability is exclusive there is no vanilla answering
    /// underneath either. Three shipped that way. One was found on a rig after
    /// 45 seconds of silence, one published a payload whose absent planner field is
    /// documented to mean "there is no planner", and one told an operator that a
    /// career it was managing was a save it does not manage.</para>
    ///
    /// <para><b>Everything here is DISCOVERED, and deliberately names no mod.</b>
    /// Which capabilities are exclusive, which have an Uplink provider, and which
    /// have a behavioural case are all read out of the tree on every run. A written
    /// list would drift, and naming the Uplinks would put specific third-party mods
    /// in a core test project, which <c>uplink-boundary.test.ts</c> forbids for the
    /// good reason that core has no business knowing them. The behavioural cases
    /// live in each Uplink's own Tests project, where the Uplink's sources already
    /// compile and where a red names the Uplink that broke; each one carries the
    /// marker this file counts.</para>
    ///
    /// <para><b>The limit, stated rather than left to be found.</b> A marker is a
    /// claim. This file checks that the claim is made in a file that holds tests,
    /// not that the test behind it asserts anything. What it does catch is the
    /// failure that actually happens: a capability arriving with no case at all, and
    /// a case being deleted or moved out from under one.</para>
    /// </summary>
    public class ExclusiveCapabilityCensusTests
    {
        /// <summary>
        /// The marker a behavioural case carries, followed by the capability id it
        /// covers. Written as a comment beside the case rather than derived from the
        /// file name, so a case can move or be renamed without the census losing
        /// track of what it proves.
        /// </summary>
        private const string Marker = "exclusive-capability-starvation:";

        /// <summary>
        /// One exclusive capability the census knows about.
        /// </summary>
        /// <param name="Id">The capability id, as its declaration site resolves it.</param>
        /// <param name="DeclaredIn">Repo-relative path of the file declaring it exclusive.</param>
        /// <param name="FedByGatedCapture">
        /// Whether the elected provider's answer comes from a subscription-gated
        /// capture. The unsafe shape, and the reason a case for it subscribes ONLY
        /// the derived topic rather than driving a bare tick.
        /// </param>
        /// <param name="Excuse">
        /// Which claim <paramref name="WhyNoBehaviouralCase"/> makes about the walk,
        /// so the walk can check it rather than the prose being searched for a phrase.
        /// </param>
        /// <param name="WhyNoBehaviouralCase">
        /// Why the capability has no case. Never a placeholder: an entry here is a
        /// gap somebody can close, written down so the gap is visible rather than
        /// absent, and asserted STALE once a case appears or the walk stops agreeing
        /// with <paramref name="Excuse"/>.
        /// </param>
        private sealed record Entry(
            string Id,
            string DeclaredIn,
            bool FedByGatedCapture,
            Excuse Excuse = Excuse.None,
            string WhyNoBehaviouralCase = "");

        /// <summary>
        /// The claim an excuse makes, each one checked against the provider walk in
        /// <see cref="StaleExcuses"/>.
        /// </summary>
        private enum Excuse
        {
            /// <summary>No excuse: a capability an Uplink can win needs a marked case.</summary>
            None,

            /// <summary>
            /// No Uplink registers a provider. Stale the moment the walk finds one,
            /// because the reason no longer describes the tree.
            /// </summary>
            NoUplinkProvider,

            /// <summary>
            /// An Uplink registers a provider and no case can be written for it. Stale
            /// the moment the walk finds no Uplink provider, which is what an Uplink
            /// moving out of this repo looks like from here.
            /// </summary>
            UplinkProviderWithoutCase,
        }

        /// <summary>
        /// Every exclusive capability in the tree. Which of them have a provider
        /// registered from an Uplink is discovered by the walk rather than restated.
        /// </summary>
        private static readonly Entry[] Census =
        {
            new Entry("controlFrame", "Sitrep.Host/ControlFrameElection.cs", FedByGatedCapture: true),
            new Entry("maneuverPlan", "Sitrep.Host/Maneuver/ManeuverPlanElection.cs", FedByGatedCapture: true),
            new Entry("propagation", "Sitrep.Host/Propagation/PropagationElection.cs", FedByGatedCapture: false),
            new Entry("gravityModel", "Sitrep.Host/Propagation/GravityModelElection.cs", FedByGatedCapture: false),
            new Entry("economy", "Sitrep.Host/Economy/EconomyElection.cs", FedByGatedCapture: false),
            new Entry("actionGroups", "Sitrep.Host/ActionGroups/ActionGroupsElection.cs", FedByGatedCapture: false),
            new Entry("crewStanding", "Sitrep.Host/Crew/CrewStandingElection.cs", FedByGatedCapture: false),
            new Entry(
                "craftCatalogue",
                "Gonogo.KSP/SpaceCenterUplink.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink registers a provider: core ships the only one, as "
                    + "the capability's Vanilla, because a craft folder is a fact about the save's "
                    + "directory rather than a model a mod could hold a rival opinion about. It is "
                    + "a capability at all only because that is the one route an Uplink has into "
                    + "core, and opening a craft file instantiates Unity parts an Uplink may not "
                    + "name. No capture feeds it either: its answer is a folder walk made at the "
                    + "moment it is asked, so there is no gated path that could starve it, and its "
                    + "consumers treat an absent catalogue as data (GonogoRp1Uplink.Tests covers "
                    + "both, as a refusal and as a control dark with its reason)."),
            new Entry(
                "simulation",
                "Sitrep.Host/Comms/SimulationElection.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink in this repo registers a provider any more: the "
                    + "one that did has moved to the gonogo-uplinks repo, which is what this "
                    + "walk is meant to notice and did. Core ships the only provider, as the "
                    + "capability's Vanilla. Nothing about the shape changed with it: the "
                    + "flight.simulation CHANNEL is subscription-gated and safe to be, because "
                    + "its source's whole effect is its return value and the delay cut it "
                    + "reports rides a config read every tick regardless of who watches. An "
                    + "Uplink provider appearing for it again makes this line stale and fails."),
            new Entry(
                "delayedScience",
                "Gonogo.KSP/CurrencyEventUplink.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink registers a provider, so no Uplink "
                    + "capture is on its path. Discovered, not assumed: an Uplink "
                    + "provider appearing for it makes this line stale and fails."),
            new Entry(
                "science",
                "Sitrep.Host/Science/ScienceElection.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink in this repo registers a provider, so "
                    + "StockScienceBackend, the capability's Vanilla, is the only one. "
                    + "No capture feeds it: ScienceCoreUplink asks the elected backend "
                    + "to map each tick's shared snapshot from courier channel sources, "
                    + "so there is no gated path that could starve it. An Uplink "
                    + "registering a provider makes this line stale and fails."),
            new Entry(
                "isru",
                "Sitrep.Host/Isru/IsruElection.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink in this repo registers a provider, so "
                    + "the stock backend, the capability's Vanilla, is the only one. It is "
                    + "constructed fresh per election and reads live, and IsruCoreUplink "
                    + "calls it from its own capture gated on the two isru topics that "
                    + "display it, so the gate and the demand are one subscription. An "
                    + "Uplink registering a provider makes this line stale and fails."),
            new Entry(
                "reliability",
                "Sitrep.Host/Reliability/ReliabilityElection.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink in this repo registers a provider, so "
                    + "NoneReliabilityBackend, the capability's Vanilla, is the only one "
                    + "and answers Unmodeled. ReliabilityCoreUplink reads the elected "
                    + "backend from its own capture gated on the two reliability topics "
                    + "that display it, the same shape as isru. An Uplink registering a "
                    + "provider makes this line stale and fails."),
            new Entry(
                "comms",
                "Sitrep.Host/Comms/CommsElection.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink in this repo registers a provider, so "
                    + "stock CommNet is the only one and it is the capability's own "
                    + "Vanilla. There is nothing for an election to choose between, and "
                    + "no gated path that could starve it: the provider is constructed "
                    + "fresh per election and reads live, and the delay and connectivity "
                    + "sources installed beside it are deliberately UNGATED. An Uplink "
                    + "registering a rival provider makes this line stale and fails."),
            new Entry("homeCommand", "Sitrep.Host/CommandCentres/HomeCommandElection.cs", FedByGatedCapture: false),
            new Entry(
                "activeVessel",
                "Gonogo.KSP/VesselUplink.cs",
                FedByGatedCapture: false,
                Excuse: Excuse.NoUplinkProvider,
                WhyNoBehaviouralCase: "No Uplink registers a provider, and none can: "
                    + "which craft the stream is scoped to is a decision core makes "
                    + "and publishes, not a model a mod could hold a rival opinion "
                    + "about. It is a capability only because that is the one route "
                    + "an Uplink has into core, the same shape and the same reason as "
                    + "craftCatalogue above. No capture feeds it either: the provider "
                    + "holds no state and answers by reading the seam at the moment it "
                    + "is asked, so there is no gated path that could starve it. Its "
                    + "consumers treat an absent capability as data and are required "
                    + "to answer NO VESSEL rather than fall back to KSP's own active "
                    + "one, which Sitrep.Core.Tests/UplinkActiveVesselScopeTests holds "
                    + "across every Uplink."),
        };

        /// <summary>
        /// A capability declared <c>Exclusive = true</c> somewhere in production,
        /// with the id resolved through whatever constant the declaration names.
        /// </summary>
        private sealed record Declaration(string Id, string File, int Line);

        [Fact]
        public void EveryExclusiveCapabilityDeclaredInProductionIsInTheCensus()
        {
            var censused = Census.Select(e => e.Id).ToHashSet(StringComparer.Ordinal);

            var missing = ExclusiveDeclarations()
                .Where(d => !censused.Contains(d.Id))
                .Select(d => $"{d.Id} ({Relative(d.File)}:{d.Line})")
                .OrderBy(s => s, StringComparer.Ordinal)
                .ToList();

            Assert.True(
                missing.Count == 0,
                "An EXCLUSIVE capability is declared that this census has never been "
                + "told about, so nothing anywhere asks whether it can be starved by a "
                + "gated capture. Add it to Census, and give it a behavioural case in "
                + "its Uplink's Tests project carrying the '" + Marker + " <id>' marker, "
                + "or say why there is none:\n  "
                + string.Join("\n  ", missing));
        }

        [Fact]
        public void EveryCensusEntryStillNamesADeclarationThatExists()
        {
            var declared = ExclusiveDeclarations().ToDictionary(d => d.Id, StringComparer.Ordinal);

            var stale = Census
                .Where(e => !declared.ContainsKey(e.Id))
                .Select(e => $"{e.Id} (census says {e.DeclaredIn})")
                .ToList();

            Assert.True(
                stale.Count == 0,
                "A census entry names a capability nothing declares Exclusive any more. "
                + "A census carrying entries nobody re-derives stops describing the "
                + "tree, so remove it or fix the id:\n  " + string.Join("\n  ", stale));

            var moved = Census
                .Where(e => declared.ContainsKey(e.Id)
                    && !Relative(declared[e.Id].File).Equals(e.DeclaredIn, StringComparison.Ordinal))
                .Select(e => $"{e.Id}: census says {e.DeclaredIn}, found at {Relative(declared[e.Id].File)}")
                .ToList();

            Assert.True(
                moved.Count == 0,
                "A capability is declared somewhere other than where the census says. "
                + "Point the entry at the new file:\n  " + string.Join("\n  ", moved));
        }

        /// <summary>
        /// The guard itself: a capability an Uplink can win must have a behavioural
        /// case, or the census must say why not.
        /// </summary>
        [Fact]
        public void EveryCapabilityAnUplinkCanWinIsEitherProvenOrSaysWhyNot()
        {
            var winnable = UplinkProvidedCapabilities();
            var covered = MarkedCapabilities();
            var problems = new List<string>();

            foreach (var entry in Census.Where(e => winnable.Contains(e.Id)))
            {
                if (covered.Contains(entry.Id) || entry.Excuse == Excuse.UplinkProviderWithoutCase)
                {
                    continue;
                }

                problems.Add(
                    $"{entry.Id}: an Uplink registers a provider for it and no "
                    + "behavioural case claims it. Drive ticks with only its derived "
                    + "topic subscribed, assert the election answers, and mark the case "
                    + $"'{Marker} {entry.Id}'");
            }

            Assert.True(
                problems.Count == 0,
                "An exclusive capability an Uplink can win is unproven:\n  "
                + string.Join("\n  ", problems));
        }

        /// <summary>
        /// The other direction, so an excuse cannot outlive the thing it excused. A
        /// reason kept beside a case that now exists is a reason nobody reads.
        /// </summary>
        [Fact]
        public void NoCensusEntryExcusesACapabilityThatIsActuallyProven()
        {
            var stale = StaleExcuses(Census, UplinkProvidedCapabilities(), MarkedCapabilities());

            Assert.True(
                stale.Count == 0,
                "A census excuse no longer describes the tree. Rewrite or delete each one:\n  "
                + string.Join("\n  ", stale));
        }

        /// <summary>
        /// <see cref="StaleExcuses"/> over planted entries and a planted walk, so an
        /// Uplink leaving the repo is proved to fail by name here rather than on the
        /// day it moves, and the check cannot pass by comparing against nothing.
        /// </summary>
        [Fact]
        public void AnExcuseTheWalkNoLongerSupportsIsNamedAsStale()
        {
            var planted = new[]
            {
                new Entry("plantedDeparted", "", false, Excuse.UplinkProviderWithoutCase, "its provider cannot be driven from a Tests project"),
                new Entry("plantedArrived", "", false, Excuse.NoUplinkProvider, "nothing outside core provides it"),
                new Entry("plantedProven", "", false, Excuse.UplinkProviderWithoutCase, "its provider cannot be driven from a Tests project"),
                new Entry("plantedUnexplained", "", false, Excuse.UplinkProviderWithoutCase),
                new Entry("plantedStillExcused", "", false, Excuse.UplinkProviderWithoutCase, "its provider cannot be driven from a Tests project"),
                new Entry("plantedStillUnprovided", "", false, Excuse.NoUplinkProvider, "nothing outside core provides it"),
                new Entry("plantedUnexcused", "", false),
            };
            var winnable = new HashSet<string>(StringComparer.Ordinal)
            {
                "plantedArrived", "plantedProven", "plantedUnexplained", "plantedStillExcused", "plantedUnexcused",
            };
            var covered = new HashSet<string>(StringComparer.Ordinal) { "plantedProven" };

            var named = StaleExcuses(planted, winnable, covered)
                .Select(line => line.Substring(0, line.IndexOf(':')))
                .ToList();

            Assert.Equal(
                new[] { "plantedDeparted", "plantedArrived", "plantedProven", "plantedUnexplained" },
                named);
        }

        /// <summary>
        /// Every excuse the walk contradicts, one line each, led by the capability id.
        ///
        /// <para>Checked in both directions. An excuse for a provider no case can
        /// reach is stale once no Uplink provides the capability, which is how an
        /// Uplink leaving for its own repo shows up here; an excuse that no Uplink
        /// provides is stale once one does. Either way the reason describes a tree
        /// that has gone.</para>
        /// </summary>
        private static List<string> StaleExcuses(
            IEnumerable<Entry> census, ISet<string> winnable, ISet<string> covered)
        {
            var stale = new List<string>();
            foreach (var entry in census)
            {
                var explained = entry.WhyNoBehaviouralCase.Length > 0;
                if (entry.Excuse == Excuse.None)
                {
                    if (explained)
                    {
                        stale.Add($"{entry.Id}: carries a reason and no Excuse kind, so the walk cannot check it. Name the claim it makes");
                    }

                    continue;
                }

                if (!explained)
                {
                    stale.Add($"{entry.Id}: excused as {entry.Excuse} with no reason written down. Say why, or drop the excuse");
                }
                else if (covered.Contains(entry.Id))
                {
                    stale.Add($"{entry.Id}: excused as {entry.Excuse}, and a behavioural case now carries its marker. Delete the excuse");
                }
                else if (entry.Excuse == Excuse.NoUplinkProvider && winnable.Contains(entry.Id))
                {
                    stale.Add($"{entry.Id}: excused because no Uplink registers a provider, and the walk finds one. "
                        + $"Give it a case marked '{Marker} {entry.Id}', or say why it cannot have one");
                }
                else if (entry.Excuse == Excuse.UplinkProviderWithoutCase && !winnable.Contains(entry.Id))
                {
                    stale.Add($"{entry.Id}: excused for an Uplink's provider, and the walk finds no Uplink providing it. "
                        + "The Uplink has left or stopped providing it: rewrite the excuse as NoUplinkProvider, or delete it");
                }
            }

            return stale;
        }

        /// <summary>
        /// The scan asserts it found its subjects.
        ///
        /// <para>A source-walking gate whose walk returns nothing reports no
        /// violations, and no violations reads exactly like success. This repo has
        /// been bitten by that shape more than once, so all three discoveries are
        /// pinned separately: the exclusive set, the Uplink-provided set, and the
        /// marker set. If the layout moves, this fails FIRST and says so, rather than
        /// the guard above passing over an empty set.</para>
        /// </summary>
        [Fact]
        public void TheScansFoundTheirSubjects()
        {
            var declared = ExclusiveDeclarations();
            Assert.True(
                declared.Count >= 11,
                "The scan found " + declared.Count + " exclusive capability "
                + "declarations. Eleven were there on 2026-08-26 and capabilities are "
                + "not removed lightly, so fewer means the walk is no longer reaching "
                + "the declaration sites.");

            var ids = declared.Select(d => d.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var known in new[] { "controlFrame", "maneuverPlan", "comms", "delayedScience" })
            {
                Assert.True(
                    ids.Contains(known),
                    "The scan did not find the '" + known + "' capability, which is "
                    + "declared in production. The walk or the id resolver is broken.");
            }

            AssertProviderAndMarkerScansSeeTheirSubjects();
        }

        /// <summary>
        /// The provider and marker scans, proved without counting what they find.
        ///
        /// <para>These were floors of ten providers and six markers, and every one
        /// of those lives in an Uplink or its Tests project bound for the
        /// gonogo-uplinks repo, so both counts are heading for zero and a floor
        /// could not tell that from a scan that stopped reading its sites. Two
        /// halves replace them. Over a planted tree each scan returns exactly the
        /// planted ids, and nothing from the decoys beside them (a Tests project
        /// and a contract slice registering a provider, a marker in a file with no
        /// test, a marker outside a Tests project). Over the real tree the
        /// directories each scan walks are exactly the matching projects
        /// <c>Gonogo.sln</c> declares, in both directions, which holds at any
        /// number of Uplinks including none.</para>
        /// </summary>
        private static void AssertProviderAndMarkerScansSeeTheirSubjects()
        {
            var root = Path.Combine(Path.GetTempPath(), "census-plant-" + Guid.NewGuid().ToString("N"));
            try
            {
                const string registration = "    Capability = {0},\n";
                WritePlanted(root, "GonogoPlantedUplink", "GonogoPlantedUplink.csproj", "<Project />");
                WritePlanted(root, "GonogoPlantedUplink", "PlantedProviders.cs",
                    "class PlantedProviders\n{\n    private const string Aliased = \"plantedAliased\";\n"
                    + string.Format(registration, "\"plantedLiteral\"")
                    + string.Format(registration, "Aliased")
                    + "}\n");
                WritePlanted(root, "GonogoPlantedUplink.Contract", "GonogoPlantedUplink.Contract.csproj", "<Project />");
                WritePlanted(root, "GonogoPlantedUplink.Contract", "Decoy.cs", string.Format(registration, "\"plantedContractDecoy\""));
                WritePlanted(root, "GonogoPlantedUplink.Tests", "GonogoPlantedUplink.Tests.csproj", "<Project />");
                WritePlanted(root, "GonogoPlantedUplink.Tests", "Decoy.cs", string.Format(registration, "\"plantedTestsDecoy\""));
                WritePlanted(root, "GonogoPlantedUplink.Tests", "Case.cs",
                    "class Case\n{\n    // " + Marker + " plantedLiteral\n    [Fact]\n    public void Starves() { }\n}\n");
                WritePlanted(root, "GonogoPlantedUplink.Tests", "NoFact.cs", "// " + Marker + " plantedNoFact\n");
                WritePlanted(root, "GonogoPlantedUplink", "Stray.cs", "// " + Marker + " plantedStray\n    [Fact]\n");

                var providers = UplinkProvidedCapabilities(root).OrderBy(s => s, StringComparer.Ordinal).ToList();
                Assert.True(
                    providers.SequenceEqual(new[] { "plantedAliased", "plantedLiteral" }),
                    "Over the planted tree the provider scan found [" + string.Join(", ", providers) + "], "
                    + "expected exactly [plantedAliased, plantedLiteral]. A scan that is no longer reading "
                    + "the registration sites makes every capability look unwinnable and the guard vacuous.");

                var markers = MarkedCapabilities(root).OrderBy(s => s, StringComparer.Ordinal).ToList();
                Assert.True(
                    markers.SequenceEqual(new[] { "plantedLiteral" }),
                    "Over the planted tree the marker scan found [" + string.Join(", ", markers) + "], "
                    + "expected exactly [plantedLiteral]. A marker scan not reaching the Tests projects makes "
                    + "the coverage guard fail loudly, but for the wrong reason.");
            }
            finally
            {
                Directory.Delete(root, recursive: true);
            }

            var mod = ResolveModDir();
            var solution = File.ReadAllText(Path.Combine(mod, "Gonogo.sln"));
            var declared = Regex.Matches(solution, @"=\s*""([A-Za-z0-9_.]+)""")
                .Select(m => m.Groups[1].Value)
                .ToHashSet(StringComparer.Ordinal);
            Assert.True(
                declared.Contains("Sitrep.Host.IntegrationTests"),
                "Gonogo.sln does not declare Sitrep.Host.IntegrationTests, the project running this check, "
                + "so it is not the solution this repo builds and agreeing with it proves nothing.");

            AssertAgrees(
                "provider scan's Uplink directories",
                UplinkDirectories(mod).Select(Path.GetFileName),
                declared.Where(n => n.StartsWith("Gonogo", StringComparison.Ordinal)
                    && n.EndsWith("Uplink", StringComparison.Ordinal)));

            AssertAgrees(
                "marker scan's Tests directories",
                TestsDirectories(mod).Select(Path.GetFileName),
                declared.Where(n => n.EndsWith(".Tests", StringComparison.Ordinal)));
        }

        private static void AssertAgrees(string what, IEnumerable<string?> walked, IEnumerable<string> declared)
        {
            var onDisk = walked.OfType<string>().ToHashSet(StringComparer.Ordinal);
            var inSolution = declared.ToHashSet(StringComparer.Ordinal);
            Assert.True(
                onDisk.SetEquals(inSolution),
                $"The {what} and Gonogo.sln disagree. Walked but not declared: ["
                + string.Join(", ", onDisk.Except(inSolution).OrderBy(n => n, StringComparer.Ordinal))
                + "]. Declared but not walked: ["
                + string.Join(", ", inSolution.Except(onDisk).OrderBy(n => n, StringComparer.Ordinal))
                + "].");
        }

        private static void WritePlanted(string root, string project, string file, string source)
        {
            var directory = Path.Combine(root, project);
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, file), source);
        }

        /// <summary>
        /// Every <c>Exclusive = true</c> in a production file, with the id resolved.
        ///
        /// <para>Tests are excluded because a test declaring a capability is a
        /// fixture, not a hazard: nothing ships behind it.</para>
        /// </summary>
        private static List<Declaration> ExclusiveDeclarations()
        {
            var mod = ResolveModDir();
            var constants = StringConstants(mod);
            var found = new List<Declaration>();

            foreach (var file in ProductionSources(mod))
            {
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    if (!Regex.IsMatch(lines[i], @"^\s*Exclusive\s*=\s*true\s*,?\s*$"))
                    {
                        continue;
                    }

                    found.Add(new Declaration(
                        ResolveIdAbove(lines, i, file, constants, @"^\s*Id\s*=\s*([^,]+),\s*$"),
                        file,
                        i + 1));
                }
            }

            return found;
        }

        /// <summary>
        /// Every capability an Uplink registers a provider for, read from the
        /// <c>Capability = ...</c> line of each registration inside a
        /// <c>Gonogo*Uplink</c> project.
        ///
        /// <para>Discovered rather than listed for two reasons. A list drifts, and a
        /// list would have to spell the Uplinks' names in a core test project, which
        /// is the coupling <c>uplink-boundary.test.ts</c> exists to stop.</para>
        /// </summary>
        private static HashSet<string> UplinkProvidedCapabilities() => UplinkProvidedCapabilities(ResolveModDir());

        private static HashSet<string> UplinkProvidedCapabilities(string mod)
        {
            var constants = StringConstants(mod);
            var found = new HashSet<string>(StringComparer.Ordinal);
            var registration = new Regex(@"^\s*Capability\s*=\s*([^,]+),\s*$", RegexOptions.Compiled);

            foreach (var directory in UplinkDirectories(mod))
            {
                foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
                {
                    if (IsBuildOutput(file))
                    {
                        continue;
                    }

                    foreach (var line in File.ReadAllLines(file))
                    {
                        var match = registration.Match(line);
                        if (!match.Success)
                        {
                            continue;
                        }

                        var id = Resolve(match.Groups[1].Value.Trim(), file, constants);
                        if (id == null)
                        {
                            throw new InvalidOperationException(
                                $"{file} registers a provider for capability expression "
                                + $"'{match.Groups[1].Value.Trim()}' and the census could "
                                + "not resolve it to a string. It cannot record what it "
                                + "cannot name; teach Resolve the new shape.");
                        }

                        found.Add(id);
                    }
                }
            }

            return found;
        }

        /// <summary>
        /// Every capability claimed by a marker in a Tests project, where the marked
        /// file also holds at least one test.
        /// </summary>
        private static HashSet<string> MarkedCapabilities() => MarkedCapabilities(ResolveModDir());

        private static HashSet<string> MarkedCapabilities(string mod)
        {
            var found = new HashSet<string>(StringComparer.Ordinal);
            var marked = new Regex(
                Regex.Escape(Marker) + @"\s*([A-Za-z0-9_]+)", RegexOptions.Compiled);

            foreach (var directory in TestsDirectories(mod))
            {
                foreach (var file in Directory.EnumerateFiles(directory, "*.cs", SearchOption.AllDirectories))
                {
                    if (IsBuildOutput(file))
                    {
                        continue;
                    }

                    var text = File.ReadAllText(file);
                    if (!text.Contains("[Fact]", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    foreach (Match match in marked.Matches(text))
                    {
                        found.Add(match.Groups[1].Value);
                    }
                }
            }

            return found;
        }

        /// <summary>
        /// The <c>Id = ...</c> nearest above <paramref name="anchorLine"/>, resolved
        /// to the string it names.
        ///
        /// <para>Throws rather than returning a placeholder when it cannot resolve. A
        /// census that quietly recorded "unknown" would compare "unknown" against
        /// itself and pass, which is the failure mode this whole file exists to
        /// stop.</para>
        /// </summary>
        private static string ResolveIdAbove(
            string[] lines,
            int anchorLine,
            string file,
            Dictionary<string, string> constants,
            string pattern)
        {
            for (var i = anchorLine; i >= 0 && i > anchorLine - 12; i--)
            {
                var match = Regex.Match(lines[i], pattern);
                if (!match.Success)
                {
                    continue;
                }

                var expression = match.Groups[1].Value.Trim();
                var resolved = Resolve(expression, file, constants);
                if (resolved != null)
                {
                    return resolved;
                }

                throw new InvalidOperationException(
                    $"{file}:{i + 1} declares an exclusive capability whose id "
                    + $"expression '{expression}' could not be resolved to a string. "
                    + "The census cannot record what it cannot name; teach Resolve the "
                    + "new shape.");
            }

            throw new InvalidOperationException(
                $"{file}:{anchorLine + 1} has Exclusive = true with no Id above it. The "
                + "census cannot record what it cannot name.");
        }

        /// <summary>
        /// A literal, a bare constant in the same file, or a <c>Type.Member</c>
        /// naming a constant elsewhere. Chased through several hops, which is what an
        /// id aliased from a contract constant needs.
        /// </summary>
        private static string? Resolve(
            string expression, string file, Dictionary<string, string> constants)
        {
            for (var hop = 0; hop < 4; hop++)
            {
                var literal = Regex.Match(expression, "^\"([^\"]*)\"$");
                if (literal.Success)
                {
                    return literal.Groups[1].Value;
                }

                var key = expression.Contains('.')
                    ? expression
                    : Path.GetFileNameWithoutExtension(file) + "." + expression;

                if (!constants.TryGetValue(key, out var next))
                {
                    return null;
                }

                expression = next;
            }

            return null;
        }

        /// <summary>
        /// Every <c>const string</c> in production, keyed by enclosing type and by
        /// file name, so <see cref="Resolve"/> can walk an alias chain.
        ///
        /// <para>Keyed twice because a bare <c>CapabilityId</c> in a declaration
        /// names the type its file is named for, while a qualified
        /// <c>SomeCapability.Id</c> names a type sharing a file with others. A type's
        /// constants are read only between its own declaration and the next one, so a
        /// constant is never attributed to a neighbour: an id that cannot be resolved
        /// fails loudly rather than resolving to the wrong string.</para>
        /// </summary>
        private static Dictionary<string, string> StringConstants(string mod)
        {
            var constants = new Dictionary<string, string>(StringComparer.Ordinal);
            var constant = new Regex(
                @"const\s+string\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);", RegexOptions.Compiled);
            var declaration = new Regex(
                @"\b(?:class|struct|record)\s+([A-Za-z0-9_]+)", RegexOptions.Compiled);

            foreach (var file in ProductionSources(mod))
            {
                var text = File.ReadAllText(file);
                var types = declaration.Matches(text);
                for (var t = 0; t < types.Count; t++)
                {
                    var from = types[t].Index;
                    var to = t + 1 < types.Count ? types[t + 1].Index : text.Length;
                    var name = types[t].Groups[1].Value;
                    foreach (Match match in constant.Matches(text.Substring(from, to - from)))
                    {
                        constants[name + "." + match.Groups[1].Value] = match.Groups[2].Value.Trim();
                    }
                }

                var fileType = Path.GetFileNameWithoutExtension(file);
                foreach (Match match in constant.Matches(text))
                {
                    constants[fileType + "." + match.Groups[1].Value] = match.Groups[2].Value.Trim();
                }
            }

            return constants;
        }

        /// <summary>Every <c>Gonogo*Uplink</c> project directory: no Tests, no Contract slice.</summary>
        private static IEnumerable<string> UplinkDirectories(string mod) =>
            Directory.EnumerateDirectories(mod).Where(d =>
            {
                var name = Path.GetFileName(d);
                return name.StartsWith("Gonogo", StringComparison.Ordinal)
                    && name.EndsWith("Uplink", StringComparison.Ordinal)
                    && File.Exists(Path.Combine(d, name + ".csproj"));
            });

        /// <summary>Every <c>*.Tests</c> project directory, where behavioural cases carry their markers.</summary>
        private static IEnumerable<string> TestsDirectories(string mod) =>
            Directory.EnumerateDirectories(mod)
                .Where(d => Path.GetFileName(d).EndsWith(".Tests", StringComparison.Ordinal));

        /// <summary>Every production <c>.cs</c> under <c>mod/</c>: no tests, no build output.</summary>
        private static IEnumerable<string> ProductionSources(string mod) =>
            Directory.EnumerateFiles(mod, "*.cs", SearchOption.AllDirectories)
                .Where(f => !IsBuildOutput(f)
                    && !Relative(f).Contains(".Tests/", StringComparison.Ordinal));

        private static bool IsBuildOutput(string file)
        {
            var relative = Relative(file);
            return relative.Contains("/obj/", StringComparison.Ordinal)
                || relative.Contains("/bin/", StringComparison.Ordinal);
        }

        /// <summary>A path under <c>mod/</c>, forward-slashed, for messages and comparisons.</summary>
        private static string Relative(string file)
        {
            var mod = ResolveModDir();
            return file.StartsWith(mod, StringComparison.Ordinal)
                ? file.Substring(mod.Length).TrimStart('/', '\\').Replace('\\', '/')
                : file.Replace('\\', '/');
        }

        /// <summary>
        /// Walks up from the test assembly to the checked-out <c>mod/</c> directory,
        /// same pattern as <c>Sitrep.Core.Tests.UplinkProjects.ResolveModDir</c>.
        /// </summary>
        private static string ResolveModDir() => LazyModDir.Value;

        /// <summary>Resolved once: every path this file reports goes through it.</summary>
        private static readonly Lazy<string> LazyModDir = new Lazy<string>(FindModDir);

        private static string FindModDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Contract");
                if (Directory.Exists(candidate))
                {
                    return Path.Combine(directory.FullName, "mod");
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/ walking up from " + AppContext.BaseDirectory);
        }
    }
}
