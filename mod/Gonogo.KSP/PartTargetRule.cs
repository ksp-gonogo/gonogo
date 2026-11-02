using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Whether a docking port on another vessel can be targeted right now.
    ///
    /// <para>A vessel beyond physics range is packed but still counts as loaded,
    /// with its part tree in memory. <c>FlightGlobals.SetVesselTarget</c> accepts
    /// a port on it and the target never takes, so the call has to be refused
    /// rather than answered with success. It clears by getting closer, which
    /// unpacks the vessel, so the code is <see cref="CommandErrorCode.NotClearToProceed"/>.</para>
    ///
    /// <para>Carries no KSP type so a headless test can enter it.</para>
    /// </summary>
    internal static class PartTargetRule
    {
        public const string OutOfPhysicsRange =
            "that vessel is out of physics range, so its ports are not there to target";

        public static Refusal? RefusalFor(bool loaded, bool packed) =>
            !loaded || packed
                ? new Refusal(CommandErrorCode.NotClearToProceed, OutOfPhysicsRange)
                : (Refusal?)null;
    }
}
