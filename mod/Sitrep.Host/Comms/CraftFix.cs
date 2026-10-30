using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What one command centre knows of where one craft is: whether it is in
    /// contact, the last instant it knows the craft's place, and how far the
    /// craft can have gone from where that centre reckons it since.
    /// </summary>
    public sealed class CraftFix
    {
        public CraftFix(CraftState known, bool inContact, double lastKnownUt)
        {
            Known = known;
            InContact = inContact;
            LastKnownUt = lastKnownUt;
        }

        /// <summary>The craft as the centre knows it, heard and seen together.</summary>
        public CraftState Known { get; }

        /// <summary>Whether the newest word to reach the centre says a link reaches it from the craft.</summary>
        public bool InContact { get; }

        /// <summary>
        /// The last instant the centre knows the craft's place: the newer of
        /// what it heard and what it saw, or later, the last instant a live link
        /// to a craft that was holding its course reached it, since such a craft
        /// says so when its course changes.
        /// </summary>
        public double LastKnownUt { get; }

        /// <summary>
        /// How far the craft can be at <paramref name="ut"/> from where the centre
        /// reckons it, in metres: <see cref="PositionUncertainty.Bound"/> from
        /// <see cref="LastKnownUt"/>, in contact or not, since the newest word
        /// to reach a centre left the craft at least one delay ago.
        /// Null when it cannot be bounded, which is not zero.
        /// </summary>
        public double? UncertaintyMAt(double ut) => PositionUncertainty.Bound(Known, LastKnownUt, ut);

        /// <summary>
        /// Where the centre reckons the craft is at <paramref name="ut"/>, from the
        /// state it last knew it in, or null when that cannot be said; see
        /// <see cref="PlacePrediction.PlaceAt"/>.
        /// </summary>
        public CraftPlace? PlaceAt(double ut) => PlacePrediction.PlaceAt(Known, ut)?.Place;
    }
}
