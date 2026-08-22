using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Whether this process may change a Principia flight plan at all, and for how
    /// long.
    ///
    /// <para><b>Three independent conditions, and each fails closed to READ-ONLY
    /// rather than to "try anyway".</b> The producer's build must be the one whose
    /// write entry points were read; the write entry points must have bound; and
    /// the operator must have armed the surface, which is also what runs the struct
    /// round-trip probes. A read misfire is a wrong number on a screen. A write
    /// misfire is a plan that cannot be un-written, in the player's own save.</para>
    ///
    /// <para><b>Why the version constant is separate from the read gate's.</b> They
    /// hold the same string today and they answer different questions. The session's
    /// gate asks "were these READS analysed for abort safety". This one asks "were
    /// these WRITES analysed, and is the struct layout the one they were analysed
    /// with", and the second question has an answer the first does not depend on:
    /// the burn struct is generated at the producer's build time from a schema that
    /// gained a field and lost one in this very release. Sharing one constant would
    /// mean a future decision to keep reading across a version bump silently
    /// carried the writes along with it.</para>
    ///
    /// <para><b>The arm is measured in operator time, not game time.</b> A game
    /// clock can be warped a hundred thousand times over between two frames, and an
    /// arm that expires in universal time would either last an instant or last
    /// forever depending on the player's warp. This is an interval of real seconds
    /// and it is the one place in this slice where that is the right clock.</para>
    /// </summary>
    public sealed class PrincipiaWriteAuthority
    {
        /// <summary>
        /// The exact producer build whose WRITE entry points and struct shapes were
        /// read, as its own <c>GetVersion</c> reports it.
        /// </summary>
        public const string WriteAnalysedPluginVersion =
            "2026081218-Levi-Civita-0-gc6615048e8fc76722b081bb3f1f4536afcf66870";

        /// <summary>How long an arm lasts, in real seconds. Long enough to tune a
        /// burn, short enough that a console left open overnight is not still
        /// armed.</summary>
        public static readonly TimeSpan ArmWindow = TimeSpan.FromMinutes(5);

        private readonly string _detectedVersion;
        private readonly bool _versionMatches;
        private readonly bool _writesBound;
        private readonly string _bindFailure;
        private readonly Func<DateTime> _now;

        private string? _armedVessel;
        private DateTime _armedUntil = DateTime.MinValue;

        internal PrincipiaWriteAuthority(
            string detectedVersion, bool writesBound, string bindFailure, Func<DateTime>? now = null)
        {
            _detectedVersion = detectedVersion;
            _versionMatches = string.Equals(
                detectedVersion, WriteAnalysedPluginVersion, StringComparison.Ordinal);
            _writesBound = writesBound;
            _bindFailure = bindFailure;
            _now = now ?? (() => DateTime.UtcNow);
        }

        /// <summary>The build the writes were analysed against, for the wire.</summary>
        public string AnalysedVersion => WriteAnalysedPluginVersion;

        /// <summary>The build actually found, for the wire.</summary>
        public string DetectedVersion => _detectedVersion;

        /// <summary>
        /// Whether the burn round-trip probe has passed in this process. Set only by
        /// the probe itself.
        /// </summary>
        public bool BurnLayoutVerified { get; private set; }

        /// <summary>Whether the step-parameter round-trip probe has passed.</summary>
        public bool IntegratorLayoutVerified { get; private set; }

        /// <summary>What the last probe found, when it failed.</summary>
        public string? LayoutFailure { get; private set; }

        /// <summary>
        /// True when the surface COULD be armed: right build, writes bound. Says
        /// nothing about whether it is armed.
        /// </summary>
        public bool Available => _versionMatches && _writesBound;

        /// <summary>
        /// Why the surface is unavailable, or null when it is available.
        /// </summary>
        public string? UnavailableReason
        {
            get
            {
                if (!_versionMatches)
                {
                    return "Principia build not analysed for flight-plan WRITES. Expected '"
                        + WriteAnalysedPluginVersion + "'; found '" + _detectedVersion
                        + "'. The plan stays readable and no edit will be attempted: the burn "
                        + "struct is generated from a schema that changed in this release, and a "
                        + "stale one does not fail to resolve, it writes a plausible wrong burn "
                        + "into your save.";
                }
                if (!_writesBound)
                {
                    return _bindFailure.Length == 0
                        ? "Principia's flight-plan write entry points did not bind."
                        : _bindFailure;
                }
                return null;
            }
        }

        /// <summary>True when <paramref name="vesselGuid"/> is armed right now.</summary>
        public bool IsArmed(string? vesselGuid) =>
            Available
            && _armedVessel != null
            && string.Equals(_armedVessel, vesselGuid, StringComparison.Ordinal)
            && _now() < _armedUntil;

        /// <summary>
        /// Whether a write may be attempted for this vessel, and the refusal when
        /// not.
        ///
        /// <para>The layout probes are checked per-struct by the caller rather than
        /// here, because the two are independent: a plan with no burns can still
        /// have its step parameters raised, and refusing that for want of a burn to
        /// probe would deny the remedy to the plan most likely to need it.</para>
        /// </summary>
        public bool TryPermit(
            string? vesselGuid, out PrincipiaWriteRefusal refusal, out string detail)
        {
            var unavailable = UnavailableReason;
            if (unavailable != null)
            {
                refusal = PrincipiaWriteRefusal.SurfaceUnavailable;
                detail = unavailable;
                return false;
            }
            if (!IsArmed(vesselGuid))
            {
                refusal = PrincipiaWriteRefusal.NotArmed;
                detail =
                    "The flight-plan write surface is not armed for this vessel. Every plan write "
                    + "is persisted into the save, can move and delete stock maneuver nodes on the "
                    + "flying craft, and re-integrates on the game's own thread.";
                return false;
            }
            refusal = PrincipiaWriteRefusal.NotRefused;
            detail = string.Empty;
            return true;
        }

        /// <summary>Records that the burn round-trip probe passed.</summary>
        internal void BurnLayoutPassed()
        {
            BurnLayoutVerified = true;
        }

        /// <summary>Records that the step-parameter round-trip probe passed.</summary>
        internal void IntegratorLayoutPassed()
        {
            IntegratorLayoutVerified = true;
        }

        /// <summary>Records why a probe failed, and clears the matching
        /// verification so a later write cannot ride an earlier pass.</summary>
        internal void LayoutFailed(string reason, bool burn, bool integrator)
        {
            LayoutFailure = reason;
            if (burn)
            {
                BurnLayoutVerified = false;
            }
            if (integrator)
            {
                IntegratorLayoutVerified = false;
            }
        }

        /// <summary>Arms the surface for one vessel, for <see cref="ArmWindow"/>.</summary>
        internal void Arm(string vesselGuid)
        {
            _armedVessel = vesselGuid;
            _armedUntil = _now() + ArmWindow;
        }

        /// <summary>Disarms, which is what a plugin re-bind or a failed probe
        /// does.</summary>
        internal void Disarm()
        {
            _armedVessel = null;
            _armedUntil = DateTime.MinValue;
        }
    }
}
