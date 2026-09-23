using System;
using System.Collections.Generic;
using System.Reflection;
using Gonogo.KSP.Career;
using KSP.Localization;
using Sitrep.Contract;
using Strategies;

namespace Gonogo.KSP
{
    /// <summary>
    /// Committing a stock strategy with the Administration Building shut: the
    /// gate put arm by arm, then stock's activation body reproduced by
    /// <see cref="StrategyProcedure"/>. See that type for why this is the one
    /// procedure the mod reproduces rather than asks the game to run.
    ///
    /// <para><b>Everything that can refuse is asked before anything is
    /// written</b>, in this order: the two private fields resolve, nothing has
    /// patched stock's activation, every arm of the gate answers, and each
    /// currency module a charge will reach is present. Only then does
    /// <see cref="StrategyProcedure.Run"/> start, and from its first write to its
    /// last charge there is no refusing branch left.</para>
    ///
    /// <para><b>An unanswered question is never a proceed and never a
    /// refusal.</b> A field that did not resolve, a Harmony registry that could
    /// not be read and an arm that could not be put all return
    /// <see cref="CommandErrorCode.Unreadable"/>; the game's own refusals return
    /// <see cref="CommandErrorCode.WrongState"/> in the game's own words, the
    /// same code the screen-open path gives them.</para>
    ///
    /// <para>This path runs because the operator pressed a control. Its gate is
    /// the procedure's own, asked at the moment of the write, and it is never a
    /// source of eligibility: the roster's <c>canActivate</c> stays
    /// <see cref="LiveStrategyArms.Eligibility"/>'s, which cannot say yes.</para>
    /// </summary>
    internal static class StockStrategyActivation
    {
        private delegate bool StockGate(out string reason);

        public static CommandResult Activate(Strategy strategy, StrategySystem system, double factor)
        {
            if (!StrategyPrivateFields.Resolved)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Unreadable,
                    "this build of KSP does not carry the strategy fields an activation writes, "
                        + "so none was attempted");
            }

            var patched = RefuseIfPatched(strategy);
            if (patched != null) return patched;

