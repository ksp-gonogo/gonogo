using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;
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
        private static readonly Dictionary<short, OpCode> OpCodesByValue = typeof(OpCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Select(f => (OpCode)f.GetValue(null)!)
            .ToDictionary(o => o.Value);

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

            Assert.Equal(StockSteps, Steps(activate));
        }

        /// <summary>
        /// The decoder has to be able to fail, or a green run says nothing: a
        /// different method's body must not read as <c>Activate</c>'s.
        /// </summary>
        [Fact]
        public void DeactivatesBodyDoesNotReadAsActivates()
        {
            var deactivate = typeof(Strategy).GetMethod("Deactivate", BindingFlags.Public | BindingFlags.Instance, Type.EmptyTypes)!;

            var steps = Steps(deactivate);

            Assert.NotEqual(StockSteps, steps);
            Assert.Contains("call Strategy.CanBeDeactivated", steps);
        }

        private static List<string> Steps(MethodInfo method)
        {
            var il = method.GetMethodBody()!.GetILAsByteArray()!;
            var module = method.Module;
            var steps = new List<string>();
            int? lastInt = null;

            var i = 0;
            while (i < il.Length)
            {
                OpCode op;
                if (il[i] == 0xFE)
                {
                    op = OpCodesByValue[(short)(0xFE00 | il[i + 1])];
                    i += 2;
                }
                else
                {
                    op = OpCodesByValue[il[i]];
                    i += 1;
                }

                var operandAt = i;
                i += OperandSize(op, il, i);

                if (op.Value >= OpCodes.Ldc_I4_M1.Value && op.Value <= OpCodes.Ldc_I4_8.Value)
                {
                    lastInt = op.Value - OpCodes.Ldc_I4_0.Value;
                }
                else if (op == OpCodes.Ldc_I4_S)
                {
                    lastInt = (sbyte)il[operandAt];
                }
                else if (op == OpCodes.Ldc_I4)
                {
                    lastInt = BitConverter.ToInt32(il, operandAt);
                }
                else if (op == OpCodes.Call || op == OpCodes.Callvirt)
                {
                    var callee = module.ResolveMethod(BitConverter.ToInt32(il, operandAt))!;
                    var step = op.Name + " " + callee.DeclaringType!.Name + "." + callee.Name;
                    if (callee.Name.StartsWith("Add", StringComparison.Ordinal)) step += " reason=" + lastInt;
                    steps.Add(step);
                }
                else if (op == OpCodes.Sub || op == OpCodes.Neg)
                {
                    steps.Add(op.Name!);
                }
                else if (op == OpCodes.Stfld || op == OpCodes.Ldfld || op == OpCodes.Ldsfld || op == OpCodes.Stsfld)
                {
                    var field = module.ResolveField(BitConverter.ToInt32(il, operandAt))!;
                    steps.Add(op.Name + " " + field.DeclaringType!.Name + "." + field.Name);
                }
            }

            return steps;
        }

        private static int OperandSize(OpCode op, byte[] il, int at)
        {
            switch (op.OperandType)
            {
                case OperandType.InlineNone:
                    return 0;
                case OperandType.ShortInlineBrTarget:
                case OperandType.ShortInlineI:
                case OperandType.ShortInlineVar:
                    return 1;
                case OperandType.InlineVar:
                    return 2;
                case OperandType.InlineI8:
                case OperandType.InlineR:
                    return 8;
                case OperandType.InlineSwitch:
                    return 4 + 4 * BitConverter.ToInt32(il, at);
                default:
                    return 4;
            }
        }
    }
}
