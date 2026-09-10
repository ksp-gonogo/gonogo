using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Pure mapper: turns one <see cref="Rp1AvionicsRaw"/> reading into the
    /// <c>rp1.avionics</c> dict. KSP-free and side-effect-free, so it is unit
    /// tested headless.
    /// </summary>
    /// <remarks>
    /// <para>There is no arithmetic here and that is the point. RP-1 decides
    /// whether the controls lock, in <c>ControlLockerUtils.ShouldLock</c>, and
    /// this Uplink asks it rather than re-deriving it. The predecessor compared
    /// <c>Vessel.totalMass</c> against a summed avionics limit and got four things
    /// wrong that this mapper cannot get wrong, because it does not compute them:
    /// it collapsed three lock levels into a bool, weighed the wrong mass (RP-1
    /// zeroes launch clamps at PRELAUNCH), missed that a command part carrying no
    /// avionics unlocks the vessel outright, and had no representation for the
    /// interplanetary limit at all.</para>
    ///
    /// <para><b>Absence stays absence.</b> A null reading is not a verdict of
    /// <c>Unlocked</c> and not a zero tonnage: the whole payload goes out as
    /// <c>null</c>, and the channel's <c>AbsenceIsData</c> says that null means
    /// "nothing to report about this vessel" rather than "the read failed
    /// silently". An out-of-range level is treated the same way, because a lock
    /// level this build does not know the meaning of is not one to draw a
    /// go/no-go from.</para>
    /// </remarks>
    public static class Rp1AvionicsCapture
    {
        public static Dictionary<string, object?>? Build(Rp1AvionicsRaw? raw)
        {
            if (raw == null)
            {
                return null;
            }
            return new Dictionary<string, object?>
            {
                ["lockLevel"] = LevelName(raw.Level),
                ["supportedMassTons"] = raw.SupportedMassTons,
                ["vesselMassTons"] = raw.VesselMassTons,
                ["limitedByNonInterplanetary"] = raw.LimitedByNonInterplanetary,
            };
        }

        /// <summary>
        /// RP-1's own member name for the level, or <c>null</c> for a value
        /// outside the enum it was read from.
        /// </summary>
        /// <remarks>
        /// Named explicitly rather than through <c>ToString()</c> so a future RP-1
        /// release that adds a fourth level cannot put an unrecognised string on
        /// the wire under a field a client switches on. An unknown level reads as
        /// no verdict, which is the only safe reading of one.
        /// </remarks>
        internal static string? LevelName(Rp1LockLevel? level) => level switch
        {
            Rp1LockLevel.Locked => "Locked",
            Rp1LockLevel.Axial => "Axial",
            Rp1LockLevel.Unlocked => "Unlocked",
            _ => null,
        };
    }
}
