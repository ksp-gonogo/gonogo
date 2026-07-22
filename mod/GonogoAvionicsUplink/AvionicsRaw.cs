namespace GonogoAvionicsUplink
{
    /// <summary>
    /// The reflected avionics reading: the MAX-across-parts controllable-mass
    /// limit (tonnes) and whether any unit is switched on. KSP-free so the pure
    /// mapper + its headless tests never pull in the reflection/KSP surface.
    /// </summary>
    public sealed class AvionicsRaw
    {
        public double ControllableMassTons;
        public bool AvionicsActive;
    }
}
