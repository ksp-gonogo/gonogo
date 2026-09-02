// A stand-in for RP-1's tooling model and the two KSP types the reading walks to
// reach it, declared in the producers' own namespaces with the producers' own
// member names, so the production walk resolves it exactly as it resolves the
// real thing.
//
// Every name and shape below was taken from an ilspycmd disassembly of the SHIPPED
// RP-1 v4.6.0.0 RP0.dll and the shipped Assembly-CSharp.dll. Two of them are
// load-bearing and are copied deliberately:
//
//   ModuleTooling is ABSTRACT and the reading recognises a tooling module by
//   assignability to it, never by a list of subclass names. A fixture that made
//   it concrete, or that only ever put the base class on a part, would let a walk
//   pass that cannot see a real subclass.
//
//   PurchaseToolingBatch takes TWO parameters, the second defaulted. Reflection
//   counts a defaulted parameter, so the arity the production lookup matches on is
//   two and a fixture declaring one would hide a real mismatch.
using System.Collections.Generic;

namespace RP0
{
    /// <summary>RP-1's tooling switch, off outside a career.</summary>
    public class ToolingManager
    {
        public static ToolingManager? Instance;

#pragma warning disable IDE1006
        public bool toolingEnabled = true;
#pragma warning restore IDE1006
    }

    /// <summary>
    /// The base every tooling module derives from. ABSTRACT, as the producer's is,
    /// so the assignability check is exercised against a subclass rather than
    /// against the base itself.
    /// </summary>
    public abstract class ModuleTooling
    {
#pragma warning disable IDE1006
        /// <summary>What the untooled surcharge actually charges, RP-1's cached value.</summary>
        public float addedCost;
#pragma warning restore IDE1006

        public virtual string ToolingType => "Tank-Conventional";

        public virtual string ToolingTypeTitle => "Conventional Tank";

        public bool Unlocked { get; set; }

        public float Cost { get; set; } = 1000f;

        public virtual string GetToolingParameterInfo() => "3.000m x 5.000m";

        public bool IsUnlocked() => Unlocked;

        public float GetToolingCost() => Cost;

        /// <summary>Every module the batch was asked to buy, in order, so a test can
        /// assert WHICH parts were tooled rather than only that something was.</summary>
        public static readonly List<ModuleTooling> Purchased = new List<ModuleTooling>();

        /// <summary>Set to make the batch throw, to pin what an operator is told.</summary>
        public static bool ThrowOnPurchase;

        /// <summary>
        /// The producer's own signature, defaulted second parameter included.
        ///
        /// <para>A test that passed <c>true</c> here would be asking for the
        /// save-purchase-reload path production refuses; the fixture records the
        /// flag so that refusal can be asserted rather than assumed.</para>
        /// </summary>
        public static float PurchaseToolingBatch(List<ModuleTooling> toolingColl, bool isSimulation = false)
        {
            if (ThrowOnPurchase)
            {
                throw new System.InvalidOperationException("tooling purchase failed");
            }
            LastBatchWasSimulation = isSimulation;
            var total = 0f;
            foreach (var module in toolingColl)
            {
                total += module.GetToolingCost();
                module.Unlocked = true;
                Purchased.Add(module);
            }
            return total;
        }

        /// <summary>Whether the last batch was asked to simulate. Production must never set it.</summary>
        public static bool LastBatchWasSimulation;
    }

    /// <summary>A concrete tooling module, because the base is abstract.</summary>
    public class ModuleToolingDiamLen : ModuleTooling
    {
    }

    /// <summary>Resizes a part to a size whose tooling is owned. Spends nothing.</summary>
    public static class ToolingPartResizer
    {
        /// <summary>Every resize asked for, so a test can assert the part and the size.</summary>
        public static readonly List<string> Resized = new List<string>();

        public static void Resize(Part p, float diameter, float length, string? targetRfType = null)
        {
            Resized.Add(
                $"{p.craftID}:{diameter:F3}x{length:F3}:{targetRfType ?? "(unchanged)"}");
        }
    }
}

/// <summary>
/// KSP's part, with only what the tooling reading walks: the module list, the
/// craft id a refit addresses it by, the symmetry counterparts a refit silently
/// takes with it, and the info carrying its title.
/// </summary>
public class Part
{
#pragma warning disable IDE1006
    public uint craftID;
    public List<Part> symmetryCounterparts = new List<Part>();
    public PartInfo? partInfo;
#pragma warning restore IDE1006

    public List<object> Modules { get; } = new List<object>();
}

/// <summary>KSP's AvailablePart, reduced to the two members read.</summary>
public class PartInfo
{
#pragma warning disable IDE1006
    public string? title;

    /// <summary>
    /// The tech node this part is waiting for, which is the whole of KSP's
    /// part-to-tech link. Empty on a part that needs nothing.
    /// </summary>
    public string TechRequired = "";
#pragma warning restore IDE1006
}

/// <summary>
/// KSP's editor. A static <c>fetch</c> that is NULL outside the editor, which is
/// the state the reading has to answer "no ship" for rather than "nothing to tool".
/// </summary>
public class EditorLogic
{
#pragma warning disable IDE1006
    public static EditorLogic? fetch;
    public ShipConstruct? ship;
#pragma warning restore IDE1006
}
