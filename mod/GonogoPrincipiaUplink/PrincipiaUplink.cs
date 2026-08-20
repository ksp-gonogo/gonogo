// The [SitrepUplink("principia")] uplink: detection, and nothing else.
//
// Declares NO channels of its own, the same reasoning a sibling client-less
// uplink records for itself: presence is conveyed by system.uplinks health (Health()
// below), so a dedicated principia.available topic plus a client package to
// register it would be pure overhead for a provider with no widget.
//
// It is ALSO the answer to a narrower question. `VesselPhysicsMode.IsPrincipiaActive`
// was deleted in the Major 2 -> 3 bump because "core detecting a specific
// third-party mod was a mod-seam violation; that awareness belongs to a future
// Principia Uplink instead". This is that Uplink, and detection is the whole of
// what it owns: nothing in core learns the mod's name, and the substantive fact
// reaches clients as a property of the ANSWER (an integrated trajectory, bounded
// by a horizon) rather than as the vendor's identity.
using Sitrep.Contract;
using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    [SitrepUplink("principia")]
    public sealed class PrincipiaUplink : ISitrepUplink
    {
        private readonly PrincipiaGuardResult _guard;

        public PrincipiaUplink()
            : this(PrincipiaVersionGuard.ProbeLoaded())
        {
        }

        /// <summary>Test seam: probe result injected, so the absent and present cases are both reachable without Principia.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard)
        {
            _guard = guard;
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "principia",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        /// <summary>
        /// Registers nothing.
        ///
        /// <para>Deliberate, and the increment boundary: detection lands on its
        /// own so that "the mod is present" is observable before anything starts
        /// changing numbers because of it. The propagation provider that consumes
        /// this guard is the NEXT increment, and it is the one that will make a
        /// conic stop being drawn past its horizon.</para>
        /// </summary>
        public void Register(IUplinkHost host)
        {
        }

        /// <summary>
        /// Unavailable is the ORDINARY answer, not a fault: Principia is optional
        /// and the stock two-body provider stays correct without it. The reason
        /// string is carried so the roster can say which of "not installed" and
        /// "installed but not a version we know" it is, because those want
        /// different actions from an operator.
        /// </summary>
        public UplinkHealth Health() =>
            _guard.IsAvailable
                ? new UplinkHealth(
                    UplinkHealthState.Healthy,
                    _guard.DetectedVersion == null
                        ? null
                        : "Principia " + _guard.DetectedVersion)
                : new UplinkHealth(UplinkHealthState.Unavailable, _guard.Reason);
    }
}
