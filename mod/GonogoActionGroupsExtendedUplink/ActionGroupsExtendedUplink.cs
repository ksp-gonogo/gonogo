using System;
using Sitrep.Contract;

namespace Gonogo.ActionGroupsExtendedUplink
{
    /// <summary>
    /// The GonogoActionGroupsExtendedUplink. When
    /// Action Groups Extended is loaded (the <see cref="AgxReflection"/>
    /// probe), it registers a higher-priority <c>"actionGroups"</c> provider
    /// on the engine Kernel so <see cref="AgxActionGroupsBackend"/> WINS the
    /// exclusive action-groups election: mirroring the exact election shape
    /// <c>GonogoRealAntennasUplink</c> uses for comms. Registering the
    /// provider IS the gate: absent AGX, no provider is registered and the
    /// stock backend stays elected.
    ///
    /// <para>Ships ZERO client code and declares NO channels/commands of its
    /// own: the vessel uplink owns <c>vessel.control</c> and resolves the
    /// elected backend at capture time via
    /// <c>ActionGroupsElection.Elected(...)</c>. AGX changes only which
    /// backend answers; the topic and everything downstream of it are
    /// unchanged, so no wire type is new here (<c>ContractShapeGateTests</c>
    /// / <c>WirePayloadCoverageTests</c> must stay green untouched).</para>
    ///
    /// <para>NO compile-time reference to AGExt's GPL3 assembly anywhere in
    /// this project: every AGExt member is reached by reflection
    /// (<see cref="AgxReflection"/>). Compile surface is
    /// <c>Sitrep.Contract</c> ONLY.</para>
    /// </summary>
    [SitrepUplink("actionGroupsExtended")]
    public sealed class ActionGroupsExtendedUplink : ISitrepUplink
    {

        /// <summary>
        /// The id and priority this uplink registers its action-groups backend
        /// under. They live HERE rather than in core: core owns the capability and
        /// its stock vanilla, and a provider owns its own identity. Any positive
        /// priority beats the vanilla structurally; the value only matters if a
        /// second provider for this capability ever appears.
        /// </summary>
        public const string ProviderId = "actionGroupsExtended";

        /// <inheritdoc cref="ProviderId"/>
        public const double ProviderPriority = 100.0;

        /// <summary>
        /// The exclusive capability this uplink registers against, spelled out
        /// rather than read from core's <c>ActionGroupsElection.CapabilityId</c>:
        /// that constant lives in Sitrep.Host, which is unpublished, and an
        /// Uplink builds against Sitrep.Contract and its own contract slice only.
        /// The comms backends already name <c>"comms"</c> the same way for the
        /// same reason.
        ///
        /// <para>Two spellings of one identity in two assemblies is a drift
        /// risk, and a silent one: the capability would simply never elect, with
        /// no error anywhere. GonogoActionGroupsExtendedUplink.Tests pins them
        /// equal, which it can do because a test project may reference both.</para>
        /// </summary>
        public const string CapabilityId = "actionGroups";

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

        /// <summary>
        /// The AGX surface this uplink registers against, or null to probe the
        /// loaded assemblies for it.
        ///
        /// <para>A seam rather than a straight <see cref="AgxReflection.Probe"/>
        /// call, because probing looks for an assembly by name and a headless test
        /// has no way to put one there. Without it the only registration a test
        /// could drive was the inert one, so what the capability answers after a
        /// tick was untestable and the exclusive-capability starvation case for
        /// action groups had to be written against a copy of Register instead of
        /// Register.</para>
        /// </summary>
        private readonly IAgxApi? _agx;

        public ActionGroupsExtendedUplink()
        {
        }

        internal ActionGroupsExtendedUplink(IAgxApi agx)
        {
            _agx = agx;
        }

        public void Register(IUplinkHost host)
        {
            var agx = _agx ?? AgxReflection.Probe();
            if (agx == null || !agx.IsAvailable)
            {
                // AGX not installed: go inert. The exclusive actionGroups
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
            // before ANY uplink's Register: so by the time this line
            // executes the capability is guaranteed present regardless of
            // assembly-scan discovery order. The try/catch is pure
            // defence-in-depth (a genuinely absent capability cannot happen
            // in a correctly bundled install): a throw is surfaced, not
            // swallowed, and this uplink still goes inert rather than taking
            // anything else down.
            try
            {
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CapabilityId,
                    Id = ProviderId,
                    Priority = ProviderPriority,
                    Factory = _ => new AgxActionGroupsBackend(agx),
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[ActionGroupsExtendedUplink] could not register actionGroups provider: " + ex.Message);
            }
        }
    }
}
