// The two RP-1 members every command that WRITES a launch complex needs, in one
// place, because both are things that go wrong quietly.
//
// Finding a complex is a walk over every centre, and a command that only looked
// at the active one would refuse a complex the operator can see on a second
// centre. Resolving ChangeEngineers is worse than that: RP-1 declares a
// same-arity ChangeEngineers(LCSpaceCenter, int) beside the launch-complex
// overload, so a lookup by name and arity picks whichever the runtime lists
// first, and the wrong pick moves a whole CENTRE's engineer pool while reporting
// success. That is exactly the kind of member two copies of would be free to
// disagree about.
//
// PROVENANCE. Both were read out of an ilspycmd disassembly of the INSTALLED
// RP-1 v4.6.0.0 RP0.dll, the same source Rp1VehicleCommands' header names.
using System;
using System.Reflection;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Shared resolution for the commands that alter a launch complex:
    /// <c>rp1.complex.rush</c> and <c>rp1.personnel.assign</c>.
    /// </summary>
    public static class Rp1ComplexWrites
    {
        /// <summary>The parameter type that tells the two <c>ChangeEngineers</c> overloads apart.</summary>
        public const string LaunchComplexTypeName = "RP0.LaunchComplex";

        /// <summary>
        /// The launch complex with this id, at ANY of the career's centres.
        ///
        /// <para>Every centre rather than the active one: RP-1 runs several under
        /// KSCSwitcher, a client lists all of them, and a command addressed to a
        /// complex the operator is looking at must not refuse because the game's
        /// own view happens to be somewhere else.</para>
        /// </summary>
        public static bool TryFind(object scm, string lcId, out object complex)
        {
            foreach (var centre in Rp1Types.Enumerate(Rp1Types.Member(scm, "KSCs")))
            {
                foreach (var lc in Rp1Types.Enumerate(Rp1Types.Member(centre, "LaunchComplexes")))
                {
                    if (string.Equals(Rp1Types.ReadGuidString(lc, "ID"), lcId, StringComparison.OrdinalIgnoreCase))
                    {
                        complex = lc;
                        return true;
                    }
                }
            }
            complex = null!;
            return false;
        }

        /// <summary>
        /// <c>KCTUtilities.ChangeEngineers(LaunchComplex, int)</c>, resolved by
        /// first-parameter TYPE.
        ///
        /// <para>The one call that makes an engineer change TAKE. It adds the
        /// delta, fires <c>SCMEvents.OnPersonnelChange</c>, reschedules
        /// maintenance and recalculates the complex's build rates, and the last of
        /// those is why a rush setting written without it would not reach the
        /// rates until something else invalidated the cache.</para>
        ///
        /// <para>It CLAMPS NOTHING. RP-1's own window works out the legal delta
        /// before calling, so every caller here has to do the same: this will
        /// happily take a complex past its maximum or a centre's pool below
        /// zero.</para>
        /// </summary>
        public static MethodInfo? ChangeEngineers(Type? utilities) =>
            utilities == null
                ? null
                : Rp1Types.StaticMethodOn(utilities, "ChangeEngineers", LaunchComplexTypeName, 2);
    }
}
