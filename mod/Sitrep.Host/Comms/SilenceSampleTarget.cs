using Sitrep.Propagation;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// A silence sample as something a propagation provider can be asked about.
    /// </summary>
    public static class SilenceSampleTarget
    {
        /// <summary>
        /// The craft the sample describes, named along with the body it orbits.
        ///
        /// <para><b>A missing reference body index becomes -1, deliberately.</b>
        /// It really does mean "the caller does not know what this orbits", and it
        /// is left visible rather than hidden behind a factory named for the case,
        /// because a name would make it look handled. Both questions the policies
        /// ask are safe under it: a cycle depends only on the elements, and both
        /// ask in the target's OWN parent frame, so the frame and the elements
        /// still share a centre whatever that centre turns out to be. Anything that
        /// wanted to reach a DIFFERENT body's frame would be refused, which is the
        /// correct answer for a craft whose parent nobody can name.</para>
        /// </summary>
        public static PropagationTarget Of(SilenceSample sample) =>
            PropagationTarget.Vessel(
                sample.VesselId, sample.ReferenceBodyIndex ?? -1, sample.Orbit);
    }
}
