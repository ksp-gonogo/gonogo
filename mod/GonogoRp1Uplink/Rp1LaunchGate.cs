// RP-1's launch rules, read by reflection and answered as command-gate verdicts.
// No compile-time reference to RP0.dll, same arm's-length pattern as
// Rp1ScReflection, whose header carries the provenance rules this file follows.
//
// WHAT WAS WRONG. `ksp.launch` loads a saved .craft file and hands it to
// FlightDriver.StartWithNewLaunch. Stock is entitled to accept that, because in
// stock a craft file IS a launchable article the moment it is saved, and the
// stock launch tests LaunchPreflight runs all pass. Under RP-1 it is a design:
// the article that flies is a VesselProject a launch complex INTEGRATED over
// weeks and then ROLLED OUT to a pad, and the envelope it flies inside belongs to
// that complex rather than to the pad's tier. Dispatched against a live RP-1
// career the command answered success and put a V-2 on the pad with an empty
// build queue, no launch complex occupied and funds unchanged.
//
// RP-1 blocks its own equivalent: PatchLaunchSiteFacility's prefix refuses
// LaunchSiteFacility.showShipSelection outright while KCT is enabled, so the
// stock pad's craft picker never opens. That patch is a UI hook and there is no
// UI here, which is exactly why this file exists.
//
// WHY THE LIMITS ARE HERE TOO, and not left to LaunchPreflight. Under RP-1 the
// authority on craft mass and size is not the pad. VesselProject
// .MeetsFacilityRequirements measures the vehicle against LaunchComplex.Stats:
// massMax, MassMin, sizeMax, isHumanRated, launch clamps in a hangar, and the
// complex's stocked resources. RP-1 does NOT patch GameVariables
// .GetCraftMassLimit / .GetCraftSizeLimit, it only calls them (in
// PatchEngineersReport and in KCTUtilities.LoadPadData). So stock's pad-tier
// numbers still answer, and under RP-1's own CustomBarnKit config they are
// 18 t / 140 t / unlimited by pad tier, which is a different question from the one
// RP-1 asks. LaunchPreflight keeps running those tests, and this file adds the
// ones the install actually flies by.
//
// RP-1 CAN ANSWER FROM THE SHIP NAME ALONE, and stock cannot, which is the whole
// reason this split falls where it does. The mass, size and human-rating of the
// article are recorded ON the VesselProject when it is integrated, so naming the
// vehicle is enough. Stock has no stored article, so its equivalents need the
// craft file loaded and a ShipTemplate built, which is why they stay in the
// handler where the load already happens.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// INSTALLED RP-1 v4.6.0.0 RP0.dll (GameData/RP-1/Plugins/RP0.dll on the test
// rig). Nothing here has been seen in a running game; the disassembly verifies
// SHAPE and never VALUE, so every lookup is null-safe per hop and every failure
// to read degrades to Unknown, never to a pass.
//
// THE RULES, as KCT_GUI.RenderBuildListVessel, ProcessRocketLaunch and
// VesselProject.MeetsFacilityRequirements enforce them:
//
//   INTEGRATED: a VesselProject of this name in some LaunchComplex.Warehouse.
//   WITHIN THE COMPLEX'S LIMITS: mass at or under LC.MassMax and at or over
//     LC.MassMin, every axis of the vehicle's size within LC.SizeMax, the complex
//     human-rated if the vehicle is, and no launch clamps on a hangar vehicle.
//   ROLLED OUT (pad complexes only): the complex IsOperational; a
//     ReconRolloutProject in its Recon_Rollout whose associatedID is the
//     vehicle's shipID, whose RRType is Rollout, and which is complete; the
//     LCLaunchPad named by that project's launchPadID present, not destroyed and
//     operational; and no reconditioning running on it. A HANGAR vehicle taxis
//     out: KCT_GUI's hangar branch draws Launch with no rollout at all.
//
// WHAT IS READ, and why each is safe to read:
//
//   SpaceCenterManagement.Instance    static; the scenario module itself
//   .enabledForSave                   plain bool field
//   .KSCs / .LaunchComplexes          [Persistent] lists
//   LaunchComplex.Name/.IsOperational plain fields
//   LaunchComplex.LCType/.MassMax/.SizeMax/.IsHumanRated
//                                     one-line reads of the _lcData struct
//   LaunchComplex.MassMin             LCData.CalcMassMin: floor(massMax * a
//                                     settings fraction), pure
//   .Warehouse / .BuildList           [Persistent] lists of VesselProject
//   .Recon_Rollout / .LaunchPads      [Persistent] lists
//   VesselProject.shipName/.shipID/.mass/.ShipSize/.humanRated/.clampState
//                                     plain [Persistent] fields
//   ReconRolloutProject.associatedID/.RRType/.launchPadID/.progress/.BP
//                                     plain fields, .BP and .progress declared
//                                     on LCOpsProject
//   ReconRolloutProject.IsReversed    pure on both shipped implementations
//   LCLaunchPad.name/.isOperational   plain fields
//   LCLaunchPad.IsDestroyed           reads its own DestructionNode
//
// NOTHING IS INVOKED, and two getters are deliberately gone round:
//
//   VesselProject.GetShipSize() falls back to decompressing the ship node,
//   building a ShipTemplate, WRITING the ShipSize field and re-compressing. The
//   field it writes is [Persistent] and is already populated for a vehicle that
//   has been integrated, so the field is read and a zero vector is treated as a
//   size nobody recorded rather than as a vehicle of no size.
//   LCOpsProject.IsComplete() is `IsReversed ? progress <= 0 : progress >= BP`
//   over fields already read here, so the derivation is written out instead. The
//   rest of that class is off limits for the reason Rp1ScReflection's header
//   gives: GetTimeLeft / GetBuildRate reach LCEfficiency
//   .GetOrCreateEfficiencyForLC, which on a cache miss appends to a [Persistent]
//   list, and a gate must not write to the player's save.
//   LCLaunchPad.State is pure and vouched for there, but it cannot tell a rollout
//   in progress from a finished one (a completed Rollout stays in Recon_Rollout,
//   which is what keeps the pad occupied), so the walk finds the project itself.
//
// WHAT IS NOT REPRODUCED, and why. MeetsFacilityRequirements' last arm is
// ResourcesOK, which compares each of the vehicle's resourceAmounts against the
// complex's resourcesHandled. Its exemption arm needs
// PartResourceLibrary.Instance.GetDefinition(name).density, a KSP read, and this
// assembly deliberately holds no KSP dependency at all, which is what lets every
// rule here be exercised headlessly. So a launch whose complex is short of a fuel
// is permitted here and would be refused by RP-1's own build list. That is the
// one arm of RP-1's launch check this gate does not make.
//
// TWO MORE PLACES THIS IS DELIBERATELY MORE PERMISSIVE THAN RP-1, both so a
// refusal is never something an operator cannot act on:
//
//   VesselProject.AllPartsValid is NOT read. RP-1 hides a vehicle whose parts no
//   longer exist; that is a broken craft rather than an unready one, and stock's
//   own launch path has its own answer for it.
//   A pad's reconditioning is matched on RRType. RP-1's own GetReconditioning
//   compares GetItemName() to the literal "LaunchPad Reconditioning", and that
//   name comes back through Localizer, so RP-1 silently matches nothing outside
//   English. The RRType is the same set in English and the right one everywhere.
using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The launch conditions RP-1 imposes, contributed to <c>ksp.launch</c> and
    /// evaluated against RP-1's live space-centre model.
    ///
    /// <para>Contributed rather than elected. Preconditions compose: RP-1's are
    /// added to the ones core already declares, they do not displace them, and a
    /// second mod that imposes its own launch condition adds more rather than
    /// winning an election that would have dropped one set.</para>
    ///
    /// <para>Nothing here touches KSP or Unity, so it compiles and runs headless
    /// against a stand-in object graph, which is the only way a launch refusal
    /// can be watched happening without a career save to hand.</para>
    /// </summary>
    public sealed class Rp1LaunchGate : ICommandGateEvaluator
    {
        /// <summary>
        /// The requirement kind this answers. Namespaced to this Uplink because a
        /// kind may only be claimed once across the whole engine, and a bare
        /// "launch" is a name the next mod to model one would also want.
        /// </summary>
        public const string GateKind = "rp1.launch";

        /// <summary>There is a finished vehicle of this name in a launch complex's warehouse.</summary>
        public const string Integrated = "integrated";

        /// <summary>It is inside the envelope its own launch complex can fly.</summary>
        public const string WithinComplexLimits = "withinComplexLimits";

        /// <summary>It is standing on a pad that can launch it.</summary>
        public const string RolledOut = "rolledOut";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";

        private readonly Type? _scm;

        public Rp1LaunchGate()
        {
            _scm = Rp1Types.Find(ScmTypeName);
        }

        /// <summary>
        /// RP-1 is installed, decided on the TYPE resolving for the reason
        /// <see cref="Rp1ScReflection"/>'s own probe gives. False means the
        /// requirements are never contributed at all, so <c>ksp.launch</c> keeps
        /// exactly the requirements core declares and the stock launch path is
        /// byte-for-byte what it was.
        /// </summary>
        public bool IsAvailable => _scm != null;

        /// <summary>
        /// The requirements to contribute, in the order they should be evaluated.
        /// Integration first, because a vehicle nobody has built cannot be
        /// anywhere and "it has not been rolled out" is a confusing thing to say
        /// about one that does not exist. Limits next, because RP-1 will not roll
        /// out a vehicle that fails them, so a rollout refusal on a vehicle that
        /// is simply too heavy would name the wrong problem.
        /// </summary>
        /// <remarks>
        /// Every one names <c>shipName</c> in <see cref="CommandRequirement.Needs"/>.
        /// These are properties of a VEHICLE, so the engine abstains for the
        /// addressability sample rather than reaching an evaluator that would have
        /// to invent a subject. Abstain leaves the control live, which is the
        /// honest advance answer: core's own launch requirements are still
        /// evaluated first and still darken it when the pad is occupied.
        /// </remarks>
        public static IEnumerable<CommandRequirement> Requirements()
        {
            yield return Requirement(Integrated);
            yield return Requirement(WithinComplexLimits);
            yield return Requirement(RolledOut);
        }

        private static CommandRequirement Requirement(string quantity) => new CommandRequirement
        {
            Kind = GateKind,
            Quantity = quantity,
            Needs = new[] { "shipName" },
        };

        public string Kind => GateKind;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var quantity = requirement?.Quantity ?? "";
            if (quantity != Integrated && quantity != WithinComplexLimits && quantity != RolledOut)
            {
                return GateVerdict.Unknown($"RP-1 imposes no launch condition called \"{quantity}\"");
            }

            var shipName = Argument(arguments, "shipName");
            if (shipName == null)
            {
                // Unreachable while the requirement declares its Needs, and
                // Unknown rather than Pass if it ever is: an unanswerable
                // question is not a satisfied one.
                return GateVerdict.Unknown("the launch named no craft, so RP-1 has nothing to look for");
            }

            var scm = ScmInstance();
            if (scm == null)
            {
                // RP-1 is installed and its scenario module is not there. In a
                // loaded game that means the scene has not finished coming up,
                // which is a read that failed rather than a fact about the save,
                // and the facility gates learned the hard way that those two want
                // opposite answers.
                return GateVerdict.Unknown("RP-1's space centre is not loaded");
            }

            var enabled = Rp1Types.ReadBool(scm, "enabledForSave");
            if (enabled == null)
            {
                return GateVerdict.Unknown("could not read whether RP-1 manages this save");
            }
            if (enabled == false)
            {
                // A save RP-1 does not manage has no build economy to step around
                // and no launch complexes to fly inside, so there is genuinely
                // nothing outstanding. A real reading rather than a shrug: RP-1
                // declines to run here and says so in its own field.
                return GateVerdict.Pass();
            }

            Vehicle? vehicle;
            try
            {
                vehicle = FindVehicle(scm, shipName, Argument(arguments, "facility"));
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read RP-1's launch complexes: " + ex.Message);
            }

            switch (quantity)
            {
                case Integrated: return Integration(vehicle, shipName);
                case WithinComplexLimits: return WithinLimits(vehicle, shipName);
                default: return Rollout(vehicle, shipName);
            }
        }

        /// <summary>
        /// Is there a finished vehicle of this name to fly.
        /// </summary>
        /// <remarks>
        /// The two refusals are deliberately different sentences under one code:
        /// "still being integrated" is a wait, "never built" is a job to start,
        /// and an operator does opposite things about them.
        /// </remarks>
        private static GateVerdict Integration(Vehicle? vehicle, string shipName)
        {
            if (vehicle == null)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady,
                    $"no vehicle called \"{shipName}\" has been built or is being built at any launch complex");
            }
            if (!vehicle.Finished)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady,
                    $"\"{shipName}\" is still being integrated at {vehicle.ComplexName}");
            }
            return GateVerdict.Pass();
        }

        /// <summary>
        /// Is the vehicle inside the envelope its own launch complex can fly:
        /// RP-1's <c>MeetsFacilityRequirements</c>, less the resource arm this
        /// assembly cannot read (see the file header).
        ///
        /// <para>The mass ceiling carries a <see cref="LimitBreach"/> and the rest
        /// carry prose, for the reason the breach type exists: "too heavy" does
        /// not tell an operator whether to shed 200 kg or start again, and a
        /// minimum, a three-axis size and a human rating have no one number
        /// against one number to give.</para>
        /// </summary>
        private static GateVerdict WithinLimits(Vehicle? vehicle, string shipName)
        {
            if (vehicle == null || !vehicle.Finished) return Integration(vehicle, shipName);

            var mass = vehicle.Mass;
            if (mass != null && vehicle.MassMax != null && mass > vehicle.MassMax)
            {
                return GateVerdict.Fail(CommandErrorCode.LimitReached, new LimitBreach
                {
                    FacilityName = vehicle.ComplexName,
                    Quantity = "mass",
                    Limit = vehicle.MassMax,
                    Actual = mass,
                    Unit = Units.Tonnes,
                });
            }
            if (mass != null && vehicle.MassMin != null && mass < vehicle.MassMin)
            {
                // RP-1's floor, which stock has no concept of: a complex rated for
                // a Saturn V cannot usefully integrate a sounding rocket, so an
                // over-large complex is a refusal in its own right.
                return GateVerdict.Fail(
                    CommandErrorCode.LimitReached,
                    $"\"{shipName}\" is too light for {vehicle.ComplexName}, which needs at least "
                        + vehicle.MassMin.Value.ToString("N1") + " t");
            }
            if (vehicle.ExceedsSize(out var axis))
            {
                return GateVerdict.Fail(
                    CommandErrorCode.LimitReached,
                    $"\"{shipName}\" is too large for {vehicle.ComplexName} on its {axis} axis");
            }
            if (vehicle.HumanRated && !vehicle.ComplexHumanRated)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    $"\"{shipName}\" is human-rated and {vehicle.ComplexName} is not");
            }
            if (vehicle.HasClamps && vehicle.IsHangar)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    $"\"{shipName}\" has launch clamps and would be launching from a runway");
            }
            return GateVerdict.Pass();
        }

        /// <summary>Is that vehicle standing on a pad that can launch it.</summary>
        private static GateVerdict Rollout(Vehicle? vehicle, string shipName)
        {
            if (vehicle == null || !vehicle.Finished)
            {
                // The integration requirement is evaluated first and has already
                // refused this, so reaching here means somebody asked this one on
                // its own. Repeating the refusal beats passing it.
                return Integration(vehicle, shipName);
            }

            if (vehicle.IsHangar)
            {
                // A hangar vehicle taxis out. RP-1 draws its Launch button with no
                // rollout project at all, so there is no second condition to meet.
                return GateVerdict.Pass();
            }

            if (!vehicle.ComplexOperational)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady, $"{vehicle.ComplexName} is still being reconstructed");
            }

            if (vehicle.RollingBack != null)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady,
                    $"\"{shipName}\" is rolling back from {PadWords(vehicle.RollingBack.PadId)}");
            }

            var rollout = vehicle.Rollout;
            if (rollout == null)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady,
                    $"\"{shipName}\" is in the warehouse at {vehicle.ComplexName} and has not been rolled out to a pad");
            }
            if (!rollout.Complete)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady, $"\"{shipName}\" is still rolling out to {PadWords(rollout.PadId)}");
            }

            var pad = vehicle.PadNamed(rollout.PadId);
            if (pad == null)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady,
                    $"\"{shipName}\" was rolled out to {PadWords(rollout.PadId)}, which {vehicle.ComplexName} no longer has");
            }
            if (pad.Destroyed || !pad.Operational)
            {
                return GateVerdict.Fail(
                    CommandErrorCode.FacilityDamaged,
                    $"{PadWords(pad.Name)} needs repairs before \"{shipName}\" can launch from it");
            }
            if (vehicle.ReconditioningOn(pad.Name))
            {
                return GateVerdict.Fail(
                    CommandErrorCode.NotReady, $"{PadWords(pad.Name)} is still being reconditioned");
            }

            return GateVerdict.Pass();
        }

        /// <summary>
        /// The named vehicle in RP-1's model, or null when no complex holds one.
        ///
        /// <para>The build list is searched as well as the warehouse, so a
        /// vehicle mid-integration is a WAIT rather than a vehicle nobody ever
        /// built. A warehouse hit always wins: RP-1 lets the same design be
        /// queued again while a finished copy stands ready.</para>
        /// </summary>
        private static Vehicle? FindVehicle(object scm, string shipName, string? facility)
        {
            Vehicle? unfinished = null;

            foreach (var ksc in Rp1Types.Enumerate(Rp1Types.Member(scm, "KSCs")))
            {
                foreach (var lc in Rp1Types.Enumerate(Rp1Types.Member(ksc, "LaunchComplexes")))
                {
                    var isHangar = string.Equals(
                        Rp1Types.ReadEnumName(lc, "LCType"), "Hangar", StringComparison.Ordinal);
                    if (!FacilityMatches(facility, isHangar))
                    {
                        continue;
                    }

                    foreach (var vp in Rp1Types.Enumerate(Rp1Types.Member(lc, "Warehouse")))
                    {
                        if (NameMatches(vp, shipName))
                        {
                            return new Vehicle(lc, vp, isHangar, finished: true);
                        }
                    }

                    if (unfinished != null) continue;
                    foreach (var vp in Rp1Types.Enumerate(Rp1Types.Member(lc, "BuildList")))
                    {
                        if (NameMatches(vp, shipName))
                        {
                            unfinished = new Vehicle(lc, vp, isHangar, finished: false);
                            break;
                        }
                    }
                }
            }

            return unfinished;
        }

        /// <summary>
        /// Whether a complex of this kind can hold the craft the caller named.
        ///
        /// <para>Guards against a plane in the hangar answering for a rocket of
        /// the same name. An unrecognised or absent facility matches everything:
        /// the command's own admission check refuses a facility that is neither,
        /// and narrowing the search on a string this gate could not parse would
        /// refuse a vehicle that is sitting there ready.</para>
        /// </summary>
        private static bool FacilityMatches(string? facility, bool isHangar)
        {
            if (string.Equals(facility, "VAB", StringComparison.OrdinalIgnoreCase)) return !isHangar;
            if (string.Equals(facility, "SPH", StringComparison.OrdinalIgnoreCase)) return isHangar;
            return true;
        }

        /// <summary>
        /// Case-insensitive, because the name reaching this gate came off the wire
        /// from an operator and the craft file it resolves to is looked up on a
        /// filesystem that does not care either. A false match here costs nothing:
        /// the launch still meets every other requirement or fails one.
        /// </summary>
        private static bool NameMatches(object vesselProject, string shipName) =>
            string.Equals(
                Rp1Types.ReadString(vesselProject, "shipName"), shipName, StringComparison.OrdinalIgnoreCase);

        /// <summary>The argument at <paramref name="path"/> as a non-blank string, or null.</summary>
        private static string? Argument(IGateArguments arguments, string path)
        {
            if (arguments == null) return null;
            return arguments.TryGet(path, out var value) && value is string text && text.Trim().Length > 0
                ? text.Trim()
                : null;
        }

        /// <summary>A pad named for an operator, or an impersonal phrase when RP-1 gave no name.</summary>
        private static string PadWords(string? padId) =>
            string.IsNullOrEmpty(padId) ? "its pad" : "pad \"" + padId + "\"";

        private object? ScmInstance() => _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");

        /// <summary>
        /// One vehicle and the launch complex holding it, resolved once so the
        /// three requirement arms read the same object graph rather than walking
        /// it three times with three chances to disagree.
        /// </summary>
        private sealed class Vehicle
        {
            private readonly object _lc;
            private readonly object _vp;
            private readonly string _shipId;

            public Vehicle(object lc, object vesselProject, bool isHangar, bool finished)
            {
                _lc = lc;
                _vp = vesselProject;
                _shipId = Rp1Types.ReadGuidString(vesselProject, "shipID") ?? "";
                IsHangar = isHangar;
                Finished = finished;
                ComplexName = Rp1Types.ReadString(lc, "Name") ?? "the launch complex";
                ComplexOperational = Rp1Types.ReadBool(lc, "IsOperational") == true;
                ComplexHumanRated = Rp1Types.ReadBool(lc, "IsHumanRated") == true;
                HumanRated = Rp1Types.ReadBool(vesselProject, "humanRated") == true;
                HasClamps = string.Equals(
                    Rp1Types.ReadEnumName(vesselProject, "clampState"), "HasClamps", StringComparison.Ordinal);
                Mass = Rp1Types.ReadDouble(vesselProject, "mass");
                MassMax = Unlimited(Rp1Types.ReadDouble(lc, "MassMax"));
                MassMin = Rp1Types.ReadDouble(lc, "MassMin");
            }

            /// <summary>In a warehouse rather than still on a build list.</summary>
            public bool Finished { get; }

            public bool IsHangar { get; }

            public string ComplexName { get; }

            public bool ComplexOperational { get; }

            public bool ComplexHumanRated { get; }

            public bool HumanRated { get; }

            public bool HasClamps { get; }

            public double? Mass { get; }

            public double? MassMax { get; }

            public double? MassMin { get; }

            /// <summary>
            /// Whether any axis of the vehicle exceeds the complex's, naming the
            /// first that does.
            /// </summary>
            /// <remarks>
            /// A recorded size of zero on any axis is a size nobody wrote down
            /// rather than a vehicle of no extent, and the getter that would
            /// compute one writes to the vehicle (see the file header). No size,
            /// no comparison: an invented one would refuse a real vehicle.
            /// </remarks>
            public bool ExceedsSize(out string axis)
            {
                axis = "";
                var ship = Rp1Types.Member(_vp, "ShipSize");
                var limit = Rp1Types.Member(_lc, "SizeMax");
                if (ship == null || limit == null) return false;

                foreach (var name in new[] { "x", "y", "z" })
                {
                    var extent = Rp1Types.ReadDouble(ship, name);
                    var allowed = Unlimited(Rp1Types.ReadDouble(limit, name));
                    if (extent == null || extent <= 0.0 || allowed == null) continue;
                    if (extent > allowed)
                    {
                        axis = name;
                        return true;
                    }
                }
                return false;
            }

            /// <summary>This vehicle's own rollout, complete or not, if it has one.</summary>
            public Operation? Rollout => OperationOfType("Rollout");

            /// <summary>This vehicle's own rollback, if one is running.</summary>
            public Operation? RollingBack
            {
                get
                {
                    var op = OperationOfType("Rollback");
                    return op == null || op.Complete ? null : op;
                }
            }

            /// <summary>
            /// Whether a reconditioning is running on this pad. RP-1 drops a
            /// finished one from the list on its own tick, so requiring
            /// incompleteness only narrows the window in which a stale entry
            /// would refuse a launch RP-1 itself would allow.
            /// </summary>
            public bool ReconditioningOn(string? padName)
            {
                foreach (var op in Operations())
                {
                    if (op.Type == "Reconditioning" && !op.Complete
                        && string.Equals(op.PadId, padName, StringComparison.Ordinal))
                    {
                        return true;
                    }
                }
                return false;
            }

            public Pad? PadNamed(string? padId)
            {
                foreach (var pad in Rp1Types.Enumerate(Rp1Types.Member(_lc, "LaunchPads")))
                {
                    var name = Rp1Types.ReadString(pad, "name");
                    if (string.Equals(name, padId, StringComparison.Ordinal))
                    {
                        return new Pad(pad, name);
                    }
                }
                return null;
            }

            /// <summary>
            /// RP-1's unlimited sentinel as the ABSENCE of a limit. It stores
            /// <c>float.MaxValue</c> on a complex with no ceiling, and 3.4e38
            /// beside a craft mass is not "unlimited", it is a bug that reads as a
            /// units error.
            /// </summary>
            private static double? Unlimited(double? limit) =>
                limit == null || limit.Value < 0.0 || limit.Value >= float.MaxValue ? (double?)null : limit;

            private Operation? OperationOfType(string type)
            {
                foreach (var op in Operations())
                {
                    if (op.Type == type && op.Mine(_shipId)) return op;
                }
                return null;
            }

            private IEnumerable<Operation> Operations()
            {
                foreach (var op in Rp1Types.Enumerate(Rp1Types.Member(_lc, "Recon_Rollout")))
                {
                    yield return new Operation(op);
                }
            }
        }

        /// <summary>One entry of a complex's <c>Recon_Rollout</c> list.</summary>
        private sealed class Operation
        {
            private readonly string _associatedId;

            public Operation(object op)
            {
                _associatedId = Rp1Types.ReadString(op, "associatedID") ?? "";
                Type = Rp1Types.ReadEnumName(op, "RRType") ?? "";
                PadId = Rp1Types.ReadString(op, "launchPadID");

                // LCOpsProject.IsComplete()'s whole body, over fields rather than
                // through the call, so nothing on RP-1's side is invoked. A
                // reversed operation counts down to zero; every other one counts
                // up to its build points.
                var progress = Rp1Types.ReadDouble(op, "progress") ?? 0.0;
                var buildPoints = Rp1Types.ReadDouble(op, "BP") ?? 0.0;
                Complete = Rp1Types.ReadBool(op, "IsReversed") == true
                    ? progress <= 0.0
                    : progress >= buildPoints;
            }

            /// <summary>The <c>RolloutReconType</c> member name, e.g. <c>Rollout</c>.</summary>
            public string Type { get; }

            public string? PadId { get; }

            public bool Complete { get; }

            public bool Mine(string shipId) =>
                shipId.Length > 0
                && string.Equals(_associatedId, shipId, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>One of a complex's launch pads.</summary>
        private sealed class Pad
        {
            public Pad(object pad, string? name)
            {
                Name = name;
                Operational = Rp1Types.ReadBool(pad, "isOperational") == true;
                Destroyed = Rp1Types.ReadBool(pad, "IsDestroyed") == true;
            }

            public string? Name { get; }

            public bool Operational { get; }

            public bool Destroyed { get; }
        }
    }
}
