namespace Gonogo.KSP
{
    /// <summary>
    /// Whether a target's orbit is read from the elements KSP last stored on it or
    /// rebuilt from the vessel's own position and velocity this pass.
    ///
    /// <para>KSP refreshes the stored elements of a loaded vessel that is not the
    /// active one only occasionally, so their epoch can trail the game clock by
    /// minutes while the target is physics-loaded a few hundred metres away and
    /// being pushed by its own thrusters. Propagating those elements forward gives
    /// a closest approach that no longer matches the real range. A loaded,
    /// unpacked vessel has a live state vector, so the orbit is rebuilt from it at
    /// the current time. A packed vessel is on rails and its stored elements are
    /// exact; a body has no vessel state to read.</para>
    /// </summary>
    internal static class TargetOrbitFreshness
    {
        public static bool RebuildsFromState(bool isVessel, bool loaded, bool packed) =>
            isVessel && loaded && !packed;
    }
}
