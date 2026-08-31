using System;
using System.Collections.Generic;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// The payload mass RP-1's repeating satellite contracts require, against the
    /// stand-in RP-1 object graph.
    ///
    /// <para>The whole point of the command is
    /// <see cref="Withdraws_each_affected_contract_type_EXACTLY_once"/>. RP-1's own
    /// tab compares the slider against the stored setting BEFORE writing it back and
    /// runs every draw frame, so a drag across the range fires the withdrawal at
    /// every hundred-unit step. What it withdraws is pre-generated OFFERS rather
    /// than accepted contracts, so the cost is churn rather than loss, but it is
    /// still ninety-six rounds of churn for one decision.</para>
    ///
    /// <para>The second thing worth having is
    /// <see cref="Reports_that_the_withdrawal_hook_is_absent_which_RP1_cannot"/>.
    /// The delegate lives in CC_RP0 and RP0.dll only reads it, so on an install
    /// without ContractConfigurator's RP-0 half the payload changes and every
    /// pending offer silently keeps the OLD requirement. RP-1's tab reports that
    /// exactly as it reports success.</para>
    /// </summary>
    public class Rp1ContractCommandsTests : IDisposable
    {
        private readonly Rp1ContractCommands _commands = new Rp1ContractCommands();

        public Rp1ContractCommandsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            ContractGUI.Reset();
            HighLogic.Reset();
        }

        /// <summary>A save whose RP-1 settings node is registered, which is the normal case.</summary>
        private static RP0Settings Settings()
        {
            var settings = new RP0Settings();
            HighLogic.CurrentGame.Parameters.CustomNodes[typeof(RP0Settings)] = settings;
            return settings;
        }

        /// <summary>Every comsat and weather offer pending, so a withdrawal has something to take.</summary>
        private static void PendingOffers()
        {
            ContractGUI.InstallWithdrawalHook();
            foreach (var name in new[]
                     {
                         "GEORepeatComSats", "TundraRepeatComSats", "MolniyaRepeatComSats", "GEOWeather",
                     })
            {
                ContractGUI.Pending.Add(name);
            }
        }

        private CommandResult<Dictionary<string, object?>> Set(int? comms = null, int? weather = null) =>
            _commands.SetPayload(new Rp1ContractPayloadArgs
            {
                CommsPayload = comms,
                WeatherPayload = weather,
            });

        // ── Setting the figure ────────────────────────────────────────────────

        [Fact]
        public void Writes_the_figure_to_BOTH_the_live_static_and_the_persisted_setting()
        {
            var settings = Settings();
            PendingOffers();

            var result = Set(comms: 2000);

            Assert.True(result.Success);
            // The live static is what the contract generator reads; the persisted
            // field is what survives a load. Writing one and not the other is a
            // figure that works until the save is reopened, or only until the next
            // contract generates.
            Assert.Equal(2000, ContractGUI.CommsPayload);
            Assert.Equal(2000, settings.CommsPayload);
        }

        [Fact]
        public void The_two_halves_are_independent()
        {
            var settings = Settings();
            PendingOffers();

            Assert.True(Set(weather: 3000).Success);

            // An operator raising the weather requirement should not have to restate
            // the communications one and risk withdrawing its offers for nothing.
            Assert.Equal(3000, ContractGUI.WeatherPayload);
            Assert.Equal(3000, settings.WeatherPayload);
            Assert.Equal(400, ContractGUI.CommsPayload);
            Assert.Equal(400, settings.CommsPayload);
        }

        [Fact]
        public void Refuses_a_command_that_named_neither_figure()
        {
            Settings();

            var result = Set();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
            Assert.Contains("nothing to set", result.Detail);
        }

        // ── The withdrawal, which is the point ────────────────────────────────

        [Fact]
        public void Withdraws_each_affected_contract_type_EXACTLY_once()
        {
            Settings();
            PendingOffers();

            var result = Set(comms: 5000);

            Assert.True(result.Success);
            // THE ASSERTION THIS FILE EXISTS FOR. Three comsat types, once each.
            // RP-1's own tab would have fired this at every hundred-unit step of a
            // drag from 400 to 5,000, which is forty-six rounds of the same three.
            Assert.Equal(
                new[] { "GEORepeatComSats", "MolniyaRepeatComSats", "TundraRepeatComSats" },
                ContractGUI.Withdrawn.OrderBy(n => n, StringComparer.Ordinal).ToArray());
            Assert.Equal(3, result.Payload!["offersWithdrawn"]);
        }

        [Fact]
        public void Withdraws_only_the_types_the_changed_figure_affects()
        {
            Settings();
            PendingOffers();

            Assert.True(Set(weather: 5000).Success);

            // The weather figure invalidates one contract type and the comsat figure
            // invalidates three, and RP-1 keeps those lists apart. Withdrawing all
            // four for either would throw away offers the change cannot have
            // invalidated.
            Assert.Equal(new[] { "GEOWeather" }, ContractGUI.Withdrawn.ToArray());
        }

        [Fact]
        public void Withdraws_both_sets_when_both_figures_move()
        {
            Settings();
            PendingOffers();

            var result = Set(comms: 5000, weather: 5000);

            Assert.True(result.Success);
            Assert.Equal(4, ContractGUI.Withdrawn.Count);
            Assert.Equal(4, result.Payload!["offersWithdrawn"]);
        }

        [Fact]
        public void Withdraws_NOTHING_when_the_figure_is_already_what_was_asked_for()
        {
            var settings = Settings();
            PendingOffers();
            ContractGUI.CommsPayload = 2000;
            settings.CommsPayload = 2000;

            var result = Set(comms: 2000);

            Assert.True(result.Success);
            // Succeeds because the asked-for state IS the state, and this is the one
            // case where RP-1's own tab agrees: it fires no withdrawal either. A
            // re-sent command is visibly a no-op rather than a second round of churn.
            Assert.Empty(ContractGUI.Withdrawn);
            Assert.Equal(0, result.Payload!["offersWithdrawn"]);
            Assert.False((bool)result.Payload!["changed"]!);
        }

        [Fact]
        public void Counts_only_the_offers_that_actually_went()
        {
            Settings();
            ContractGUI.InstallWithdrawalHook();
            // One comsat type has a pending offer; the other two have none, which is
            // the normal state of a career that has already taken what was on offer.
            ContractGUI.Pending.Add("TundraRepeatComSats");

            var result = Set(comms: 5000);

            Assert.True(result.Success);
            // All three were ASKED, because we cannot know which have offers without
            // asking, and one went. A zero here means "nothing needed invalidating"
            // rather than "it failed", which is why the hook's presence is reported
            // separately.
            Assert.Equal(3, ContractGUI.Withdrawn.Count);
            Assert.Equal(1, result.Payload!["offersWithdrawn"]);
            Assert.True((bool)result.Payload!["withdrawalAvailable"]!);
        }

        [Fact]
        public void Reports_that_the_withdrawal_hook_is_absent_which_RP1_cannot()
        {
            var settings = Settings();
            // No InstallWithdrawalHook: the delegate lives in CC_RP0 and RP0.dll only
            // reads it, so this is a real install state rather than a contrivance.
            Assert.Null(ContractGUI.WithdrawContractAction);

            var result = Set(comms: 5000);

            // Still succeeds, because RP-1 succeeds: the requirement genuinely
            // changed and future generation will honour it.
            Assert.True(result.Success);
            Assert.Equal(5000, ContractGUI.CommsPayload);
            Assert.Equal(5000, settings.CommsPayload);
            // But every pending offer silently keeps the OLD requirement, and this
            // field is the only place an operator can learn it. RP-1's tab reports
            // this state exactly as it reports success.
            Assert.False((bool)result.Payload!["withdrawalAvailable"]!);
            Assert.Equal(0, result.Payload!["offersWithdrawn"]);
        }

        // ── The bounds, which are RP-1's own ─────────────────────────────────

        [Fact]
        public void Refuses_a_figure_outside_RP1s_own_range()
        {
            Settings();
            PendingOffers();

            foreach (var outside in new[] { 300, 10_100 })
            {
                var result = Set(comms: outside);
                Assert.False(result.Success);
                Assert.Equal(CommandErrorCode.Range, result.ErrorCode);
                // Named with the range, because the operator needs the bound rather
                // than the fact that they missed it.
                Assert.Contains("400", result.Detail);
                Assert.Contains("10,000", result.Detail);
            }

            // Refused rather than clamped, and nothing moved: a clamp would report
            // success for a requirement the operator did not choose, and would
            // withdraw offers to install it.
            Assert.Equal(400, ContractGUI.CommsPayload);
            Assert.Empty(ContractGUI.Withdrawn);
        }

        [Fact]
        public void Refuses_a_figure_between_RP1s_hundred_unit_steps()
        {
            Settings();
            PendingOffers();

            var result = Set(comms: 2050);

            Assert.False(result.Success);
            // RP-1's own control rounds to hundreds, so a figure between steps is not
            // one the game can hold: it would drift the moment anybody opened the tab,
            // and that drift would withdraw offers again.
            Assert.Contains("steps of 100", result.Detail);
            Assert.Equal(400, ContractGUI.CommsPayload);
            Assert.Empty(ContractGUI.Withdrawn);
        }

        [Fact]
        public void Accepts_both_ends_of_the_range()
        {
            Settings();
            PendingOffers();

            Assert.True(Set(comms: 400, weather: 10_000).Success);
            Assert.Equal(400, ContractGUI.CommsPayload);
            Assert.Equal(10_000, ContractGUI.WeatherPayload);
        }

        // ── Refusing rather than half-writing ────────────────────────────────

        [Fact]
        public void Refuses_when_the_saves_settings_node_is_not_registered()
        {
            PendingOffers();
            // No Settings(): KSP has not registered RP-1's node for this save, which
            // the NON-GENERIC CustomParams reports by returning rather than throwing.
            // That choice is why this is a refusal and not an exception crossing the
            // Uplink boundary.
            var result = Set(comms: 5000);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Contains("would not persist", result.Detail);
            // And nothing moved at all, which is the important half: a command that
            // wrote the live static first and then discovered it could not persist
            // would leave a figure that reverts on load.
            Assert.Equal(400, ContractGUI.CommsPayload);
            Assert.Empty(ContractGUI.Withdrawn);
        }

        [Fact]
        public void The_diagnosis_names_the_absent_withdrawal_hook_rather_than_calling_it_missing()
        {
            Settings();

            Assert.True(_commands.IsAvailable);
            // A distinct sentence rather than "not found": the hook is legitimately
            // null before ContractConfigurator has registered and on an install
            // without it, so calling it missing would report a healthy install as
            // broken. What it changes is what the command can PROMISE.
            Assert.Contains("withdrawal hook is absent", _commands.MethodDiagnosis());

            ContractGUI.InstallWithdrawalHook();
            Assert.Equal("every invoked member resolved", _commands.MethodDiagnosis());
        }
    }
}
