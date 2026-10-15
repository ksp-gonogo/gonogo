namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What the home centre knows of one craft as it stands: its consolidated
    /// contact, the last instant it knows of contact, and its judgement.
    /// </summary>
    public readonly struct HomeCraftView
    {
        public HomeCraftView(CentreContactState contact, double? lastContactUt, HomeVerdictState verdict, int lostSeq)
        {
            Contact = contact;
            LastContactUt = lastContactUt;
            Verdict = verdict;
            LostSeq = lostSeq;
        }

        /// <summary>Home's contact with the craft, from every centre whose word has reached it.</summary>
        public CentreContactState Contact { get; }

        /// <summary>The last instant, in the craft's own time, that home knows a centre had a route to the craft, or null when it knows of none.</summary>
        public double? LastContactUt { get; }

        /// <summary>Home's judgement of the craft.</summary>
        public HomeVerdictState Verdict { get; }

        /// <summary>The number of home's latest Lost declaration for the craft: see <see cref="HomeVerdict.LostSeq"/>.</summary>
        public int LostSeq { get; }
    }
}
