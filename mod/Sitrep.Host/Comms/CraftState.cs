using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// How one craft's radio reaches one other node, as it stood when the
    /// craft's state was read: the declared range, and the backend's link
    /// model with its dishes aimed where they were aimed then.
    /// </summary>
    public readonly struct CraftLink
    {
        public CraftLink(double? maxRangeMeters, IContactLinkModel? link)
        {
            MaxRangeMeters = maxRangeMeters;
            Link = link;
        }

        /// <summary>The longest distance the pair can talk over, in metres, or null when the backend states none.</summary>
        public double? MaxRangeMeters { get; }

        /// <summary>The backend's link model for the pair, or null to plan the pair on geometry and range alone.</summary>
        public IContactLinkModel? Link { get; }
    }

    /// <summary>
    /// Everything a contact plan needs to know about one craft, read at one
    /// instant: that it exists, where it is going, and how its radio reaches
    /// every other node. One of these is recorded on the craft's own node
    /// whenever any of it changes, so each command centre hears of the change
    /// one of its own light-times later and plans from what it has heard.
    ///
    /// <para>Never sent to a client. It carries the backend's link models,
    /// which are code and not data.</para>
    /// </summary>
    public sealed class CraftState
    {
        private static readonly IReadOnlyDictionary<string, CraftLink> NoLinks = new Dictionary<string, CraftLink>();

        private CraftState(
            string id,
            double capturedUt,
            bool exists,
            int bodyIndex,
            OrbitElements? orbit,
            RotatingGroundStation? surface,
            SecularOrbit? secular,
            double? validUntilUt,
            bool plannable,
            IReadOnlyDictionary<string, CraftLink> links)
        {
            Id = id;
            CapturedUt = capturedUt;
            Exists = exists;
            BodyIndex = bodyIndex;
            Orbit = orbit;
            Surface = surface;
            Secular = secular;
            ValidUntilUt = validUntilUt;
            Plannable = plannable;
            Links = links;
        }

        /// <summary>The craft's node id, <c>"vessel:&lt;guid&gt;"</c>.</summary>
        public string Id { get; }

        /// <summary>When this was read off the craft.</summary>
        public double CapturedUt { get; }

        /// <summary>False for the last thing a craft says: that it is gone.</summary>
        public bool Exists { get; }

        /// <summary>The body the craft orbits, or stands on.</summary>
        public int BodyIndex { get; }

        /// <summary>The craft's orbit, or null for one standing on a surface.</summary>
        public OrbitElements? Orbit { get; }

        /// <summary>The craft's place on its body, for one standing on the surface.</summary>
        public RotatingGroundStation? Surface { get; }

        /// <summary>The drift the orbit is carried forward with, or null to carry it on its conic.</summary>
        public SecularOrbit? Secular { get; }

        /// <summary>How far ahead the orbit can be trusted, or null for as far as anyone plans.</summary>
        public double? ValidUntilUt { get; }

        /// <summary>False for a craft whose propagator could not say how far its orbit can be trusted: it is left out of every plan rather than trusted for all of it.</summary>
        public bool Plannable { get; }

        /// <summary>The craft's link to each other node that existed when this was read, by that node's id.</summary>
        public IReadOnlyDictionary<string, CraftLink> Links { get; }

        public static CraftState Orbiting(
            string id,
            double capturedUt,
            int bodyIndex,
            OrbitElements orbit,
            SecularOrbit? secular,
            double? validUntilUt,
            bool plannable,
            IReadOnlyDictionary<string, CraftLink> links) =>
            new CraftState(id, capturedUt, true, bodyIndex, orbit, null, secular, validUntilUt, plannable, links);

        public static CraftState Landed(
            string id, double capturedUt, int bodyIndex, RotatingGroundStation surface, IReadOnlyDictionary<string, CraftLink> links) =>
            new CraftState(id, capturedUt, true, bodyIndex, null, surface, null, null, true, links);

        /// <summary>The craft is gone: destroyed, recovered, or docked into another.</summary>
        public static CraftState Gone(string id, double capturedUt) =>
            new CraftState(id, capturedUt, false, -1, null, null, null, null, false, NoLinks);

        /// <summary>The craft as a contact plan carries it, or null for one that is gone or cannot be planned.</summary>
        public PlanNode? ToPlanNode()
        {
            if (!Exists || !Plannable)
            {
                return null;
            }
            if (Surface != null)
            {
                return PlanNode.OnSurface(Id, BodyIndex, Surface.Value);
            }
            var target = PropagationTarget.Vessel(Id, BodyIndex, Orbit!.Value);
            return Secular != null
                ? PlanNode.Drifting(Id, target, Secular.Value, ValidUntilUt)
                : PlanNode.Orbiting(Id, target, ValidUntilUt);
        }
    }

    /// <summary>
    /// Where craft states are recorded and heard: each on its craft's own
    /// node, so the delay machinery carries it to each command centre as it
    /// carries that craft's telemetry. Courier thread only.
    /// </summary>
    public interface ICraftStateHost
    {
        /// <summary>
        /// Records <paramref name="state"/> as read aboard the craft at
        /// <paramref name="ut"/>. While the craft is out of contact it is held
        /// with the rest of the craft's recording, and dumped on reacquisition.
        /// </summary>
        /// <param name="vesselId">The craft's bare guid, as the fleet node carries it.</param>
        void RecordCraftState(string vesselId, CraftState state, double ut);

        /// <summary>
        /// Notes that the craft still exists and is still measured, so that
        /// its light-times are on file for the day it is not.
        /// </summary>
        void NoteCraftPresent(string vesselId);

        /// <summary>
        /// Records that the craft is gone as of <paramref name="ut"/>. It
        /// reaches each centre at the light-time the craft was last measured at
        /// while in contact, which is when its silence would. A craft that was
        /// out of contact when it went sends nothing: no centre can tell its
        /// loss from the blackout it was already in.
        /// </summary>
        void RecordCraftGone(string vesselId, double ut);

        /// <summary>
        /// Hears the craft's states as <paramref name="centre"/> receives them:
        /// the newest already arrived at once, and each later one as it lands.
        /// Returns the call that stops listening.
        /// </summary>
        Action HearCraftState(string vesselId, string centre, Action<CraftState> heard);

        /// <summary>Calls <paramref name="reset"/> whenever the game's timeline is rewound or replaced, after everything recorded ahead of it has been dropped.</summary>
        void OnTimelineReset(Action reset);
    }
}
