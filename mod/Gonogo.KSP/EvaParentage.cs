using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Which craft an EVA kerbal stepped out of, and therefore which vessel gonogo
    /// goes on reporting as active while they are outside it. The rule half of
    /// <see cref="ActiveVesselScope"/>, carved out so it carries no KSP type and
    /// runs headlessly - same discipline as <see cref="CommNetOcclusion"/> and
    /// <see cref="PlanOwner"/>.
    ///
    /// <para>KSP makes the EVA kerbal the active vessel the moment they egress, and
    /// stock stores no back-reference from the kerbal to the craft they left. The
    /// kerbal's part inherits the parent's <c>missionID</c>/<c>launchID</c>, but
    /// those identify a LAUNCH, not a vessel, and are shared by anything that ever
    /// undocked from it. The only carrier of the relation is
    /// <c>GameEvents.onCrewOnEva</c>, which hands over both parts at the instant of
    /// egress, so the relation has to be RECORDED there and dropped again on
    /// <c>onCrewBoardVessel</c>. That is what this book holds.</para>
    ///
    /// <para>The relation lives for the duration of one EVA and no longer. Outside
    /// that, <c>FlightGlobals.ActiveVessel</c> keeps its authority: this book has no
    /// opinion about vessel switching, docking, or which craft a kerbal boarded, and
    /// a boarding is meant to look on the wire exactly like a routine switch.</para>
    ///
    /// <para>Ids are <c>Vessel.id</c> guids rather than vessel references: they are
    /// what survives a save/load round-trip (see
    /// <see cref="EvaParentagePersistence"/>), and holding a reference to a vessel
    /// KSP has since destroyed is exactly the failure this has to avoid.</para>
    /// </summary>
    public sealed class EvaParentage
    {
        private readonly Dictionary<Guid, Guid> _parentOf = new Dictionary<Guid, Guid>();

        /// <summary>Every recorded kerbal-to-craft relation, for persistence.</summary>
        public IEnumerable<KeyValuePair<Guid, Guid>> Entries => _parentOf;

        /// <summary>
        /// Records that <paramref name="kerbalVesselId"/> left
        /// <paramref name="parentVesselId"/>. Called from the egress event and from
        /// the save round-trip. A second egress replaces the first: a kerbal who
        /// boarded and stepped out again belongs to whatever they left last.
        ///
        /// <para>An empty id, or a craft that is the kerbal, is dropped rather than
        /// stored: stock's own debug spawn fires the egress event with a null source
        /// part, and a self-referencing row would loop the lookup.</para>
        /// </summary>
        public void RecordEgress(Guid kerbalVesselId, Guid parentVesselId)
        {
            if (kerbalVesselId == Guid.Empty ||
                parentVesselId == Guid.Empty ||
                kerbalVesselId == parentVesselId)
            {
                return;
            }

            _parentOf[kerbalVesselId] = parentVesselId;
        }

        /// <summary>
        /// Ends the substitution for one vessel id: the kerbal boarded something, or
        /// a vessel left the world. Boarding drops it whatever was boarded, so
        /// whatever KSP makes active next is simply reported - a kerbal returning to
        /// their own craft and a kerbal walking into someone else's are the same
        /// event on the wire, and both are a routine vessel switch.
        /// </summary>
        public void Forget(Guid vesselId)
        {
            _parentOf.Remove(vesselId);
        }

        /// <summary>Drops every relation. A different save knows nothing of this one's kerbals.</summary>
        public void Clear()
        {
            _parentOf.Clear();
        }

        /// <summary>The craft <paramref name="kerbalVesselId"/> left, if one was recorded.</summary>
        public bool TryParentOf(Guid kerbalVesselId, out Guid parentVesselId) =>
            _parentOf.TryGetValue(kerbalVesselId, out parentVesselId);

        /// <summary>
        /// The vessel gonogo reports as active, given what KSP has made active.
        ///
        /// <para>Anything that is not an EVA kerbal is reported as-is, and the
        /// liveness probe is not consulted at all - it is a walk of the live vessel
        /// roster and this runs on every sample.</para>
        ///
        /// <para>A kerbal with no recorded craft is reported as themselves: the seam
        /// degrades to stock behaviour rather than inventing a craft. A kerbal whose
        /// craft is no longer in the world is the same, and the dead relation is
        /// dropped on the way out so the roster is not walked for it again.</para>
        /// </summary>
        /// <param name="kspActiveId"><c>FlightGlobals.ActiveVessel.id</c>, or null when there is no flight.</param>
        /// <param name="kspActiveIsEva">Whether that vessel is a kerbal on EVA.</param>
        /// <param name="stillFlying">Whether a vessel id is still in the world.</param>
        public Guid? Reported(Guid? kspActiveId, bool kspActiveIsEva, Func<Guid, bool> stillFlying)
        {
            if (kspActiveId == null || kspActiveId.Value == Guid.Empty)
            {
                return null;
            }

            var active = kspActiveId.Value;
            if (!kspActiveIsEva)
            {
                return active;
            }

            if (!_parentOf.TryGetValue(active, out var parent))
            {
                return active;
            }

            if (stillFlying == null || !stillFlying(parent))
            {
                _parentOf.Remove(active);
                return active;
            }

            return parent;
        }
    }
}
