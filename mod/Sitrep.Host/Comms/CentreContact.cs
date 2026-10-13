using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>Whether a command centre is in contact with a craft, as that centre knows it.</summary>
    public enum CentreContactState
    {
        /// <summary>The newest word to reach the centre says it has a route to the craft.</summary>
        InContact,

        /// <summary>The newest word to reach the centre says it has no route to the craft, or no word of a route has reached it.</summary>
        Silent,

        /// <summary>The centre knows the craft is gone, from its last frame over a link or from seeing it go.</summary>
        Gone,
    }

    /// <summary>
    /// One command centre's contact with one craft, made only of what has
    /// reached that centre: whether a route to the craft stood when the newest
    /// word of one left, and the last instant the centre knows it had one.
    /// </summary>
    public readonly struct CentreContact
    {
        public CentreContact(CentreContactState state, double? lastContactUt)
        {
            State = state;
            LastContactUt = lastContactUt;
        }

        public CentreContactState State { get; }

        /// <summary>The last instant the centre knows it had a route to the craft, or null when it knows of none.</summary>
        public double? LastContactUt { get; }

        /// <summary>
        /// One view made of several centres' views of the same craft: gone when
        /// any of them knows the craft is gone, since a craft that has gone does
        /// not come back, otherwise in contact when any of them is, and otherwise
        /// silent. The last contact is the latest any of them
        /// knows of. Null when there are no views.
        /// </summary>
        public static CentreContact? Consolidated(IEnumerable<CentreContact> views)
        {
            var any = false;
            var inContact = false;
            var gone = false;
            double? last = null;
            foreach (var view in views)
            {
                any = true;
                inContact |= view.State == CentreContactState.InContact;
                gone |= view.State == CentreContactState.Gone;
                if (view.LastContactUt != null && (last == null || view.LastContactUt > last))
                {
                    last = view.LastContactUt;
                }
            }
            if (!any)
            {
                return null;
            }
            var state = gone ? CentreContactState.Gone : inContact ? CentreContactState.InContact : CentreContactState.Silent;
            return new CentreContact(state, last);
        }

        /// <summary>
        /// What <paramref name="centre"/> knows of its contact with a craft, or
        /// null when nothing about the craft has reached it.
        /// </summary>
        /// <param name="centre">The centre's id.</param>
        /// <param name="known">The craft as the centre knows it, heard and seen together, or null.</param>
        /// <param name="heard">The newest state the craft itself sent that has reached the centre, or null.</param>
        /// <param name="reach">The newest word of who can hear the craft to reach the centre, or null.</param>
        public static CentreContact? Of(string centre, CraftState? known, CraftState? heard, CraftReach? reach)
        {
            if (known == null && reach == null)
            {
                return null;
            }
            var lastReached = reach?.LastReachedAt(centre);
            if (known != null && !known.Exists)
            {
                return new CentreContact(CentreContactState.Gone, lastReached);
            }
            if (reach != null && reach.Reaches(centre))
            {
                return new CentreContact(CentreContactState.InContact, heard == null ? reach.CapturedUt : Math.Max(reach.CapturedUt, heard.CapturedUt));
            }
            return new CentreContact(CentreContactState.Silent, lastReached);
        }
    }
}
