// GonogoMechJebUplink: GPLv3. See GonogoMechJebUplink.csproj's header comment
// for the licence/linkage rationale.

using Sitrep.Contract;

namespace Gonogo.MechJebUplink
{
    /// <summary>
    /// Validates <c>mechjeb.engageAscentAutopilot</c>'s one argument before
    /// anything writes it into MechJeb2.
    ///
    /// <para><b>Why this exists: the dangerous number on this Uplink travels
    /// INBOUND.</b> Every other Uplink's absence hazard is a failed read
    /// published as a confident telemetry fact; this one is command-only, so
    /// there is no readout to flatten. What reaches
    /// <c>MechJebModuleAscentSettings.DesiredOrbitAltitude</c> instead is a
    /// number a client composed, and a client that could not read its own
    /// operator's input hands over a zero. A blank number input parses to 0, a
    /// non-numeric one to NaN, and <c>JSON.stringify</c> writes that NaN as
    /// <c>null</c>, which deserialises here as 0 again; an absent key does the
    /// same. So "the operator did not give us an altitude" and "the operator
    /// asked for a 0 km orbit" arrive identically, and the second one is an
    /// ascent flown into the ground.</para>
    ///
    /// <para><b>One expression covers all of it:</b> <c>!(altitude &gt; 0.0)</c>
    /// is false for NaN, for 0 and for negatives alike, which is why the
    /// comparison is written round that way rather than as a chain of explicit
    /// non-finite tests. The bound is deliberately not a real altitude floor:
    /// where the atmosphere ends is body- and planet-pack-dependent and this
    /// Uplink is in no position to claim it, whereas "an orbit is above the
    /// surface" holds everywhere.</para>
    ///
    /// <para>Lives in the MechJeb2-FREE half on purpose. <c>MechJebController</c>
    /// links MuMech/UnityEngine types and is excluded from
    /// <c>GonogoMechJebUplink.Tests</c>' compilation, so validation written
    /// there could not be tested headlessly at all. See
    /// <c>MechJebUplink.cs</c>'s class doc comment for the split.</para>
    /// </summary>
    internal static class MechJebAscentGuard
    {
        /// <summary>
        /// The refusal <see cref="MechJebAscentArgs"/> earns, or <c>null</c>
        /// when the altitude is one MechJeb can be asked to fly to.
        /// <see cref="CommandErrorCode.Range"/> with a sentence the operator
        /// reads, matching <c>RaTargeting.Target</c>'s handling of the same
        /// situation: refused rather than attempted, because attempting it
        /// engages the autopilot and the craft starts flying.
        /// </summary>
        public static CommandResult? Refuse(MechJebAscentArgs? args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "No arguments supplied.");
            }

            if (!(args.TargetAltitudeKm > 0.0))
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "No target altitude to fly to. The ascent autopilot needs one above 0 km, "
                        + "and a blank or unreadable altitude field arrives here as 0.");
            }

            return null;
        }
    }
}
