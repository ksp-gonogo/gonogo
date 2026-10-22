using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The one record of the transmissions the active vessel has sent, shared by whatever
    /// starts them and the channel that publishes their arrival. It lives for the whole
    /// process, so a scene change does not lose it.
    /// </summary>
    internal static class ScienceTransmissions
    {
        internal static readonly ScienceTransmissionLog Log = new ScienceTransmissionLog();
    }
}
