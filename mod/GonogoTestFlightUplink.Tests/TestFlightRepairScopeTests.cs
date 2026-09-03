using System.IO;

using Sitrep.Contract;
using Xunit;

namespace GonogoTestFlightUplink.Tests
{
    /// <summary>
    /// TestFlight HAS a repair feature, and this Uplink used to answer a
    /// hardcoded <c>refused</c> for it, documented as deliberate on the grounds
    /// that TestFlight repairs through in-game surfaces of its own. It has none:
    /// the three shipped assemblies contain no repair button at all, and their
    /// only live repair path is <c>ITestFlightCore.ForceRepair</c>, reachable
    /// through a public static facade nothing else in the install calls.
    /// </summary>
    public class TestFlightRepairScopeTests
    {
        [Theory]
        [InlineData("123:0", true, 123u, 0)]
        [InlineData("123:2", true, 123u, 2)]
        // A single-core part is legitimately published without an occurrence.
        [InlineData("123", true, 123u, 0)]
        [InlineData("", false, 0u, 0)]
        [InlineData("not-a-number:0", false, 0u, 0)]
        // A present but unreadable occurrence is not a first core; guessing one
        // would repair a core the operator did not name.
        [InlineData("123:x", false, 123u, 0)]
        public void APublishedIdSplitsBackIntoTheCoreItNames(
            string partId, bool parsed, uint flightId, int occurrence)
        {
            Assert.Equal(parsed, TestFlightRepairScope.TryParsePartId(partId, out var id, out var n));
            if (parsed)
            {
                Assert.Equal(flightId, id);
                Assert.Equal(occurrence, n);
            }
        }

        /// <summary>
        /// The id this parses is the one <see cref="TestFlightReliabilityMap"/>
        /// mints, checked against the mapper itself rather than against a literal:
        /// a copy of a format agrees with itself forever.
        /// </summary>
        [Fact]
        public void TheParseUndoesTheJoinTheMapperMakes()
        {
            var parts = TestFlightReliabilityMap.Parts(new[]
            {
                new EngineReliabilityRaw { PartId = "4242", Title = "first core", PartStatus = 1 },
                new EngineReliabilityRaw { PartId = "4242", Title = "second core", PartStatus = 1 },
            });

            Assert.True(TestFlightRepairScope.TryParsePartId(parts[1].PartId, out var id, out var n));
            Assert.Equal(4242u, id);
            Assert.Equal(1, n);
        }

        [Theory]
        // No core answered to the id at all.
        [InlineData(false, 0, 0, RepairRefusal.NoSuchPart)]
        // The core is there and nothing is wrong with it.
        [InlineData(true, 0, 0, RepairRefusal.NoSuchPart)]
        // Failures, none of which TestFlight will repair: an exploded part.
        [InlineData(true, 2, 0, RepairRefusal.Unrepairable)]
        [InlineData(true, 2, 1, null)]
        public void ARefusalSaysWhichOfTheThreeThingsWentWrong(
            bool coreFound, int active, int repairable, string? expected)
        {
            Assert.Equal(expected, TestFlightRepairScope.RefusalFor(coreFound, active, repairable));
        }

        /// <summary>
        /// A terminal failure sitting beside a repairable one must not make the
        /// repair of the repairable one report failure. <c>ForceRepair</c> returns
        /// <c>0f</c> on every path, so the list is the only evidence there is.
        /// </summary>
        [Theory]
        [InlineData(1, 0, true)]
        [InlineData(2, 1, true)]
        [InlineData(1, 1, false)]
        [InlineData(0, 0, false)]
        public void SuccessIsCountedAgainstWhatWasAskedFor(int before, int after, bool expected)
        {
            Assert.Equal(expected, TestFlightRepairScope.Cleared(before, after));
        }

        /// <summary>
        /// Source text, because the walk reaches a live <c>Vessel</c>. It checks
        /// the two decisions that make this a real repair rather than a plausible
        /// one: the CORE's ForceRepair (the failure's own leaves the core's list
        /// stale, so the part repairs and the row stays red), and that no crew
        /// gate was invented for a model that has none.
        /// </summary>
        [Fact]
        public void TheWalkDrivesTestFlightsOwnRepairThroughTheCore()
        {
            var source = File.ReadAllText(ReflectionSourcePath());

            Assert.Contains("ITestFlightCore.ForceRepair(ITestFlightFailure)", source);
            Assert.Contains("TestFlightRepairScope.RefusalFor", source);
            Assert.Contains("TestFlightRepairScope.Cleared", source);
            Assert.Contains("CanAttemptRepair", source);
        }

        /// <summary>
        /// The backend must not answer a hardcoded refusal again. The scan
        /// asserts it can see its subject first, so a path that stopped resolving
        /// fails rather than reporting a clean file.
        /// </summary>
        [Fact]
        public void TheBackendDispatchesRatherThanDeclining()
        {
            var source = File.ReadAllText(BackendSourcePath());

            Assert.Contains("public RepairOutcome Repair(", source);
            Assert.Contains("_tf.Repair(", source);
            Assert.DoesNotContain("Refusal = \"refused\"", source);
        }

        private static string ReflectionSourcePath() =>
            SourcePath("GonogoTestFlightUplink", "TestFlightReflection.cs");

        private static string BackendSourcePath() =>
            SourcePath("GonogoTestFlightUplink", "TestFlightReliabilityBackend.cs");

        private static string SourcePath(string project, string file)
        {
            var dir = new DirectoryInfo(System.AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.sln")))
            {
                dir = dir.Parent;
            }
            Assert.NotNull(dir);
            var path = Path.Combine(dir!.FullName, "mod", project, file);
            Assert.True(File.Exists(path), file + " not found at " + path);
            return path;
        }
    }
}
