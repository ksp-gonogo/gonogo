using System;
using Sitrep.Contract;
using Sitrep.Host.ActionGroups;

namespace Gonogo.ActionGroupsExtendedUplink
{
    /// <summary>
    /// The GonogoActionGroupsExtendedUplink
    /// (docs/superpowers/specs/2026-07-17-agx-backend-design.md §5.4). When
    /// Action Groups Extended is loaded (the <see cref="AgxReflection"/>
    /// probe), it registers a higher-priority <c>"actionGroups"</c> provider
    /// on the engine Kernel so <see cref="AgxActionGroupsBackend"/> WINS the
    /// exclusive action-groups election — mirroring the exact election shape
    /// <c>GonogoRealAntennasUplink</c> uses for comms. Registering the
    /// provider IS the gate: absent AGX, no provider is registered and the
    /// stock backend stays elected.
    ///
    /// <para>Ships ZERO client code and declares NO channels/commands of its
    /// own — the vessel uplink owns <c>vessel.control</c> and resolves the
    /// elected backend at capture time via
    /// <c>ActionGroupsElection.Elected(...)</c>. AGX changes only which
    /// backend answers; the topic and everything downstream of it are
    /// unchanged, so no wire type is new here (<c>ContractShapeGateTests</c>
    /// / <c>WirePayloadCoverageTests</c> must stay green untouched).</para>
    ///
    /// <para>NO compile-time reference to AGExt's GPL3 assembly anywhere in
    /// this project — every AGExt member is reached by reflection
    /// (<see cref="AgxReflection"/>). Compile surface is
    /// <c>Sitrep.Contract</c> ONLY.</para>
    /// </summary>
    [SitrepUplink("actionGroupsExtended")]
    public sealed class ActionGroupsExtendedUplink : ISitrepUplink
    {
        // Set at Register when AGX is absent (the uplink goes inert); read by
        // Health(). Null means available. AgxReflection.Probe() is only run at
        // Register, so Health() reads this cached result rather than re-probing.
        private string? _unavailableReason;

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>):
        /// Unavailable when the Action Groups Extended assembly is absent (the uplink went
        /// inert at Register), else Healthy.</summary>
        public UplinkHealth Health() =>
            _unavailableReason != null
                ? new UplinkHealth(UplinkHealthState.Unavailable, _unavailableReason)
                : UplinkHealth.Healthy;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "actionGroupsExtended",
            Version = "1.0.0",
        };

        public void Register(IUplinkHost host)
        {
            var agx = AgxReflection.Probe();
            if (agx == null || !agx.IsAvailable)
            {
                // AGX not installed — go inert. The exclusive actionGroups
                // capability keeps the stock backend elected.
                _unavailableReason = "Action Groups Extended assembly not loaded";
                host.SetAvailability(Availability.Unavailable("Action Groups Extended assembly not loaded"));
                return;
            }

            // Register the AGX action-groups provider directly on the
            // Kernel. The vessel uplink OWNS the "actionGroups" capability
            // descriptor and declares it in the two-pass discovery's
            // capability pass (ActionGroupsElection.RegisterCapability,
            // called from VesselUplink.DeclareCapabilities), which runs
            // before ANY uplink's Register — so by the time this line
            // executes the capability is guaranteed present regardless of
            // assembly-scan discovery order. The try/catch is pure
            // defence-in-depth (a genuinely absent capability cannot happen
            // in a correctly bundled install): a throw is surfaced, not
            // swallowed, and this uplink still goes inert rather than taking
            // anything else down.
            try
            {
                ActionGroupsElection.RegisterActionGroupsExtendedProvider(
                    host.Kernel, _ => new AgxActionGroupsBackend(agx));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[ActionGroupsExtendedUplink] could not register actionGroups provider: " + ex.Message);
            }
        }
    }
}
