using Sitrep.Contract;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// Static pointer to the engine <see cref="Kernel"/>, published by
    /// <see cref="FleetChannels"/> at Register and read by
    /// <see cref="SilenceTrackerScenario"/> when it builds each save's
    /// deadline policy.
    ///
    /// <para>The two live on opposite sides of a lifetime mismatch: the uplink
    /// registers once per process and is the only thing handed a kernel, while
    /// the tracker (and so the policy that reads the elected comms backend's
    /// occlusion model) is rebuilt on every save load. A static pointer is the
    /// same discipline <see cref="SilenceTrackerSink"/> uses in the other
    /// direction, and for the same reason.</para>
    ///
    /// <para>Null before the uplink has registered, e.g. at the main menu. A
    /// policy built against a null kernel simply predicts nothing and falls
    /// back to the orbital-period deadline, which is always correct.</para>
    /// </summary>
    public static class SilenceGeometrySink
    {
        public static Kernel? Kernel { get; private set; }

        public static void Bind(Kernel kernel) => Kernel = kernel;

        public static void Unbind() => Kernel = null;
    }
}
