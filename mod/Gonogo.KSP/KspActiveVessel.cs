using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Core's answer to the <c>activeVessel</c> capability: a thin publication of
    /// <see cref="ActiveVesselScope"/> to Uplinks, which cannot reference this
    /// assembly and so cannot reach the seam any other way.
    ///
    /// <para>Holds no state of its own on purpose. Two books of which vessel is
    /// being reported would be two answers, and the whole point of the seam is
    /// that there is one.</para>
    /// </summary>
    internal sealed class KspActiveVessel : IActiveVessel
    {
        public string ProviderId => "stock-active-vessel";

        public object? Reported => ActiveVesselScope.Current;

        public string? ReportedId
        {
            get
            {
                var vessel = ActiveVesselScope.Current;
                return vessel == null ? null : vessel.id.ToString();
            }
        }

        public bool SubstitutedForEva => ActiveVesselScope.SubstitutedForEva;
    }
}
