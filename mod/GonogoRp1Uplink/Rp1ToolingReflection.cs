// RP-1's tooling, read by reflection. Same arm's-length pattern as
// Rp1ScReflection, whose header carries the provenance rules this file follows.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll, and the KSP members out of the shipped
// Assembly-CSharp.dll.
//
// WHAT TOOLING IS, because the wire shape only makes sense against it. RP-1 keeps
// a CAREER-GLOBAL database keyed on a tooling TYPE string and an ordered tuple of
// float parameters, held as a tree one level deep per parameter. It is not
// per-part, not per-variant and not per-configuration: two parts of different
// sizes share one tooling whenever their type matches and every parameter is
// within FOUR PERCENT, so tooling one part can leave a neighbour free.
//
// THE PRICE COMES OFF A CACHED FIELD, AND THE OBVIOUS ROUTE IS A TRAP.
// SpaceCenterManagement.EditorToolingCosts is a public static double that RP-1
// keeps current from its own editor-ship-modified handler, and it already holds
// the deduplicated Tool-All total. The route RP-1's own window takes is
// ToolingGUI.GetUntooledPartsAndCost, which calls
// ModuleTooling.PurchaseToolingBatch(parts, isSimulation: true) -- and that
// "simulation" SAVES the tooling database to a ConfigNode, PERFORMS EVERY
// PURCHASE FOR REAL, then reloads from the node. One throw between the save and
// the reload leaves the career's tooling bought. It is a mutation wearing a
// simulation's name and nothing here may call it. The cached field is not a
// convenience, it is the only safe reading of that number.
//
// A NAIVE SUM IS NOT THE SAME NUMBER, which is why RP-1 simulates at all:
// purchasing one part's tooling can unlock a second part for free, so adding up
// each part's own cost OVERSTATES the total. Both figures are published and they
// are different questions, so they are named differently on the wire.
//
// TWO THINGS THIS DELIBERATELY DOES NOT PUBLISH, each because there is no uniform
// way to read it rather than because it was not wanted:
//
//   the numeric parameter TUPLE
//       ModuleTooling exposes no accessor for it. Every concrete subclass
//       computes its own tuple inside its own cost function: the DiamLen family
//       uses (diameter, length) and ModuleToolingProcAvionics uses
//       (controllableMass, diameter, length) off a member that is private. What
//       IS uniform is GetToolingParameterInfo(), a virtual whose ProcAvionics
//       override composes the mass onto the base rendering, so the STRING is
//       variable-length by construction and is the producer's own. Reproducing
//       the tuple would mean mirroring RP-1's type hierarchy and would silently
//       misreport the day a subclass adds a parameter.
//   the tooling LEVEL, N of M
//       same cause. ToolingDatabase.GetToolingLevel is public and would answer it,
//       but only if handed the RIGHT tuple, and asking it with the two-parameter
//       tuple against a three-parameter type returns a confidently wrong level.
//       The base class offers only IsUnlocked(). The economics of a PARTIAL
//       tooling are still visible, in the number that matters: GetToolingCost
//       adds the diameter component only at level zero, so a part that is half
//       tooled quotes a lower price to finish.
//
// MEMBERS DELIBERATELY NOT CALLED, and why:
//
//   ToolingGUI.GetUntooledPartsAndCost, ModuleTooling.PurchaseToolingBatch
//       see above. The pricing path is a write.
//   ModuleTooling.ToolingEvent
//       the per-part PAW button. It purchases one part's tooling through the
//       game's own event plumbing; the command path constructs its own list.
//   ToolingPartResizer.PawTarget
//       reads which part-action window the player has open. That is the GUI's
//       dependency and not the API's: Resize takes a Part, so a command addresses
//       a part itself and never reads panel state. Keeping those apart is the
//       whole point of the window ratchet.
using System;
using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Resolves RP-1's tooling model by reflection and reads one tick of it into
    /// <see cref="Rp1ToolingRaw"/>. Nothing here touches KSP or Unity at compile
    /// time, so it runs headless against a stand-in object graph.
    /// </summary>
    public sealed class Rp1ToolingReflection
    {
        private const string ManagerTypeName = "RP0.ToolingManager";

        private const string ModuleToolingTypeName = "RP0.ModuleTooling";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";

        private const string EditorLogicTypeName = "EditorLogic";

        private const string DatabaseTypeName = "RP0.ToolingDatabase";

        private const string ParametersTypeName = "RP0.Tooling.Parameters";

        private const string ResizerTypeName = "RP0.ToolingPartResizer";

        private const string PartTypeName = "Part";

        private readonly Type? _manager;

        private readonly Type? _moduleTooling;

        private readonly Type? _scm;

        private readonly Type? _editor;

        private readonly Type? _database;

        private readonly Type? _parameters;

        private readonly Type? _resizer;

        /// <summary>
        /// The funds half, read on this walk rather than its own, so the surcharge
        /// it reports is the sum of the rows this reading produced.
        /// </summary>
        private readonly Rp1CareerCostReflection _cost = new Rp1CareerCostReflection();

        public Rp1ToolingReflection()
        {
            _manager = Rp1Types.Find(ManagerTypeName);
            _moduleTooling = Rp1Types.Find(ModuleToolingTypeName);
            _scm = Rp1Types.Find(ScmTypeName);
            _editor = Rp1Types.Find(EditorLogicTypeName);
            _database = Rp1Types.Find(DatabaseTypeName);
            _parameters = Rp1Types.Find(ParametersTypeName);
            _resizer = Rp1Types.Find(ResizerTypeName);
        }

        /// <summary>
        /// RP-1's tooling manager AND its part-module base resolved. Both, because
        /// the reading needs one to know whether tooling is switched on at all and
        /// the other to recognise a tooled part.
        /// </summary>
        public bool IsAvailable => _manager != null && _moduleTooling != null;

        /// <summary>
        /// The editor ship's tooling state, or NULL when there is nothing to say.
        ///
        /// <para>Null covers three different situations and none of them is "every
        /// part is tooled": no editor ship, RP-1's tooling switched off, or the
        /// manager not live. That last matters most. <c>GetToolingLevel</c>
        /// short-circuits to FULLY TOOLED when <c>toolingEnabled</c> is false, so a
        /// reading taken outside a career would report a ship with nothing left to
        /// tool. That is an absence dressed as a yes, and the channel says nothing
        /// instead.</para>
        /// </summary>
        public Rp1ToolingRaw? Read(double ut)
        {
            if (!IsAvailable || !ToolingEnabled())
            {
                return null;
            }

            var parts = EditorParts();
            if (parts == null)
            {
                return null;
            }

            var raw = new Rp1ToolingRaw { Ut = ut, ToolAllCost = ToolAllCost() };
            double? surcharge = null;
            /*
             * One merge per tooling type per tick, not per part. Several parts on a
             * vessel share a type, and GetMergedEntries rebuilds the tree each
             * call; RP-1's own window caches it against ToolingDatabase.Generation
             * for the same reason. A tick's worth is enough here: nothing can buy
             * a tooling between two parts of one walk.
             */
            var ownedByType = new Dictionary<string, List<object>?>(StringComparer.Ordinal);
            foreach (var part in parts)
            {
                foreach (var module in ToolingModules(part))
                {
                    var row = Describe(part, module, ownedByType);
                    if (row == null)
                    {
                        continue;
                    }
                    raw.Parts.Add(row);
                    if (row.UntooledSurcharge != null)
                    {
                        surcharge = (surcharge ?? 0.0) + row.UntooledSurcharge.Value;
                    }
                }
            }

            // Summed from the rows just read rather than asked for separately, so
            // the breakdown's "of which" line and the rows it is of cannot
            // disagree. Null when no row carried one, which is not the same as a
            // vehicle whose surcharge is zero.
            raw.BuildCost = _cost.ReadCost(ut);
            if (raw.BuildCost != null)
            {
                raw.BuildCost.UntooledSurcharge = surcharge;
            }
            return raw;
        }

        /// <summary>
        /// Whether RP-1 is applying tooling at all. False outside a career, where
        /// its own level lookup answers "tooled" for everything.
        /// </summary>
        private bool ToolingEnabled()
        {
            var instance = _manager == null ? null : Rp1Types.StaticValue(_manager, "Instance");
            return Rp1Types.ReadBool(instance, "toolingEnabled") == true;
        }

        /// <summary>
        /// RP-1's own deduplicated Tool-All total, off the field it caches it in.
        /// See this file's header for why the window's route is not taken.
        /// </summary>
        private double? ToolAllCost() =>
            _scm == null ? null : Rp1Types.ToDouble(Rp1Types.StaticValue(_scm, "EditorToolingCosts"));

        /// <summary>The parts of the ship on the editor's table, or null when there is none.</summary>
        private IEnumerable<object>? EditorParts()
        {
            var fetch = _editor == null ? null : Rp1Types.StaticValue(_editor, "fetch");
            var ship = Rp1Types.Member(fetch, "ship");
            var parts = Rp1Types.Member(ship, "Parts");
            return parts == null ? null : Rp1Types.Enumerate(parts);
        }

        /// <summary>
        /// Every tooling module on a part, recognised by ASSIGNABILITY to RP-1's
        /// own base rather than by a list of subclass names.
        /// </summary>
        /// <remarks>
        /// RP-1 uses <c>FindModulesImplementing&lt;ModuleTooling&gt;</c>, which is
        /// generic and so is awkward to reach by reflection; walking
        /// <c>Part.Modules</c> and asking the base type is the same question asked
        /// the other way round. Naming the six subclasses instead would go quietly
        /// blind on the seventh.
        /// </remarks>
        private IEnumerable<object> ToolingModules(object part)
        {
            foreach (var module in Rp1Types.Enumerate(Rp1Types.Member(part, "Modules")))
            {
                if (_moduleTooling!.IsInstanceOfType(module))
                {
                    yield return module;
                }
            }
        }

        /// <summary>
        /// One tooling module, flattened. Null when the module answers nothing at
        /// all, which is a module whose shape is not the one this was read against.
        /// </summary>
        private Rp1ToolingPartRaw? Describe(
            object part,
            object module,
            Dictionary<string, List<object>?> ownedByType)
        {
            var type = Rp1Types.ReadString(module, "ToolingType");
            if (type == null)
            {
                return null;
            }

            var tooled = Invoke(module, "IsUnlocked") as bool?;
            var refittable = HasModule(part, "ModuleROTank") || HasModule(part, "ProceduralPart");

            return new Rp1ToolingPartRaw
            {
                PartTitle = Rp1Types.ReadString(Rp1Types.Member(part, "partInfo"), "title"),
                ToolingType = type,
                ToolingTypeTitle = EmptyAsAbsent(Rp1Types.ReadString(module, "ToolingTypeTitle")),
                ParameterSummary = EmptyAsAbsent(Invoke(module, "GetToolingParameterInfo") as string),
                Tooled = tooled,
                ToolingCost = Rp1Types.ToDouble(Invoke(module, "GetToolingCost")),

                // RP-1's own cached surcharge rather than the one-line formula
                // behind it. GetUntooledPenaltyCost is protected, and `addedCost`
                // is what its IPartCostModifier actually charges the vessel, so
                // reading the field reports what is billed rather than what we
                // think should be.
                UntooledSurcharge = Rp1Types.ToDouble(Rp1Types.Member(module, "addedCost")),

                PartId = Rp1Types.Member(part, "craftID")?.ToString(),

                // Said BEFORE the press rather than after it. RP-1's own refit
                // resizes every symmetry counterpart and tells you how many
                // afterwards, in a screen message. A console can put the number
                // beside the control instead, which is the same disclosure at the
                // moment it can still change the answer.
                SymmetryCounterparts = Count(Rp1Types.Member(part, "symmetryCounterparts")),

                // A refit reshapes through ModuleROTank or ProceduralPart and
                // silently does nothing on a part with neither. Answered here so a
                // control can be dark rather than inert.
                Refittable = refittable,

                // Only for the part a refit is FOR: one that is refittable and not
                // already tooled. A tooled part has nothing to close, and the walk
                // below costs a PickRfType call per owned size, so asking it for
                // every part on the vessel every tick would buy nothing.
                RefitTargets = refittable && tooled == false
                    ? RefitTargets(part, type, ownedByType)
                    : null,
            };
        }

        /// <summary>
        /// The owned sizes this part could be reshaped to, as RP-1's own window
        /// offers them.
        ///
        /// <para><b>What makes a row offerable, read out of
        /// <c>ToolingGUI.DisplayRow</c>.</b> RP-1 draws a Refit press only on a
        /// LEAF of the owned-tooling tree, only for a type whose parameter tuple is
        /// two long, and only when <c>PickRfType</c> answers with a material the
        /// part can actually use: a part that cannot use any material the tooling
        /// covers gets a dark button and a sentence about tech locks. Each of those
        /// three is applied here, so a row that reaches the wire is one RP-1 would
        /// have pressed.</para>
        ///
        /// <para><b>The bound, stated rather than hidden.</b> This merges the
        /// part's OWN tooling type and nothing else, so the sizes offered are the
        /// ones owned for the material the part already is. RP-1's window merges a
        /// whole BUCKET of types, which is what lets it offer a refit onto another
        /// material's tooling, and the bucketing is
        /// <c>ToolingGUI.GetGroupingKey</c>: a ten-branch private over tooling-type
        /// name prefixes. Transcribing a GUI private to widen a picker is not a
        /// trade worth making blind, and the narrow answer is a true subset rather
        /// than a wrong one.</para>
        ///
        /// <para>The parameter count is ASKED rather than assumed, through RP-1's
        /// own public <c>Parameters.GetParametersForToolingType</c>. Its rule today
        /// is "three for Avionics-, two for everything else", and a copy of that
        /// would go quietly wrong the day a third family arrives.</para>
        /// </summary>
        private List<Rp1ToolingRefitTargetRaw>? RefitTargets(
            object part,
            string toolingType,
            Dictionary<string, List<object>?> ownedByType)
        {
            if (_resizer == null || ParameterCount(toolingType) != 2)
            {
                return null;
            }

            if (!ownedByType.TryGetValue(toolingType, out var owned))
            {
                owned = MergedEntries(toolingType);
                ownedByType[toolingType] = owned;
            }
            if (owned == null)
            {
                return null;
            }

            var pick = Rp1Types.StaticMethodOn(_resizer, "PickRfType", PartTypeName, 2);
            if (pick == null)
            {
                return null;
            }

            var targets = new List<Rp1ToolingRefitTargetRaw>();
            foreach (var diameter in owned)
            {
                var diameterValue = Rp1Types.ToDouble(Rp1Types.Member(diameter, "Value"));
                if (diameterValue == null)
                {
                    continue;
                }
                foreach (var length in Rp1Types.Enumerate(Rp1Types.Member(diameter, "Children")))
                {
                    var lengthValue = Rp1Types.ToDouble(Rp1Types.Member(length, "Value"));
                    var sources = Rp1Types.Member(length, "Sources");
                    if (lengthValue == null || sources == null)
                    {
                        continue;
                    }

                    string? rfType;
                    try
                    {
                        rfType = pick.Invoke(null, new[] { part, sources }) as string;
                    }
                    catch (Exception)
                    {
                        continue;
                    }
                    if (string.IsNullOrEmpty(rfType))
                    {
                        continue;
                    }

                    targets.Add(new Rp1ToolingRefitTargetRaw
                    {
                        Diameter = diameterValue.Value,
                        Length = lengthValue.Value,
                        RfType = rfType,
                    });
                }
            }
            return targets;
        }

        /// <summary>
        /// How many parameters a tooling of this type is keyed on, asked of RP-1
        /// rather than derived from the type's name.
        /// </summary>
        private int? ParameterCount(string toolingType)
        {
            var method = _parameters == null
                ? null
                : Rp1Types.StaticMethod(_parameters, "GetParametersForToolingType", 1);
            if (method == null)
            {
                return null;
            }
            try
            {
                var count = 0;
                foreach (var _ in Rp1Types.Enumerate(method.Invoke(null, new object?[] { toolingType })))
                {
                    count++;
                }
                return count;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The owned toolings for one type, as the tree RP-1's own window walks:
        /// the first parameter's entries at the top, each carrying the second's as
        /// children.
        /// </summary>
        /// <remarks>
        /// <c>GetMergedEntries</c> rather than the raw <c>toolings</c> dictionary,
        /// because it is the call that populates each leaf's <c>Sources</c>, and
        /// <c>Sources</c> is what the material picker needs. Reading the dictionary
        /// directly would give the same sizes with no way to tell whether the part
        /// can use any of them.
        /// </remarks>
        private List<object>? MergedEntries(string toolingType)
        {
            var method = _database == null
                ? null
                : Rp1Types.StaticMethod(_database, "GetMergedEntries", 1);
            if (method == null)
            {
                return null;
            }
            try
            {
                var merged = method.Invoke(null, new object?[] { new List<string> { toolingType } });
                return merged == null ? null : new List<object>(Rp1Types.Enumerate(merged));
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// A parameterless method on a tooling module.
        /// </summary>
        /// <remarks>
        /// All three reached this way are pure: <c>IsUnlocked</c> and
        /// <c>GetToolingCost</c> read the tooling tree and do arithmetic,
        /// <c>GetToolingParameterInfo</c> formats two floats. None writes, and none
        /// is the batch pricing call this file's header refuses.
        /// </remarks>
        private static object? Invoke(object module, string name)
        {
            try
            {
                return Rp1Types.InstanceMethod(module, name, 0)?.Invoke(module, null);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>How many are in one of the game's collections.</summary>
        private static int Count(object? collection)
        {
            if (collection == null)
            {
                return 0;
            }
            var n = 0;
            foreach (var _ in Rp1Types.Enumerate(collection))
            {
                n++;
            }
            return n;
        }

        /// <summary>Whether the part carries a module with this name.</summary>
        private static bool HasModule(object part, string moduleName)
        {
            foreach (var module in Rp1Types.Enumerate(Rp1Types.Member(part, "Modules")))
            {
                if (string.Equals(module.GetType().Name, moduleName, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private static string? EmptyAsAbsent(string? value) =>
            string.IsNullOrEmpty(value) ? null : value;
    }
}
