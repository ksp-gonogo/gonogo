using System.Collections.Generic;
using Gonogo.KosUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// Headless tests for <see cref="KosRunManager"/>: the pure per-CPU
    /// arm/complete/cancel bookkeeping behind the <c>kos.run</c> command (see
    /// <c>kos-uplink-full-migration.md</c>). No KosExtension, no kOS/Unity:
    /// this class stands entirely on its own, exactly like
    /// <c>KosTerminalManagerTests</c> stands alone from
    /// <c>KosProcessorScreen</c>.
    /// </summary>
    public class KosRunManagerTests
    {
        [Fact]
        public void TryArm_FirstRequestForACpu_Succeeds()
        {
            var mgr = new KosRunManager();

            Assert.True(mgr.TryArm(7, "req-1"));
            Assert.True(mgr.IsArmed(7));
            Assert.True(mgr.HasAnyArmed());
        }

        [Fact]
        public void TryArm_SecondRequestForTheSameCpuWhileArmed_Fails()
        {
            var mgr = new KosRunManager();
            Assert.True(mgr.TryArm(7, "req-1"));

            // A second kos.run for the same CPU before the first resolves
            // must be rejected, never silently clobber the first request's
            // correlation.
            Assert.False(mgr.TryArm(7, "req-2"));
            Assert.True(mgr.IsArmed(7));
        }

        [Fact]
        public void TryArm_DifferentCpus_AreIndependent()
        {
            var mgr = new KosRunManager();

            Assert.True(mgr.TryArm(7, "req-1"));
            Assert.True(mgr.TryArm(9, "req-2"));
            Assert.True(mgr.IsArmed(7));
            Assert.True(mgr.IsArmed(9));
        }

        [Fact]
        public void TryArm_EmptyRequestId_Fails()
        {
            var mgr = new KosRunManager();

            Assert.False(mgr.TryArm(7, ""));
            Assert.False(mgr.IsArmed(7));
        }

        [Fact]
        public void Complete_WhenArmed_PublishesFieldsAndDisarms()
        {
            var mgr = new KosRunManager();
            var published = new List<(int coreId, KosRunResult result)>();
            mgr.SetPublisher((coreId, result) => published.Add((coreId, result)));
            mgr.TryArm(7, "req-1");

            var block = new KosComputeBlock("default", new Dictionary<string, object> { ["v"] = 1.0 });
            mgr.Complete(7, block);

            var (coreId, result) = Assert.Single(published);
            Assert.Equal(7, coreId);
            Assert.Equal("req-1", result.RequestId);
            Assert.Equal(7, result.CoreId);
            Assert.NotNull(result.Fields);
            Assert.Equal(1.0, result.Fields!["v"]);
            Assert.Null(result.Error);

            // Disarmed: a new run can be armed for the same CPU now.
            Assert.False(mgr.IsArmed(7));
            Assert.True(mgr.TryArm(7, "req-2"));
        }

        [Fact]
        public void Complete_ForAnErrorBlock_PublishesErrorAndNullFields()
        {
            var mgr = new KosRunManager();
            var published = new List<KosRunResult>();
            mgr.SetPublisher((_, result) => published.Add(result));
            mgr.TryArm(7, "req-1");

            var block = KosComputeBlock.ForError("engine flameout");
            mgr.Complete(7, block);

            var result = Assert.Single(published);
            Assert.Null(result.Fields);
            Assert.Equal("engine flameout", result.Error);
        }

        /// <summary>
        /// <c>KosRunResult</c>'s own doc states the R7 invariant: exactly one
        /// of Fields/Error is non-null. An error block whose message we never
        /// managed to read (the public ctor takes isError and errorMessage
        /// independently, and defaults the message to null) published BOTH as
        /// null, which the client's `payload.fields ?? {}` then resolved as a
        /// successful run that returned no fields: a green OK for a script
        /// that failed.
        /// </summary>
        [Fact]
        public void Complete_ForAnErrorBlockWithNoMessage_StillPublishesAnError()
        {
            var mgr = new KosRunManager();
            var published = new List<KosRunResult>();
            mgr.SetPublisher((_, result) => published.Add(result));
            mgr.TryArm(7, "req-1");

            mgr.Complete(7, new KosComputeBlock("t", new Dictionary<string, object>(), isError: true));

            var result = Assert.Single(published);
            Assert.Null(result.Fields);
            Assert.False(string.IsNullOrWhiteSpace(result.Error));
        }

        /// <summary>
        /// An empty <c>[KOSERROR][/KOSERROR]</c> body is the same absence
        /// arriving by the sanctioned route: the script signalled a failure
        /// and told us nothing about it. The widget renders <c>Error</c> as
        /// the whole explanation, so an empty string draws a "Script error"
        /// badge over blank space.
        /// </summary>
        [Fact]
        public void Complete_ForAnEmptyKoserrorBody_PublishesAReadableError()
        {
            var mgr = new KosRunManager();
            var published = new List<KosRunResult>();
            mgr.SetPublisher((_, result) => published.Add(result));
            mgr.TryArm(7, "req-1");

            mgr.Complete(7, KosComputeBlock.ForError("   "));

            var result = Assert.Single(published);
            Assert.Null(result.Fields);
            Assert.False(string.IsNullOrWhiteSpace(result.Error));
        }

        [Fact]
        public void Complete_WhenNotArmed_IsANoOp()
        {
            var mgr = new KosRunManager();
            var published = new List<KosRunResult>();
            mgr.SetPublisher((_, result) => published.Add(result));

            // No TryArm call: a completed block with nobody waiting (the
            // ordinary kos.compute fanout path) must not publish here.
            var block = new KosComputeBlock("t", new Dictionary<string, object> { ["v"] = 1.0 });
            mgr.Complete(7, block);

            Assert.Empty(published);
        }

        [Fact]
        public void Cancel_DisarmsWithoutPublishing()
        {
            var mgr = new KosRunManager();
            var published = new List<KosRunResult>();
            mgr.SetPublisher((_, result) => published.Add(result));
            mgr.TryArm(7, "req-1");

            mgr.Cancel(7);

            Assert.False(mgr.IsArmed(7));
            Assert.Empty(published);
            // A stray block landing after cancellation is not mis-attributed.
            mgr.Complete(7, new KosComputeBlock("t", new Dictionary<string, object>()));
            Assert.Empty(published);
        }

        [Fact]
        public void ArmAndType_WhenTypingSucceeds_AcksAndStaysArmedForTheResult()
        {
            var mgr = new KosRunManager();

            var result = mgr.ArmAndType(7, "req-1", () => true);

            Assert.True(result.Success);
            Assert.True(mgr.IsArmed(7));
        }

        /// <summary>
        /// The CPU had no terminal window, so nothing was typed and no
        /// <c>[KOSDATA]</c> block will ever come back. Acking that leaves the
        /// operator watching a 30 s round-trip timeout for a script that never
        /// ran, which is the lesser half of the defect.
        /// </summary>
        [Fact]
        public void ArmAndType_WhenTypingFails_IsRefusedNotAcked()
        {
            var mgr = new KosRunManager();

            var result = mgr.ArmAndType(7, "req-1", () => false);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        /// <summary>
        /// The lasting half: arming happens before typing, so a run that was
        /// never typed has to be unarmed again. Left armed, every later
        /// <c>kos.run</c> to that CPU is rejected by <c>TryArm</c> forever and
        /// nothing evicts it.
        /// </summary>
        [Fact]
        public void ArmAndType_WhenTypingFails_LeavesTheCpuRunnable()
        {
            var mgr = new KosRunManager();

            mgr.ArmAndType(7, "req-1", () => false);

            Assert.False(mgr.IsArmed(7));
            Assert.False(mgr.HasAnyArmed());
            Assert.True(mgr.ArmAndType(7, "req-2", () => true).Success);
        }

        [Fact]
        public void ArmAndType_WhenAnotherRunIsInFlight_IsRejectedWithoutTyping()
        {
            var mgr = new KosRunManager();
            Assert.True(mgr.ArmAndType(7, "req-1", () => true).Success);

            var typed = false;
            var result = mgr.ArmAndType(7, "req-2", () => { typed = true; return true; });

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.False(typed);
            // The first request's correlation survives the rejection.
            Assert.True(mgr.IsArmed(7));
        }

        [Fact]
        public void HasAnyArmed_ReflectsAnyCpu()
        {
            var mgr = new KosRunManager();
            Assert.False(mgr.HasAnyArmed());

            mgr.TryArm(7, "req-1");
            Assert.True(mgr.HasAnyArmed());

            mgr.Cancel(7);
            Assert.False(mgr.HasAnyArmed());
        }
    }
}
