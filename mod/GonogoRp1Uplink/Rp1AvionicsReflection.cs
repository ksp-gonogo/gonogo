// Reflection-only bridge to RP-1's control locker: the rule that decides whether
// the avionics fitted to a vessel are enough to steer it. No compile-time
// reference to RP0.dll and none to KSP either, the same arm's-length pattern as
// Rp1ScReflection, whose header carries this Uplink's provenance rules in full.
//
// PROVENANCE. Read out of an ilspycmd disassembly of the SHIPPED RP-1 v4.6.0.0
// RP0.dll, 2026-09-10, the same binary Rp1ScReflection is locked against:
//
//   public static ControlLockerUtils.LockLevel ShouldLock(
//       List<Part> parts, bool countClamps,
//       out float maxMass, out float vesselMass, out bool isLimitedByNonInterplanetary)
//   public enum LockLevel { Locked, Axial, Unlocked }
//
// WHY THE VERDICT IS ASKED FOR RATHER THAN COMPUTED. The arithmetic looks
// reproducible and is not. Read off the IL, ShouldLock's walk carries five rules
// a summed mass limit does not:
//
//   1  a part's avionics count toward the limit only when electricity actually
//      reaches them (GetConnectedResourceTotals on the part), or in the editor
//   2  in the editor and at PRELAUNCH it ZEROES launch clamps and any part whose
//      parent carries ModuleTagList.HasPadInfrastructure, so its vesselMass is
//      not Vessel.totalMass and the gap is largest on the pad
//   3  a part with a valid ModuleCommand and NO ModuleAvionics unlocks the
//      vessel outright at any mass (`flag` in the IL), which no tonnage compare
//      can reach
//   4  Axial is a real third state: a unit that is not dead and allows axial
//      keeps roll authority when the tonnage check fails
//   5  an EVA kerbal, and any scene that is neither flight nor the editor,
//      short-circuit to Unlocked before the walk begins
//
// THE SCENE SHORT-CIRCUIT IS WHY THIS FILE GUARDS THE SCENE ITSELF. Rule 5 makes
// ShouldLock answer Unlocked with maxMass 0 and vesselMass 0 at the space centre
// and the tracking station. That is a FABRICATED verdict as far as this channel
// is concerned: nobody weighed anything. So the call is not made outside flight
// and the editor, and the reading goes out absent instead.
//
// countClamps: TRUE, matching RP0.ControlLocker.Update, the loop that actually
// locks an operator's controls in flight. RP-1's own editor tab passes false,
// which is the right call for a design-time readout and the wrong one for a
// surface reporting what the game is doing to the stick right now.
//
// CheatOptions.InfiniteElectricity is honoured for the same reason: ControlLocker
// returns Unlocked outright when it is set, so a verdict that ignored it would
// draw an alert about a lock the game is not applying.
using System;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Asks RP-1 whether the reported vessel's avionics can steer it, and reads
    /// back the two masses and the interplanetary flag that come out of the same
    /// call.
    /// </summary>
    /// <remarks>
    /// Nothing here touches KSP or Unity: the vessel arrives as the opaque handle
    /// <see cref="ActiveVesselQuery.ReportedVessel"/> hands back, its part list is
    /// read by name, and the scene comes off <c>HighLogic</c> by reflection. So
    /// this file compiles and runs headless against a stand-in object graph, the
    /// same property the rest of this Uplink has.
    /// </remarks>
    public sealed class Rp1AvionicsReflection
    {
        private const string ControlLockerUtilsTypeName = "RP0.ControlLockerUtils";
        private const string HighLogicTypeName = "HighLogic";
        private const string CheatOptionsTypeName = "CheatOptions";

        private readonly Type? _controlLockerUtils;
        private readonly MethodInfo? _shouldLock;
        private readonly Type? _highLogic;
        private readonly Type? _cheatOptions;

        /// <summary>
        /// Whether RP-1's locker is reachable at all. False on a stock install and
        /// false on an RP-1 that moved or reshaped <c>ShouldLock</c>, which are
        /// the same consequence here: this Uplink has no avionics verdict to
        /// publish and says so by publishing none.
        /// </summary>
        public bool IsAvailable => _shouldLock != null;

        public Rp1AvionicsReflection()
        {
            _controlLockerUtils = Rp1Types.Find(ControlLockerUtilsTypeName);
            _shouldLock = _controlLockerUtils == null
                ? null
                : Rp1Types.StaticMethod(_controlLockerUtils, "ShouldLock", 5);
            _highLogic = Rp1Types.Find(HighLogicTypeName);
            _cheatOptions = Rp1Types.Find(CheatOptionsTypeName);
        }

        /// <summary>
        /// One reading for <paramref name="vessel"/>, or <c>null</c> when there is
        /// nothing to read: no vessel, no reachable locker, a scene RP-1 does not
        /// evaluate in, or a part list that did not resolve.
        /// </summary>
        /// <param name="vessel">
        /// The reported vessel, as the opaque handle
        /// <see cref="ActiveVesselQuery.ReportedVessel"/> returns. Core's answer
        /// rather than KSP's, deliberately: on EVA, KSP's active vessel is the
        /// kerbal, and reporting the KERBAL's mass against the ship's avionics is
        /// a reading about the wrong craft.
        /// </param>
        public Rp1AvionicsRaw? Read(object? vessel)
        {
            if (vessel == null || !IsAvailable || !InAnEvaluatedScene())
            {
                return null;
            }

            // `parts` rather than `Parts`: both exist on Vessel and only the field
            // is the live list ShouldLock's own callers pass. Read by name because
            // this assembly has no KSP reference to type it with.
            var parts = Rp1Types.Member(vessel, "parts");
            if (parts == null)
            {
                return null;
            }

            if (_cheatOptions != null
                && Rp1Types.StaticValue(_cheatOptions, "InfiniteElectricity") is true)
            {
                // ControlLocker short-circuits to Unlocked under this cheat before
                // it asks ShouldLock anything, so the game is not locking the
                // stick whatever the tonnage says. Reported as the verdict it is,
                // with no masses attached: none were weighed.
                return new Rp1AvionicsRaw { Level = Rp1LockLevel.Unlocked };
            }

            // out parameters come back through the argument array, which is why
            // the call is built this way rather than through a typed delegate.
            var args = new object?[] { parts, true, null, null, null };
            object? verdict;
            try
            {
                verdict = _shouldLock!.Invoke(null, args);
            }
            catch (Exception)
            {
                // Fail-soft to absent. A throw inside RP-1's own walk is not this
                // Uplink's to interpret, and a substituted verdict would be a
                // go/no-go nobody took.
                return null;
            }

            var level = LevelOf(verdict);
            if (level == null)
            {
                return null;
            }

            return new Rp1AvionicsRaw
            {
                Level = level,
                SupportedMassTons = Rp1Types.ToDouble(args[2]),
                VesselMassTons = Rp1Types.ToDouble(args[3]),
                LimitedByNonInterplanetary = args[4] is bool limited ? limited : (bool?)null,
            };
        }

        /// <summary>
        /// Whether RP-1 evaluates the locker in the current scene. See this file's
        /// header: outside flight and the editor <c>ShouldLock</c> returns
        /// <c>Unlocked</c> with both masses zero, which would publish a go/no-go
        /// off a walk that never ran.
        /// </summary>
        private bool InAnEvaluatedScene()
        {
            if (_highLogic == null)
            {
                return false;
            }
            return Rp1Types.StaticValue(_highLogic, "LoadedSceneIsFlight") is true
                || Rp1Types.StaticValue(_highLogic, "LoadedSceneIsEditor") is true;
        }

        /// <summary>
        /// RP-1's <c>LockLevel</c> as this Uplink's mirror of it, matched by MEMBER
        /// NAME, and <c>null</c> for anything else.
        /// </summary>
        /// <remarks>
        /// <para>The value arrives boxed as RP-1's own enum type, which this
        /// assembly cannot name, so it is read through <c>ToString()</c>. By name
        /// rather than by ordinal deliberately: an ordinal match reads a REORDERED
        /// enum as a different level, and the two levels that would swap are
        /// <c>Locked</c> and <c>Unlocked</c>. A go/no-go that can invert silently
        /// is worse than one that goes absent, and the three names are pinned
        /// against the shipped binary in <c>Rp1ReflectionTargets.EnumMembers</c>
        /// where an ordinal could not be.</para>
        ///
        /// <para>A fourth level added by a future release, and any undefined value
        /// (which stringifies as its number), land outside the switch and read as
        /// no verdict. That is the only safe reading of a rule this build has not
        /// been shown.</para>
        /// </remarks>
        internal static Rp1LockLevel? LevelOf(object? verdict) => verdict?.ToString() switch
        {
            "Locked" => Rp1LockLevel.Locked,
            "Axial" => Rp1LockLevel.Axial,
            "Unlocked" => Rp1LockLevel.Unlocked,
            _ => null,
        };
    }
}
