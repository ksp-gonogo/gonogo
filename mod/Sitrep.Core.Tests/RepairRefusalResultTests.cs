using System;
using System.IO;
using System.Text.RegularExpressions;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A refusal must not resolve as a success.
    ///
    /// <para><c>vessel.repair</c> returned every outcome through
    /// <c>CommandResult&lt;RepairOutcome&gt;.Ok(...)</c>, and <c>Ok</c> sets
    /// <see cref="CommandResult.Success"/> true unconditionally. So a repair that
    /// was refused for want of a kit, a qualified kerbal or a part that exists
    /// arrived on the client's CONFIRMED path: the promise resolved,
    /// <c>CommandButton</c> settled at <c>idle</c>, and the operator saw exactly
    /// what a successful repair looks like. The button's own <c>refused</c> phase
    /// could not be reached by this command at all.</para>
    ///
    /// <para>Two halves, because either alone passes while the bug is live: the
    /// RULE below decides what a refusal becomes, and the WIRING test asserts the
    /// registrar actually routes through it. A correct rule nothing calls is the
    /// shape the defect already had.</para>
    /// </summary>
    public class RepairRefusalResultTests
    {
        [Fact]
        public void ARepairedOutcomeIsTheOnlySuccess()
        {
            var result = RepairRefusal.ResultFor(new RepairOutcome { Repaired = true, KitsUsed = 1 });

            Assert.True(result.Success);
            Assert.Equal(CommandErrorCode.None, result.ErrorCode);
            Assert.Equal(1, result.Payload?.KitsUsed);
        }

        [Theory]
        [InlineData(RepairRefusal.NoSuchPart, CommandErrorCode.NotFound)]
        [InlineData(RepairRefusal.NoSuchCrew, CommandErrorCode.NotFound)]
        [InlineData(RepairRefusal.CrewNotQualified, CommandErrorCode.CapabilityMismatch)]
        [InlineData(RepairRefusal.Unrepairable, CommandErrorCode.CapabilityMismatch)]
        [InlineData(RepairRefusal.EvaImpossible, CommandErrorCode.NotClearToProceed)]
        [InlineData(RepairRefusal.NoKits, CommandErrorCode.InsufficientResource)]
        [InlineData(RepairRefusal.NotModelled, CommandErrorCode.ModeUnavailable)]
        [InlineData(RepairRefusal.Refused, CommandErrorCode.ModeUnavailable)]
        public void EveryRefusalIsAFailureCarryingItsOwnCode(string refusal, CommandErrorCode expected)
        {
            var result = RepairRefusal.ResultFor(new RepairOutcome { Repaired = false, Refusal = refusal });

            Assert.False(result.Success);
            Assert.Equal(expected, result.ErrorCode);
        }

        /// <summary>
        /// The enum is coarser than the vocabulary on purpose, so the token has to
        /// survive the mapping: a part that does not resolve and a crew member who
        /// does not are both <see cref="CommandErrorCode.NotFound"/>, and only the
        /// payload says which. A refusal that dropped it would leave the operator
        /// re-sending the command to find out.
        /// </summary>
        [Fact]
        public void ARefusalStillCarriesItsFinerToken()
        {
            var result = RepairRefusal.ResultFor(
                new RepairOutcome { Repaired = false, Refusal = RepairRefusal.NoSuchCrew });

            Assert.Equal(RepairRefusal.NoSuchCrew, result.Payload?.Refusal);
        }

        /// <summary>
        /// A token a newer backend emits that this build has never heard of must
        /// still refuse. Defaulting to the success arm is the whole defect,
        /// arriving by a different route.
        /// </summary>
        [Fact]
        public void AnUnrecognisedTokenRefusesRatherThanSucceeds()
        {
            var result = RepairRefusal.ResultFor(
                new RepairOutcome { Repaired = false, Refusal = "a-token-from-a-later-build" });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        /// <summary>
        /// Source text, because the registrar's handler body reaches
        /// <c>FlightGlobals</c> through the elected backend and cannot be entered
        /// in a headless process. What is checked is exactly what regressed: an
        /// <c>Ok(</c> on the repair path.
        /// </summary>
        [Fact]
        public void TheRegistrarRoutesEveryRepairOutcomeThroughTheRule()
        {
            var source = File.ReadAllText(ReliabilityCoreUplinkPath());

            Assert.Contains("RepairRefusal.ResultFor", source);
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
