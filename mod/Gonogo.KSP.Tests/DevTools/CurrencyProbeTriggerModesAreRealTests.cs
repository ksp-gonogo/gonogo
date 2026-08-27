using System;
using System.IO;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// That <c>GonogoDevCurrency</c>'s trigger modes exercise the REAL production path,
    /// pinned against the shipped source because not one line of a MonoBehaviour polling
    /// live balances runs outside a game.
    ///
    /// <para><b>What would go wrong without these.</b> The entire value of the trigger
    /// modes is that they do not fake anything: they call the public non-UI producer of
    /// a real KSP event and let the game credit the currency. A future edit that swapped
    /// any of those calls for a fired GameEvent, or for a direct push into the
    /// interceptor's correlation state, would leave the tool building, the verdicts
    /// passing, and every result file reporting a validated away path that was validated
    /// against a fixture of its own making. That is the exact failure this subsystem has
    /// produced repeatedly: proving nothing while looking green.</para>
    ///
    /// <para><b>And the tool's own claims about the production code are pinned too.</b>
    /// The addon's class doc tells an operator that funds can never carry a light-time
    /// and that the away set is three reasons. Both are read off the interceptor today.
    /// Neither would stop reading true on its own if the interceptor changed, so the doc
    /// would quietly become a lie an operator plans a validation matrix around.</para>
    /// </summary>
    public class CurrencyProbeTriggerModesAreRealTests
    {
        private static string Probe() => ReadModSource(Path.Combine("GonogoDevTools", "GonogoDevCurrency.cs"));

        [Fact]
        public void Recovery_goes_through_the_stock_recovery_entry_point_rather_than_a_fired_event()
        {
            // ShipConstruction.RecoverVesselFromFlight fires onVesselRecovered itself,
            // which reaches stock VesselRecovery.OnVesselRecovered, which computes the
            // real recovery factor and fires onVesselRecoveryProcessing. Calling it is
            // the only way to make that whole chain run.
            Assert.Contains("ShipConstruction.RecoverVesselFromFlight(", Probe(), StringComparison.Ordinal);
        }

        [Fact]
        public void Destruction_goes_through_Vessel_Die_rather_than_a_fired_event()
        {
            // Vessel.Die() fires onVesselWillDestroy at the start of its own teardown,
            // while the vessel is still intact, which is the moment the interceptor
            // captures its light-time.
            Assert.Contains("origin.Die();", Probe(), StringComparison.Ordinal);
        }

        [Fact]
        public void A_crew_death_goes_through_ProtoCrewMember_Die_which_is_the_only_producer_of_the_penalty()
        {
            // Reputation.OnCrewKilled is the only site in the stock assembly using
            // TransactionReasons.VesselLoss, and GameEvents.onCrewKilled is fired from
            // exactly one place: ProtoCrewMember.Die().
            Assert.Contains("victim.Die();", Probe(), StringComparison.Ordinal);
        }

        [Fact]
        public void The_probe_never_fires_either_lifecycle_event_itself()
        {
            // The two events other mods act on destructively. Firing them as bare
            // notifications is what the trigger modes exist to avoid: a recovery
            // notification would have stock recover the crew off a vessel that still
            // exists, and a destruction notification would tell every subscriber a
            // living craft had died.
            var source = Probe();

            Assert.DoesNotContain("onVesselRecoveryProcessing.Fire", source, StringComparison.Ordinal);
            Assert.DoesNotContain("onVesselWillDestroy.Fire", source, StringComparison.Ordinal);
            Assert.DoesNotContain("onVesselRecovered.Fire", source, StringComparison.Ordinal);
            Assert.DoesNotContain("onCrewKilled.Fire", source, StringComparison.Ordinal);
        }

        [Fact]
        public void The_probe_never_pushes_into_the_interceptors_correlation_state()
        {
            // A direct push would be in the right dispatch order by construction, and
            // dispatch order is the thing most likely to be wrong: stock Funding,
            // ResearchAndDevelopment and Reputation all credit recovery currency from
            // the same onVesselRecoveryProcessing the interceptor pushes from. A seam
            // would validate the away path and be blind to whether it ever engages in a
            // real game.
            var source = Probe();

            Assert.DoesNotContain("PushRecoveryVessel", source, StringComparison.Ordinal);
            Assert.DoesNotContain("PushDeathVessel", source, StringComparison.Ordinal);
        }

        [Fact]
        public void Every_trigger_mode_is_gated_by_the_refusal_before_it_runs()
        {
            // Three irreversible acts. The gate is a separate testable function precisely
            // so it can be exercised without a craft to lose, and it is worth nothing if
            // the call site stops consulting it.
            var source = Probe();
            var refusalAt = source.IndexOf("CurrencyProbeVerdicts.RefuseTrigger(", StringComparison.Ordinal);
            var triggerAt = source.IndexOf("watch.TriggerOutcome = Trigger(", StringComparison.Ordinal);

            Assert.True(refusalAt >= 0, "the probe no longer consults RefuseTrigger at all");
            Assert.True(triggerAt >= 0, "the probe no longer has the guarded Trigger call this check anchors on");
            Assert.True(refusalAt < triggerAt, "RefuseTrigger is no longer consulted before the trigger fires");
        }

        [Fact]
        public void The_away_set_is_still_the_three_reasons_the_modes_between_them_cover()
        {
            // recover covers VesselRecovery, destroy covers VesselLoss, and lab/none
            // cover ScienceTransmission. A fourth away reason would be a row with no
            // mode to exercise it, and nothing else would say so.
            var source = ReadModSource(Path.Combine("Gonogo.KSP", "CurrencyDelay", "StockCurrencyDecision.cs"));
            var awaySetAt = source.IndexOf("AwayReasons", StringComparison.Ordinal);
            Assert.True(awaySetAt >= 0, "StockCurrencyDecision no longer has an AwayReasons set");

            var setBody = source.Substring(awaySetAt, source.IndexOf("};", awaySetAt, StringComparison.Ordinal) - awaySetAt);

            Assert.Contains("ScienceTransmission", setBody, StringComparison.Ordinal);
            Assert.Contains("VesselRecovery", setBody, StringComparison.Ordinal);
            Assert.Contains("VesselLoss", setBody, StringComparison.Ordinal);

            foreach (var reason in Enum.GetNames(typeof(StockTransactionReason)))
            {
                if (reason == "ScienceTransmission" || reason == "VesselRecovery" || reason == "VesselLoss")
                {
                    continue;
                }
                Assert.DoesNotContain("StockTransactionReason." + reason, setBody, StringComparison.Ordinal);
            }
        }

        [Fact]
        public void The_funds_away_arm_still_reveals_instantly_so_the_probes_claim_about_it_holds()
        {
            // The addon's class doc tells an operator that a funds light-time cannot be
            // validated because there is not one to validate: OnFundsChanged gates away
            // purely on a recovery correlation and then passes KscDelay.Instant
            // unconditionally. If that ever changes, the claim becomes a lie an operator
            // has already planned a matrix around, and a lie in a dev tool's doc is worse
            // than a missing feature.
            var source = ReadModSource(Path.Combine("Gonogo.KSP", "CurrencyDelay", "StockCurrencyInterceptor.cs"));
            var handlerAt = source.IndexOf("private void OnFundsChanged(", StringComparison.Ordinal);
            Assert.True(handlerAt >= 0, "StockCurrencyInterceptor no longer has an OnFundsChanged handler");

            var nextHandlerAt = source.IndexOf("private void OnReputationChanged(", handlerAt, StringComparison.Ordinal);
            Assert.True(nextHandlerAt > handlerAt, "could not bound the OnFundsChanged body");

            var body = source.Substring(handlerAt, nextHandlerAt - handlerAt);

            Assert.Contains("KscDelay.Instant", body, StringComparison.Ordinal);
            Assert.DoesNotContain("KscLightTime.ForVesselId", body, StringComparison.Ordinal);
        }

        [Fact]
        public void Every_private_member_the_new_correlation_readout_names_still_exists()
        {
            // All five are reached by string, so a rename costs nothing at build time
            // and shows up only as a rig run that explains less than the last one did.
            // These counters are the whole of what tells a push that never arrived from
            // one that arrived after stock had already credited the change.
            var interceptor = ReadModSource(Path.Combine("Gonogo.KSP", "CurrencyDelay", "StockCurrencyInterceptor.cs"));
            var state = ReadModSource(Path.Combine("Gonogo.KSP", "CurrencyDelay", "StockCurrencyStateMachine.cs"));

            Assert.Contains("_recoveryVesselsById", interceptor, StringComparison.Ordinal);
            Assert.Contains("_deathLightTimesById", interceptor, StringComparison.Ordinal);
            Assert.Contains("_recoveryVessels", state, StringComparison.Ordinal);
            Assert.Contains("_deathVessels", state, StringComparison.Ordinal);
            Assert.Contains("_reputationDefers", state, StringComparison.Ordinal);
        }

        [Fact]
        public void All_three_shadow_balances_the_readout_names_are_still_public_on_the_state_machine()
        {
            Assert.NotNull(typeof(StockCurrencyStateMachine).GetProperty("ShadowFunds"));
            Assert.NotNull(typeof(StockCurrencyStateMachine).GetProperty("ShadowScience"));
            Assert.NotNull(typeof(StockCurrencyStateMachine).GetProperty("ShadowReputation"));
        }

        private static string ReadModSource(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", relativePath);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "Could not locate mod/" + relativePath + " from " + AppContext.BaseDirectory);
        }
    }
}
