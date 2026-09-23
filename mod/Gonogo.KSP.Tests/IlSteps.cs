using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A method's effectful IL, read out of the loaded assembly: every call,
    /// every field access, every <c>neg</c>/<c>sub</c>, and the reason argument
    /// before each <c>Add*</c> charge.
    ///
    /// <para>For comparing our code with the game's where a decompiled
    /// rendering would be a transcription of it. KSP's bodies are obfuscated with
    /// dead <c>switch</c> loops whose constants are noise, so other loads and
    /// branches are left out.</para>
    /// </summary>
    internal static class IlSteps
    {
        private static readonly Dictionary<short, OpCode> OpCodesByValue = typeof(OpCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Select(f => (OpCode)f.GetValue(null)!)
            .ToDictionary(o => o.Value);

        public static List<string> Of(MethodBase method)
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
                else if (op == OpCodes.Call || op == OpCodes.Callvirt || op == OpCodes.Newobj)
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
