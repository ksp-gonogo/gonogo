using System;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// That the derived-currency arms are actually REACHED, which no unit test can
    /// establish: <c>StockCurrencyInterceptor.cs</c> and
    /// <c>CurrencyDelayScenario.cs</c> both need a live scene and are not compiled
    /// into this project at all.
    ///
    /// <para><b>Source text, not behaviour</b>, for the reason
    /// <c>CurrencyDelaySettlePumpIsWiredTests</c> spells out: a test that calls the
    /// fan-out proves the fan-out works and says nothing about whether the shipped
    /// game reaches it. <c>DerivedCurrencyWithholdingTests</c> is the behavioural
    /// half; this is the half that would have caught the confidence leak, because
    /// the leak was never that the pieces were wrong. There were no pieces.</para>
    /// </summary>
    public class DerivedCurrencyArmIsWiredTests
    {
        /// <summary>
        /// The observation has to come off the MODIFIER QUERY, not off the
        /// <c>On*Changed</c> that follows it. <c>PatchRnD.Prefix_AddScience</c> fires
        /// query, then <c>OnCurrencyModified</c> (where RP-1 banks its confidence
        /// award), then <c>OnScienceChanged</c> (where the interceptor neutralises).
        /// By the time the interceptor is told the science moved, the derived
        /// currency has already moved with it, so the query is the last moment a
        /// pre-derivation reading exists.
        /// </summary>
        [Fact]
        public void the_pre_derivation_reading_is_taken_off_the_modifier_query()
        {
            var interceptor = CurrencyDelaySourceText.Read("StockCurrencyInterceptor.cs");
            var handler = CurrencyDelaySourceText.MethodBody(
                interceptor, "private void OnCurrencyModifierQuery(CurrencyModifierQuery query)");

            // One hop, followed rather than assumed: the handler calls the per-currency
            // helper and the helper is what observes. Asserting only on the handler
            // would go green on a helper that had stopped observing anything.
            Assert.Contains("ObserveIfAsked(", handler, StringComparison.Ordinal);

            var helper = CurrencyDelaySourceText.MethodBody(
                interceptor, "private static void ObserveIfAsked(string primaryCurrency, double asked, double ut)");
            Assert.Contains("DerivedCurrencyWithholding.ObserveBeforeDerivation", helper, StringComparison.Ordinal);

            // And a zero ask takes no reading, which is what stops RP-1's own
            // zero-science confidence-pricing query from overwriting a live one.
            Assert.Contains("asked > 0.0", helper, StringComparison.Ordinal);
        }

        /// <summary>
        /// And the withhold has to come off the away-science arm, immediately after
        /// the neutralise. Anywhere earlier and the derived currency has not moved
        /// yet; anywhere else entirely and a change that resolved HOME would have
        /// its derived currency taken away, which is the operator's to keep.
        /// </summary>
        [Fact]
        public void the_withhold_is_taken_off_the_away_arm_beside_the_neutralise()
        {
            var interceptor = CurrencyDelaySourceText.Read("StockCurrencyInterceptor.cs");
            var arm = CurrencyDelaySourceText.MethodBody(
                interceptor,
                "private void ResolveScienceAway(string vesselId, double baseAmount, double ut, double shadowToRestore");

            var neutraliseAt = arm.IndexOf("NeutraliseScience(", StringComparison.Ordinal);
            var withholdAt = arm.IndexOf("DerivedCurrencyWithholding.WithholdDerived", StringComparison.Ordinal);

            Assert.True(neutraliseAt >= 0, "ResolveScienceAway no longer neutralises");
            Assert.True(
                withholdAt > neutraliseAt,
                "The derived-currency withhold must run AFTER the neutralise: RP-1 banks its confidence "
                + "award before the interceptor is told the science moved, so there is nothing to put "
                + "back until the science has actually been withheld");
        }

        /// <summary>
        /// All three primary currencies, not only the one a leak was measured on.
        /// Confidence was the instance; the class is any quantity a mod computes from
        /// a neutralised change, and a seam wired on one currency is a fix for one
        /// instance with the next mod queued behind it as a second investigation.
        /// </summary>
        [Fact]
        public void all_three_away_paths_withhold_what_was_derived_from_them()
        {
            var interceptor = CurrencyDelaySourceText.Read("StockCurrencyInterceptor.cs");

            foreach (var currency in new[] { "Funds", "Science", "Reputation" })
            {
                Assert.Contains(
                    "DerivedCurrencyCapability." + currency,
                    interceptor,
                    StringComparison.Ordinal);
            }

            // The reputation arm is shared between its two away reasons, and the funds
            // arm sits inline in its handler, so each is checked where it actually is.
            var reputationArm = CurrencyDelaySourceText.MethodBody(
                interceptor, "private void ResolveReputationAway(CurrencyChangeDecision decision, double ut)");
            Assert.Contains("DerivedCurrencyWithholding.WithholdDerived", reputationArm, StringComparison.Ordinal);

            var fundsHandler = CurrencyDelaySourceText.MethodBody(
                interceptor, "private void OnFundsChanged(double newTotal, TransactionReasons reason)");
            Assert.Contains("DerivedCurrencyWithholding.WithholdDerived", fundsHandler, StringComparison.Ordinal);
        }

        /// <summary>
        /// The arms are found through the capability kernel, and the only half of
        /// this subsystem holding one is the uplink: a <c>ScenarioModule</c> has no
        /// <c>IUplinkHost</c>. So the same uplink that DECLARES the capability binds
        /// the kernel the interceptor resolves it through. Unbound, every arm is
        /// skipped and the leak is open with nothing said about it.
        /// </summary>
        [Fact]
        public void the_uplink_that_declares_the_capability_binds_the_kernel_too()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("CurrencyEventUplink.cs");

            Assert.Contains("DerivedCurrencyCapability.CapabilityId", uplink, StringComparison.Ordinal);
            Assert.Contains("DerivedCurrencyWithholding.Bind", uplink, StringComparison.Ordinal);
        }

        /// <summary>
        /// And it binds it again on the way BACK INTO a game, which is the whole of
        /// rig run <c>conf-fixed-1</c>: the science was withheld correctly and RP-1's
        /// confidence moved anyway, with nothing in <c>KSP.log</c> either way.
        ///
        /// <para><c>Register</c> runs once for the whole process (the host addon is
        /// <c>KSPAddon(Instantly, once)</c>) and it runs during LOADING, which is
        /// BEFORE the first LOADING -> MAINMENU transition. KSP fires
        /// <c>onGameSceneLoadRequested(MAINMENU)</c> from
        /// <c>HighLogic.SetLoadSceneEventsAndFlags</c>, immediately before the
        /// "Scene Change : From LOADING to MAINMENU" line, so the main-menu teardown
        /// is reached at boot and nothing ever undid it. The kernel pointer and every
        /// game-event hook were gone for the rest of the session.</para>
        /// </summary>
        [Fact]
        public void the_kernel_and_the_hooks_are_re_armed_on_the_way_back_into_a_game()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("CurrencyEventUplink.cs");
            var handler = CurrencyDelaySourceText.MethodBody(
                uplink, "private void OnSceneLoadRequested(GameScenes scene)");

            Assert.Contains("HookGameEvents()", handler, StringComparison.Ordinal);
            Assert.Contains("BindWithholding()", handler, StringComparison.Ordinal);
        }

        /// <summary>
        /// The scene-request subscription itself is never torn down, because it is the
        /// handler that re-arms everything else: removing it is the one teardown
        /// nothing could undo, and removing it is exactly what happened.
        /// </summary>
        [Fact]
        public void the_scene_request_subscription_outlives_the_main_menu()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("CurrencyEventUplink.cs");
            var unhook = CurrencyDelaySourceText.MethodBody(uplink, "private void UnhookGameEvents()");

            Assert.DoesNotContain("onGameSceneLoadRequested", unhook, StringComparison.Ordinal);
        }

        /// <summary>
        /// The capability is SHARED, and that is the general-case half of the fix
        /// rather than a detail: an exclusive one would elect a single winner, so on
        /// an install where two mods each derive something from the same change only
        /// one of them would ever be told and the other would keep leaking. It also
        /// declares no vanilla, because a stock install derives nothing.
        /// </summary>
        [Fact]
        public void the_capability_is_shared_so_every_deriving_mod_is_told()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("CurrencyEventUplink.cs");
            var declaration = CurrencyDelaySourceText.MethodBody(
                uplink, "public void DeclareCapabilities(Kernel kernel)");

            var idAt = declaration.IndexOf("DerivedCurrencyCapability.CapabilityId", StringComparison.Ordinal);
            Assert.True(idAt >= 0, "DeclareCapabilities no longer declares the derived-currency capability");

            var descriptor = declaration.Substring(idAt);
            var closeAt = descriptor.IndexOf("});", StringComparison.Ordinal);
            descriptor = closeAt >= 0 ? descriptor.Substring(0, closeAt) : descriptor;

            Assert.Contains("Exclusive = false", descriptor, StringComparison.Ordinal);
            Assert.DoesNotContain("Vanilla", descriptor, StringComparison.Ordinal);
        }

        /// <summary>
        /// And the reports have somewhere to go. The fan-out's destination defaults
        /// to a no-op because its own file cannot reference
        /// <c>UnityEngine.Debug</c>, so a real one has to be installed by something
        /// that can. Left at the default, an arm that throws on every credit says
        /// nothing at all, and a leak that reports itself fixed is what this whole
        /// subsystem's history is made of.
        /// </summary>
        [Fact]
        public void the_reports_are_pointed_at_a_log_the_operator_can_see()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("CurrencyEventUplink.cs");

            Assert.Contains("DerivedCurrencyWithholding.Report", uplink, StringComparison.Ordinal);
            Assert.Contains("Debug.LogWarning", uplink, StringComparison.Ordinal);
        }
    }
}
