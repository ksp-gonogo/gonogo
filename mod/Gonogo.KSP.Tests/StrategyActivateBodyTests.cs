using System;
using System.Reflection;
using Strategies;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// What the installed <c>Strategy.Activate()</c> actually does, read out of
    /// its IL, so the reproduction in <c>StrategyProcedure</c> is compared with
    /// the game rather than with a transcription of it.
    ///
    /// <para>A KSP build that reorders the body, adds a step, charges through a
    /// different adder or under a different <c>TransactionReasons</c> turns this
    /// red. Without it the reproduction would keep doing the old thing, and a
    /// career would be charged differently from one activated on the screen with
    /// nothing to say so.</para>
    ///
    /// <para>Only the steps with an effect are compared: every call, every field
    /// access, the negation that makes each cost a deduction, and the reason
    /// each charge is filed under. The body is obfuscated with dead
    /// <c>switch</c> loops whose constants are noise, so other loads and branches
    /// are left out.</para>
    /// </summary>
    public class StrategyActivateBodyTests
    {
        /// <summary>
        /// Stock's body, as <c>StrategyProcedure.Run</c> reproduces it. Each cost
        /// getter appears twice because stock reads it once for the nonzero test
        /// and again for the charge.
        /// </summary>
        private static readonly string[] StockSteps =
        {
            "call Strategy.CanBeActivated",
            "stfld Strategy.isActive",
            "call Strategy.Register",
            "ldsfld Planetarium.fetch",
            "ldfld Planetarium.time",
            "stfld Strategy.dateActivated",
            "call Strategy.get_InitialCostFunds",
            "ldsfld Funding.Instance",
            "call Strategy.get_InitialCostFunds",
            "call Mathf.Abs",
            "neg",
            "callvirt Funding.AddFunds reason=512",
            "call Strategy.get_InitialCostReputation",
            "ldsfld Reputation.Instance",
            "call Strategy.get_InitialCostReputation",
            "call Mathf.Abs",
            "neg",
            "callvirt Reputation.AddReputation reason=512",
            "call Strategy.get_InitialCostScience",
            "ldsfld ResearchAndDevelopment.Instance",
            "call Strategy.get_InitialCostScience",
            "call Mathf.Abs",
            "neg",
            "callvirt ResearchAndDevelopment.AddScience reason=512",
        };

        [Fact]
        public void StrategySetupIsStillTheReasonTheChargesAreFiledUnder()
        {
            Assert.Equal(512, (int)TransactionReasons.StrategySetup);
        }

        [Fact]
        public void StocksActivateBodyIsTheOneReproduced()
        {
            var activate = typeof(Strategy).GetMethod("Activate", BindingFlags.Public | BindingFlags.Instance, Type.EmptyTypes)!;

            Assert.Equal(StockSteps, IlSteps.Of(activate));
        }

        /// <summary>
        /// The decoder has to be able to fail, or a green run says nothing: a
        /// different method's body must not read as <c>Activate</c>'s.
        /// </summary>
        [Fact]
        public void DeactivatesBodyDoesNotReadAsActivates()
        {
            var deactivate = typeof(Strategy).GetMethod("Deactivate", BindingFlags.Public | BindingFlags.Instance, Type.EmptyTypes)!;

            var steps = IlSteps.Of(deactivate);

            Assert.NotEqual(StockSteps, steps);
            Assert.Contains("call Strategy.CanBeDeactivated", steps);
        }
    }
}
