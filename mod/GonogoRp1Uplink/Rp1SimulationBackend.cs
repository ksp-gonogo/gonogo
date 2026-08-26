using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The <c>"simulation"</c> capability's RP-1 provider: RP-1 is the mod that
    /// invented the distinction between a rehearsal and a mission, so it is the
    /// mod that answers.
    ///
    /// <para>Core owns the question because core owns everything a simulation
    /// misreports: every <c>flight.*</c> and <c>vessel.*</c> channel, and the
    /// light-time the reveal gate enforces on them. Neither can learn a
    /// vendor's topic name, which is why this is a capability rather than an
    /// <c>rp1.*</c> channel somebody has to know to read.</para>
    ///
    /// <para>A thin wrapper over the existing space-centre reader rather than a
    /// second probe: it is the same <c>SpaceCenterManagement</c> instance, and
    /// two resolutions of one type would be two things to keep in step.</para>
    /// </summary>
    public sealed class Rp1SimulationBackend : ISimulationBackend
    {
        private readonly Rp1ScReflection _rp1;

        public Rp1SimulationBackend(Rp1ScReflection rp1)
        {
            _rp1 = rp1;
        }

        public string ProviderId => "rp1";

        public bool? IsSimulatedFlight() => _rp1.IsSimulatedFlight();
    }
}
