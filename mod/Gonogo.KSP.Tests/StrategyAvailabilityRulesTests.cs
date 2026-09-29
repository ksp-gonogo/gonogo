using System;
using System.Collections.Generic;
using Gonogo.KSP;
using Gonogo.KSP.Tests.CurrencyDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The core's side of the <c>strategyAvailability</c> capability, and the
    /// wiring that makes the roster and the activate command consult it. The
    /// live callers need a scene, so the wiring is checked in their source.
    /// </summary>
    public class StrategyAvailabilityRulesTests : IDisposable
    {
        public StrategyAvailabilityRulesTests()
        {
            StrategyAvailabilityRules.Report = _ => { };
            StrategyAvailabilityRules.Bind(null);
        }

        public void Dispose()
        {
            StrategyAvailabilityRules.Report = _ => { };
            StrategyAvailabilityRules.Bind(null);
        }

        private static Kernel KernelWith(params IStrategyAvailability[] providers)
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = StrategyAvailabilityCapability.CapabilityId,
                Exclusive = false,
                SpineCritical = false,
            });
            var index = 0;
            foreach (var provider in providers)
            {
                var captured = provider;
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = StrategyAvailabilityCapability.CapabilityId,
                    Id = "provider-" + index++,
                    Factory = _ => captured,
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel;
        }

        [Fact]
        public void A_providers_refusal_is_returned_for_the_strategy_it_names()
        {
            StrategyAvailabilityRules.Bind(KernelWith(new Cooldown("leaderVonKarman", 500.0)));

            var refusal = StrategyAvailabilityRules.Refusal("leaderVonKarman");

            Assert.NotNull(refusal);
            Assert.Equal("cooling down", refusal!.Reason);
            Assert.Equal(500.0, refusal.AvailableFromUt);
            Assert.Null(StrategyAvailabilityRules.Refusal("leaderVanAllen"));
        }

        [Fact]
        public void Every_provider_is_asked_until_one_refuses()
        {
            StrategyAvailabilityRules.Bind(KernelWith(new Cooldown("a", 1.0), new Cooldown("b", 2.0)));

            Assert.Equal(2.0, StrategyAvailabilityRules.Refusal("b")!.AvailableFromUt);
        }

        [Fact]
        public void An_install_with_no_provider_or_no_kernel_refuses_nothing()
        {
            Assert.Null(StrategyAvailabilityRules.Refusal("anything"));

            StrategyAvailabilityRules.Bind(KernelWith());
            Assert.Null(StrategyAvailabilityRules.Refusal("anything"));

            StrategyAvailabilityRules.Bind(new Kernel());
            Assert.Null(StrategyAvailabilityRules.Refusal("anything"));
        }

        [Fact]
        public void A_provider_that_throws_is_reported_and_is_not_a_refusal()
        {
            var reports = new List<string>();
            StrategyAvailabilityRules.Report = reports.Add;
            StrategyAvailabilityRules.Bind(KernelWith(new Throwing(), new Cooldown("x", 3.0)));

            Assert.Null(StrategyAvailabilityRules.Refusal("y"));
            Assert.Equal(3.0, StrategyAvailabilityRules.Refusal("x")!.AvailableFromUt);
            Assert.Contains(reports, r => r.Contains("threw", StringComparison.Ordinal));
        }

        [Fact]
        public void The_career_uplink_declares_the_capability_and_binds_the_rules()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("CareerUplink.cs");

            Assert.Contains("StrategyAvailabilityCapability.CapabilityId", CurrencyDelaySourceText.MethodBody(uplink, "public void DeclareCapabilities("), StringComparison.Ordinal);
            Assert.Contains("StrategyAvailabilityRules.Bind(host.Kernel)", CurrencyDelaySourceText.MethodBody(uplink, "public void Register("), StringComparison.Ordinal);
        }

        [Fact]
        public void The_activate_command_asks_the_career_rules_before_either_activation_route()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspCareerActuator.cs"),
                "public CommandResult ActivateStrategy(");

            var asked = body.IndexOf("StrategyAvailabilityRules.Refusal(", StringComparison.Ordinal);
            Assert.True(asked >= 0, "ActivateStrategy never consults StrategyAvailabilityRules");
            Assert.True(asked < body.IndexOf("StockStrategyActivation.Activate(", StringComparison.Ordinal));
            Assert.True(asked < body.IndexOf("StrategyCommit.Activate(", StringComparison.Ordinal));
        }

        [Fact]
        public void The_deactivate_command_puts_the_gate_before_deactivating_so_its_reason_survives()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspCareerActuator.cs"),
                "public CommandResult DeactivateStrategy(");

            var gate = body.IndexOf("CanBeDeactivated(out var reason)", StringComparison.Ordinal);
            Assert.True(gate >= 0, "DeactivateStrategy never asks CanBeDeactivated for its reason");
            Assert.True(gate < body.IndexOf(".Deactivate()", StringComparison.Ordinal));
            Assert.Contains("CareerRefusals.DeactivateRefusal(reason)", body, StringComparison.Ordinal);
        }

        [Fact]
        public void The_roster_judges_every_strategy_through_the_one_ordering()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspHost.cs"),
                "private static Dictionary<string, object?> BuildStrategyEntry(");

            Assert.Contains("StrategyEligibility.Judge(", body, StringComparison.Ordinal);
            Assert.Contains("StrategyAvailabilityRules.Refusal(id)", body, StringComparison.Ordinal);
            Assert.Contains("[\"activateAvailableFromUt\"] = eligibility.AvailableFromUt", body, StringComparison.Ordinal);
        }

        private sealed class Cooldown : IStrategyAvailability
        {
            private readonly string _id;
            private readonly double _until;

            public Cooldown(string id, double until)
            {
                _id = id;
                _until = until;
            }

            public string ProviderId => "cooldown-" + _id;

            public StrategyUnavailability? Unavailable(string strategyId) =>
                strategyId == _id
                    ? new StrategyUnavailability { Reason = "cooling down", AvailableFromUt = _until }
                    : null;
        }

        private sealed class Throwing : IStrategyAvailability
        {
            public string ProviderId => "throwing";

            public StrategyUnavailability? Unavailable(string strategyId) =>
                throw new InvalidOperationException("boom");
        }
    }
}
