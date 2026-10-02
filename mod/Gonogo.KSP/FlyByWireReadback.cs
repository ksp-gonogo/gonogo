namespace Gonogo.KSP
{
    /// <summary>
    /// Which craft the fly-by-wire override is armed on, readable from the
    /// snapshot capture. The override itself lives in a
    /// <see cref="KspVesselActuator"/> instance owned by the vessel Uplink, so the
    /// capture, which has no handle on it, reads this instead.
    ///
    /// <para>Main-thread only, like both of its callers: command handlers and the
    /// snapshot capture run on the Unity main thread, so it needs no
    /// synchronization.</para>
    /// </summary>
    internal static class FlyByWireReadback
    {
        private static Vessel? _armedOn;

        /// <summary>Records the craft carrying an armed override, or null when none is armed.</summary>
        public static void Set(Vessel? armedOn) => _armedOn = armedOn;

        /// <summary>Whether the override is armed on exactly <paramref name="vessel"/>.</summary>
        public static bool IsArmedOn(Vessel vessel) => _armedOn != null && ReferenceEquals(_armedOn, vessel);
    }
}
