namespace GonogoProbeUplink
{
    public sealed partial class ProbeUplink
    {
        public ProbeUplink()
            : this(ReadGameUt)
        {
        }

        /// <summary>Null before a save has loaded, when there is no planetarium to ask.</summary>
        private static double? ReadGameUt() =>
            Planetarium.fetch != null ? Planetarium.GetUniversalTime() : (double?)null;
    }
}
