using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// That a contributed SCET threshold source is actually REACHED.
    ///
    /// <para><b>Why source text.</b> <c>ScetThresholdSourcesTests</c> is the
    /// behavioural half and it proves the table merges core's entries with the
    /// Kernel's. It cannot prove that the arm asks THAT table: every one of its
    /// assertions passes just as well against a <c>ScetAlarmUplink</c> that kept
    /// asking <c>ScetThresholdSources.CoreOnly</c>, and on that build no
    /// contributed Topic can be armed against at all while the seam's own suite
    /// stays green. <c>ScetAlarmUplink</c> needs a live scene (it reads
    /// <c>Planetarium</c> and commands the game's warp), so the wiring is not
    /// reachable any other way from here.</para>
    ///
    /// <para>Same technique and the same reason as
    /// <c>DerivedCurrencyArmIsWiredTests</c> next door: a test that calls the
    /// merge proves the merge works and says nothing about whether the shipped
    /// game reaches it.</para>
    /// </summary>
    public class ScetThresholdSeamIsWiredTests
    {
        /// <summary>
        /// The table is bound to the HOST's kernel, which is the whole of what
        /// makes the seam a seam. Left at core's own entries, an arm against a
        /// contributed Topic is refused by name and an operator is told the
        /// simulation cannot read a Topic their own mod publishes.
        /// </summary>
        [Fact]
        public void the_arms_table_is_built_from_the_hosts_kernel()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");
            var register = CurrencyDelaySourceText.MethodBody(uplink, "public void Register(IUplinkHost host)");

            Assert.Contains("new ScetThresholdSources(host.Kernel)", register, StringComparison.Ordinal);
        }

        /// <summary>
        /// And both halves of the arm ask that table rather than core's. The
        /// refusal and the reading are separate call sites and either one left
        /// behind fails differently: a core-only refusal rejects the arm outright,
        /// a core-only reading accepts it and then never fires.
        /// </summary>
        [Fact]
        public void both_the_refusal_and_the_reading_ask_it()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            var arm = CurrencyDelaySourceText.MethodBody(
                uplink, "private CommandResult HandleArm(ScetAlarmArmArgs? args, string vantage)");
            Assert.Contains("_thresholds.Knows(condition.Topic)", arm, StringComparison.Ordinal);

            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            Assert.Contains(
                "new SnapshotScetStateReader(snapshot, _thresholds)", capture, StringComparison.Ordinal);

            // Neither reaches past the field to the static table, which is the
            // shape the wiring regresses to.
            Assert.DoesNotContain("ScetThresholdSources.CoreOnly", arm, StringComparison.Ordinal);
            Assert.DoesNotContain("ScetThresholdSources.CoreOnly", capture, StringComparison.Ordinal);
        }

        /// <summary>
        /// The capability is SHARED, and that is not a detail: an exclusive one
        /// would elect a single winner, so on an install with two mods each
        /// offering a quantity worth stopping a warp for only one of them could be
        /// armed against. No vanilla either, because core's own Topics are a table
        /// rather than a provider and a stock install contributes nothing.
        /// </summary>
        [Fact]
        public void the_capability_is_shared_so_every_contributing_mod_is_reachable()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");
            var declaration = CurrencyDelaySourceText.MethodBody(
                uplink, "public void DeclareCapabilities(Kernel kernel)");

            var idAt = declaration.IndexOf("ScetThresholdCapability.Id", StringComparison.Ordinal);
            Assert.True(idAt >= 0, "DeclareCapabilities no longer declares the SCET threshold capability");

            var descriptor = declaration.Substring(idAt);
            var closeAt = descriptor.IndexOf("});", StringComparison.Ordinal);
            descriptor = closeAt >= 0 ? descriptor.Substring(0, closeAt) : descriptor;

            Assert.Contains("Exclusive = false", descriptor, StringComparison.Ordinal);
            Assert.DoesNotContain("Vanilla", descriptor, StringComparison.Ordinal);
        }
    }
}
