namespace Sitrep.Host
{
    /// <summary>
    /// Detects an active-vessel GUID change (docking/undocking/EVA/vessel
    /// switch) and forces an unconditional keyframe on every
    /// <c>vessel.*</c> channel for that same tick — the "subject provenance +
    /// epoching" rule from local_docs/telemetry-mod/m1-provider-taxonomy-design.md
    /// §6.1: without this, a station's <c>vessel.*</c> timeline would
    /// silently interleave two different physical objects across the
    /// switch, poisoning both live delivery and <c>request(range)</c>
    /// history.
    ///
    /// KSP-free (this is the reusable, headlessly-testable half of the
    /// mechanism); <c>Gonogo.KSP.VesselExtension</c> only constructs and
    /// registers one instance via <see cref="IExtensionHost.AddSampler"/>.
    /// Registering it as an <see cref="ISnapshotSampler"/> — rather than
    /// detecting the change inside one of the channel mappers themselves —
    /// guarantees the force happens BEFORE any of this tick's channel
    /// <c>Decide</c> calls, regardless of the engine's channel-source
    /// iteration order: <c>ChannelEngine.ProcessTick</c> runs every
    /// registered sampler, THEN loops channel sources, in that fixed order,
    /// every tick.
    ///
    /// <see cref="IExtensionHost.ForceKeyframe"/> is the same mechanism a
    /// genuine 0→1 subscribe transition already uses internally
    /// (<c>ChannelEmitter.NotifySubscribed</c>) — reused here rather than
    /// inventing a second "unconditional next emission" concept.
    ///
    /// Also calls <see cref="IExtensionHost.ResetChannelBirth"/> for the same
    /// topic set, ALONGSIDE (not instead of) <see cref="IExtensionHost.ForceKeyframe"/>
    /// — the M2 subject-scoped-birth fix. Without this, the engine's
    /// per-topic "has this channel ever emitted a real value" birth-guard
    /// (see <c>ChannelEngine</c>'s <c>_born</c> field) is keyed purely by
    /// topic, not by (topic, subject): switching to a vessel that has never
    /// populated a given channel (e.g. no target set) would otherwise
    /// inherit the PREVIOUS vessel's "born" state for that topic and, since
    /// <see cref="IExtensionHost.ForceKeyframe"/> makes the very next
    /// <c>Decide</c> call unconditional, immediately emit a spurious
    /// tombstone for data the new subject never had in the first place.
    /// </summary>
    public sealed class VesselEpochSampler : ISnapshotSampler
    {
        private readonly IExtensionHost _host;
        private string? _lastVesselId;

        public VesselEpochSampler(IExtensionHost host)
        {
            _host = host;
        }

        public void Sample(KspSnapshot snapshot)
        {
            var currentId = VesselViewProvider.TryGetActiveVesselId(snapshot);

            // Only a genuine non-null-to-DIFFERENT-non-null transition
            // counts as a subject switch -- the very first observation
            // (_lastVesselId still null) is excluded deliberately: there is
            // no PRIOR subject to switch away from, so it isn't an epoch,
            // just a cold start (every channel already starts
            // force-keyframed by default regardless -- see
            // ChannelEmitter.NotifySubscribed's own doc comment).
            //
            // _lastVesselId is only ever updated when a vessel IS present
            // (never overwritten with null), so a temporary gap (no active
            // vessel -- e.g. a trip through the main menu) never erases
            // "the last vessel we actually saw": re-entering the SAME
            // vessel after such a gap is correctly NOT treated as a switch,
            // while switching to a DIFFERENT vessel across that same gap
            // still is.
            if (currentId != null && _lastVesselId != null && currentId != _lastVesselId)
            {
                foreach (var topic in VesselViewProvider.Topics)
                {
                    _host.ForceKeyframe(topic);
                }
                _host.ResetChannelBirth(VesselViewProvider.Topics);
            }

            if (currentId != null)
            {
                _lastVesselId = currentId;
            }
        }
    }
}
