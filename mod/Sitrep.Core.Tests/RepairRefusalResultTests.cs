using System;
using System.IO;
using System.Text.RegularExpressions;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A refused repair must not resolve as a success, and it must say which of
    /// the repair refusals it was.
    ///
    /// <para><c>Ok</c> sets <see cref="CommandResult.Success"/> true
    /// unconditionally, so a refusal wrapped in
    /// <c>CommandResult&lt;RepairOutcome&gt;.Ok(...)</c> would arrive on the
    /// client's CONFIRMED path and look exactly like a repair that worked.</para>
    /// </summary>
    public class RepairRefusalResultTests
    {
        public static TheoryData<RefusalCode, RefusalCode> Refinements => new TheoryData<RefusalCode, RefusalCode>
        {
            { RepairRefusal.NoSuchPart, CommandErrorCode.NotFound },
            { RepairRefusal.NoSuchCrew, CommandErrorCode.NotFound },
            { RepairRefusal.CrewNotQualified, CommandErrorCode.CapabilityMismatch },
            { RepairRefusal.Unrepairable, CommandErrorCode.CapabilityMismatch },
            { RepairRefusal.EvaImpossible, CommandErrorCode.NotClearToProceed },
            { RepairRefusal.NoKits, CommandErrorCode.InsufficientResource },
            { RepairRefusal.NotModelled, CommandErrorCode.ModeUnavailable },
        };

        [Theory]
        [MemberData(nameof(Refinements))]
        public void EveryRepairRefusalRefinesTheRootAClientClassifiesItBy(RefusalCode refusal, RefusalCode root)
        {
            Assert.False(refusal.IsRoot);
            Assert.Equal(root, refusal.Root);
            Assert.StartsWith("repair.", refusal.Id, StringComparison.Ordinal);
        }

        /// <summary>
        /// The root and the refinement both travel: a part that does not resolve
        /// and a crew member who does not are both <c>notFound</c>, and only
        /// <c>reason</c> says which.
        /// </summary>
        [Fact]
        public void ARefusedRepairCarriesItsRootAndItsReasonOnTheWire()
        {
            var json = Sitrep.Contract.Serialization.EnvelopeCodec.WriteCommandResponse(new CommandResponse<object?>
            {
                RequestId = "r1",
                Result = CommandResult<RepairOutcome>.Fail(RepairRefusal.NoSuchCrew),
                Meta = new Meta { Source = "system", Vantage = "v" },
            });

            Assert.Contains("\"success\":false", json);
            Assert.Contains("\"errorCode\":\"notFound\"", json);
            Assert.Contains("\"reason\":\"repair.noSuchCrew\"", json);
        }

        [Fact]
        public void TheCoreRefinementsAreFoundByTheirIds()
        {
            foreach (var code in CommandErrorCode.CoreRefinements)
            {
                Assert.Same(code, CommandErrorCode.Find(code.Id));
            }
            Assert.Equal(7, CommandErrorCode.CoreRefinements.Count);
        }

        /// <summary>
        /// Source text, because the registrar's handler body reaches
        /// <c>FlightGlobals</c> through the elected backend and cannot be entered
        /// in a headless process. What is checked is that the registrar hands
        /// back the backend's own result and never wraps one in <c>Ok(</c>.
        /// </summary>
        [Fact]
        public void TheRegistrarRoutesEveryRepairOutcomeThroughTheRule()
        {
            var source = File.ReadAllText(ReliabilityCoreUplinkPath());

            Assert.Contains("backend.Repair(", source);
            Assert.DoesNotMatch(
                new Regex(@"CommandResult<RepairOutcome>\s*\.\s*Ok\("),
                source);
        }

        /// <summary>
        /// The scan asserts it found its subject: a path that stopped resolving
        /// would read an empty string, find no <c>Ok(</c> in it, and report a pass.
        /// </summary>
        [Fact]
        public void TheWiringScanCanSeeItsSubject()
        {
            var source = File.ReadAllText(ReliabilityCoreUplinkPath());

            Assert.Contains("AddCommandHandler<RepairPartArgs", source);
        }

        private static string ReliabilityCoreUplinkPath()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.sln")))
            {
                dir = dir.Parent;
            }
            Assert.NotNull(dir);
            var path = Path.Combine(dir!.FullName, "mod", "Gonogo.KSP", "ReliabilityCoreUplink.cs");
            Assert.True(File.Exists(path), "ReliabilityCoreUplink.cs not found at " + path);
            return path;
        }
    }
}
