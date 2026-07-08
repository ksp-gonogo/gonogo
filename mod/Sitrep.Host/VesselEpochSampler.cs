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
    /// mechanism); <c>Gonogo.KSP.VesselUplink</c> only constructs and
    /// registers one instance via <see cref="IUplinkHost.AddSampler"/>.
    /// Registering it as an <see cref="ISnapshotSampler"/> — rather than
    /// detecting the change inside one of the channel mappers themselves —
    /// guarantees the force happens BEFORE any of this tick's channel
    /// <c>Decide</c> calls, regardless of the engine's channel-source
    /// iteration order: <c>ChannelEngine.ProcessTick</c> runs every
    /// registered sampler, THEN loops channel sources, in that fixed order,
    /// every tick.
    ///
    /// <see cref="IUplinkHost.ForceKeyframe"/> is the same mechanism a
    /// genuine 0→1 subscribe transition already uses internally
    /// (<c>ChannelEmitter.NotifySubscribed</c>) — reused here rather than
    /// inventing a second "unconditional next emission" concept.
    ///
    /// Also calls <see cref="IUplinkHost.ResetChannelBirth"/> for the same
    /// topic set, ALONGSIDE (not instead of) <see cref="IUplinkHost.ForceKeyframe"/>
    /// — the M2 subject-scoped-birth fix. Without this, the engine's
    /// per-topic "has this channel ever emitted a real value" birth-guard
    /// (see <c>ChannelEngine</c>'s <c>_born</c> field) is keyed purely by
    /// topic, not by (topic, subject): switching to a vessel that has never
    /// populated a given channel (e.g. no target set) would otherwise
    /// inherit the PREVIOUS vessel's "born" state for that topic and, since
    /// <see cref="IUplinkHost.ForceKeyframe"/> makes the very next
    /// <c>Decide</c> call unconditional, immediately emit a spurious
    /// tombstone for data the new subject never had in the first place.
    ///
    /// REWIND-AWARE (M2 re-verification fix): a plain vessel-guid comparison
    /// alone is not safe across a quickload -- a loaded save can perfectly
    /// ordinarily have had a different vessel active than whatever was
    /// flying immediately pre-load. <see cref="Sample"/> tracks the last
    /// snapshot Ut it saw and treats a BACKWARD jump as a cold start (just
    /// resynchronize <c>_lastVesselId</c>, no force/reset) rather than a
    /// genuine switch -- see its own doc comment for why: the engine's own
    /// rewind branch (<c>ChannelEngine.ProcessTick</c>) already recomputed
    /// birth correctly from the archive BEFORE this sampler runs, and a
    /// mis-detected "switch" here would silently undo that.
    /// </summary>
    public sealed class VesselEpochSampler : ISnapshotSampler
    {
        private readonly IUplinkHost _host;
        private string? _lastVesselId;

        // The M2 re-verification "rewind-aware sampler" fix: tracks the Ut
        // of the last snapshot this sampler observed, purely to detect a
        // BACKWARD jump (a quickload) -- see Sample's doc comment below for
        // why a plain guid comparison alone is not safe across a rewind.
        // Null before the first observation.
        private double? _lastUt;

        public VesselEpochSampler(IUplinkHost host)
        {
            _host = host;
        }

        public void Sample(KspSnapshot snapshot)
        {
            var currentId = VesselViewProvider.TryGetActiveVesselId(snapshot);

            // Rewind detection: ChannelEngine.ProcessTick runs its own
            // rewind branch (Courier.ResetTimeline + ChannelEmitter.Reset +
            // RecomputeChannelBirthFromArchive) BEFORE running any sampler,
            // all within the SAME tick -- so by the time this Sample call
            // sees a backward Ut, the engine has ALREADY correctly
            // recomputed _born from the archive's own surviving tail. A
            // quickload's loaded save can perfectly ordinarily have had a
            // DIFFERENT vessel active than whatever was flying immediately
            // pre-load (the player switched vessels one or more times after
            // the save was taken, then loaded back to it) -- that is an
            // ARTIFACT of the rewind, not a genuine subject switch. Treating
            // it as one here would call ResetChannelBirth and silently undo
            // the engine's own just-computed correct result. So: a backward
            // Ut is treated as a COLD START -- resynchronize _lastVesselId
            // to whatever vessel this snapshot shows WITHOUT forcing a
            // keyframe or resetting birth (mirroring how the very first-ever
            // observation, _lastVesselId == null, is already excluded from
            // the switch check below) -- and skip the switch-detect entirely
            // for this tick.
            var isRewind = _lastUt.HasValue && snapshot.Ut < _lastUt.Value;
            _lastUt = snapshot.Ut;

            if (isRewind)
            {
                // Unconditional, even when this rewind tick's own snapshot
                // has NO vessel at all (currentId == null): a real
                // quickload's rewound Ut becomes visible in the loading
                // scene BEFORE any vessel does (KspHost.Sample omits the
                // "vessel" group entirely until FlightGlobals.ready). If
                // this only resynchronized _lastVesselId "when currentId !=
                // null", that loading-scene tick would leave the stale
                // PRE-load vessel id in place; the loaded save's vessel
                // (which can perfectly ordinarily differ from the pre-load
                // one) would then appear on a LATER forward tick and get
                // mis-read as a genuine switch, undoing the archive
                // recompute all over again. Clearing unconditionally means
                // the next observed vessel -- on whichever tick it turns up
                // -- is absorbed by the first-observation exclusion below
                // (a cold start), never a spurious switch.
                _lastVesselId = currentId;
                return;
            }

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
