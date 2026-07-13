using System.Collections.Generic;
using Gonogo.Kos;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Headless tests for <see cref="KosRunManager"/> — the pure per-CPU
    /// arm/complete/cancel bookkeeping behind the <c>kos.run</c> command (see
    /// <c>kos-uplink-full-migration.md</c>). No KosExtension, no kOS/Unity —
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

            // Disarmed — a new run can be armed for the same CPU now.
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

        [Fact]
        public void Complete_WhenNotArmed_IsANoOp()
        {
            var mgr = new KosRunManager();
            var published = new List<KosRunResult>();
            mgr.SetPublisher((_, result) => published.Add(result));

            // No TryArm call — a completed block with nobody waiting (the
            // ordinary kos.compute / kos.exec path) must not publish here.
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