            return StrategyCommit.Activate(new OffScreenStrategy(strategy, system), factor);
        }

        /// <summary>
        /// A patch on either half of stock's <c>Activate()</c> is part of the
        /// procedure that a reproduction would skip. RP-1 is the career this
        /// catches: it replaces the whole activation, and its own command commits
        /// a strategy with the screen shut.
        /// </summary>
        private static CommandResult? RefuseIfPatched(Strategy strategy)
        {
            var halves = new MethodBase[]
            {
                new Func<bool>(strategy.Activate).Method,
                new StockGate(strategy.CanBeActivated).Method,
            };

            var owners = new List<string>();
            var patched = false;
            foreach (var half in halves)
            {
                var reading = HarmonyPatchProbe.Of(half);
                if (reading.State == HarmonyPatchProbe.PatchState.Unknown)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Unreadable,
                        "Harmony is installed and could not be asked whether another mod changes "
                            + "how a strategy activates, so none was attempted");
                }

                if (reading.State != HarmonyPatchProbe.PatchState.Patched) continue;

                patched = true;
                foreach (var owner in reading.Owners)
                {
                    if (!owners.Contains(owner)) owners.Add(owner);
                }
            }

            if (!patched) return null;

            var by = owners.Count > 0 ? " (" + string.Join(", ", owners) + ")" : "";
            return CommandResult.Fail(
                CommandErrorCode.NotClearToProceed,
                "another mod" + by + " changes how a strategy activates, so it can be committed "
                    + "only through that mod's own command or from inside the Administration Building");
        }

        /// <summary>
        /// The real strategy behind <see cref="IStrategyCommitTarget"/> when the
        /// screen is shut: the gate is the arm walk plus arm 1 off the roster, and
        /// the activation is <see cref="StrategyProcedure"/>.
        /// </summary>
        private sealed class OffScreenStrategy : IStrategyCommitTarget
        {
            private readonly Strategy _strategy;
            private readonly StrategySystem _system;

            public OffScreenStrategy(Strategy strategy, StrategySystem system)
            {
                _strategy = strategy;
                _system = system;
            }

            public bool HasFactorSlider => _strategy.HasFactorSlider;

            public float Factor
            {
                get => _strategy.Factor;
                set => _strategy.Factor = value;
            }

            public CommandResult Gate()
            {
                StrategyActivationRule.Verdict verdict;
                try
                {
                    verdict = LiveStrategyArms.Walk(_strategy, _system);
                }
                catch (Exception ex)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Unreadable,
                        "KSP's eligibility checks threw (" + ex.GetType().Name + "), so none was attempted");
                }

                var walked = StrategyProcedure.AtWrite(
                    verdict,
                    () => LiveStrategyArms.Wording(verdict, _strategy),
                    LiveStrategyArms.UnaskedWording);
                if (walked != null) return walked;

                var cap = ConcurrentCap();
                if (!cap.Success) return cap;

                return Unreachable() ?? CommandResult.Ok();
            }

            /// <summary>
            /// Arm 1, off the roster and the limit <c>Administration.Start</c>
            /// itself reads. See <see cref="StrategyProcedure.ConcurrentCapRefuses"/>
            /// for why the roster count equals the screen's counter here.
            ///
            /// <para>That equality holds only because <see cref="RefuseIfPatched"/>
            /// has already turned away every career that patches activation. RP-1
            /// writes the screen's counter itself and exempts leaders from the cap,
            /// so on a patched career the roster count would enforce a rule the
            /// career has replaced. The two checks are one argument: this one must
            /// never run without that one having run first.</para>
            /// </summary>
            private CommandResult ConcurrentCap()
            {
                var gameVariables = GameVariables.Instance;
                if (gameVariables == null)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.Unreadable,
                        "this career's limit on running strategies could not be read");
                }

                var limit = gameVariables.GetActiveStrategyLimit(
                    ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.Administration));

                var active = 0;
                foreach (var other in _system.Strategies)
                {
                    if (other != null && other.IsActive) active++;
                }

                return StrategyProcedure.ConcurrentCapRefuses(active, limit)
                    ? CommandResult.Fail(CommandErrorCode.WrongState, Localizer.Format("#autoLOC_304820", limit))
                    : CommandResult.Ok();
            }

            /// <summary>
            /// Every instance the procedure will dereference after its first
            /// write. Stock's arms 4-6 skip an absent currency module and its
            /// charge then dereferences it, which would leave the strategy active
            /// and uncharged; asked here, that becomes a refusal before anything
            /// changed.
            /// </summary>
            private CommandResult? Unreachable()
            {
                if (Planetarium.fetch == null) return Missing("the game clock");
                if (_strategy.InitialCostFunds != 0f && Funding.Instance == null) return Missing("funds");
                if (_strategy.InitialCostReputation != 0f && Reputation.Instance == null) return Missing("reputation");
                if (_strategy.InitialCostScience != 0f && ResearchAndDevelopment.Instance == null) return Missing("science");
                return null;
            }

            private static CommandResult Missing(string what) =>
                CommandResult.Fail(
                    CommandErrorCode.Unreadable,
                    "this career's " + what + " could not be reached, so the strategy was not activated");

            public bool Activate()
            {
                StrategyProcedure.Run(new LiveProcedure(_strategy));
                return true;
            }
        }

        private sealed class LiveProcedure : IStrategyProcedureTarget
        {
            private readonly Strategy _strategy;

            public LiveProcedure(Strategy strategy) => _strategy = strategy;

            public float InitialCostFunds => _strategy.InitialCostFunds;

            public float InitialCostReputation => _strategy.InitialCostReputation;

            public float InitialCostScience => _strategy.InitialCostScience;

            public void MarkActive() => StrategyPrivateFields.IsActive!.SetValue(_strategy, true);

            public void Register() => _strategy.Register();

            public void StampActivated() =>
                StrategyPrivateFields.DateActivated!.SetValue(_strategy, Planetarium.fetch.time);

            public void ChargeFunds(double amount) =>
                Funding.Instance.AddFunds(amount, TransactionReasons.StrategySetup);

            public void ChargeReputation(float amount) =>
                Reputation.Instance.AddReputation(amount, TransactionReasons.StrategySetup);

            public void ChargeScience(float amount) =>
                ResearchAndDevelopment.Instance.AddScience(amount, TransactionReasons.StrategySetup);
        }
    }
}
