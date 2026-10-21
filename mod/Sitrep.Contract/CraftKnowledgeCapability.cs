namespace Sitrep.Contract
{
    /// <summary>
    /// The <c>craftKnowledge</c> capability: what each command centre knows of
    /// where each craft is, and how it knows it. Resolve it through
    /// <see cref="IUplinkHost.Kernel"/> as an <see cref="ICraftKnowledge"/>.
    /// Useful for an Uplink that points something at a craft on the operator's
    /// behalf, such as a ground camera, and must aim where a centre believes
    /// the craft is rather than where the game has it. Gonogo registers the
    /// only provider.
    /// <internal>
    /// There is no election: what a centre has heard and seen is the mod's own
    /// record, not a model a mod could hold a rival opinion of.
    /// </internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class CraftKnowledgeCapability
    {
        /// <summary>The capability id, <c>"craftKnowledge"</c>.</summary>
        public const string Id = "craftKnowledge";
    }

    /// <summary>
    /// How one command centre knows where one craft is. Each state is a
    /// different source, and a craft moves between them as links and lines of
    /// sight come and go.
    /// </summary>
    /// <category>Host and Kernel</category>
    public enum CraftKnowledgeState
    {
        /// <summary>The centre knows nothing of the craft: never heard or seen, or known to be gone. There is nothing to point at.</summary>
        Unknown = 0,

        /// <summary>The craft's own telemetry reaches the centre over a link, relays included.</summary>
        Heard = 1,

        /// <summary>No link reaches the centre, but its ground stations have the craft in view and its place comes from that sighting.</summary>
        Seen = 2,

        /// <summary>Neither heard nor seen. The craft was holding its course when last known, so its place is carried forward on that orbit or surface position.</summary>
        Modelled = 3,

        /// <summary>
        /// Neither heard nor seen, and nothing to carry it forward on: it was
        /// thrusting or inside an atmosphere when last known. Its place is the
        /// last one known, and <see cref="CraftKnowledgeReading.HeldGrade"/> says why.
        /// </summary>
        Held = 4,
    }

    /// <summary>
    /// Why a held value stopped updating. The same vocabulary, value for value,
    /// as the <c>HeldGrade</c> a widget reads off a Topic reading in the SDK, so
    /// an Uplink can label a held craft the way the app labels a held figure.
    /// </summary>
    /// <category>Host and Kernel</category>
    public enum HeldGrade
    {
        /// <summary>The general case: updates stopped arriving while the connection and the game are otherwise running.</summary>
        Held = 0,

        /// <summary>The connection to the game is down.</summary>
        Disconnected = 1,

        /// <summary>The last value sent before a known loss of signal.</summary>
        LastBeforeBlackout = 2,

        /// <summary>Recorded by the craft while out of contact and sent on reacquisition: exact for its own instant, but not the craft now.</summary>
        Recorded = 3,

        /// <summary>The game is loading a scene; the value is the last one received.</summary>
        Loading = 4,

        /// <summary>The game is at its main menu; the value is from a game that is no longer running.</summary>
        NoGame = 5,
    }

    /// <summary>
    /// What one command centre knows of one craft at one instant, as
    /// <see cref="ICraftKnowledge.KnowledgeAt"/> answers it.
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class CraftKnowledgeReading
    {
        /// <summary>A centre that knows nothing of the craft.</summary>
        public static readonly CraftKnowledgeReading Unknown =
            new CraftKnowledgeReading(CraftKnowledgeState.Unknown, null, null, null, false);

        /// <summary>Builds a reading. Nothing but the provider needs to.</summary>
        /// <param name="state">How the centre knows where the craft is.</param>
        /// <param name="heldGrade">Why the place stopped updating, for <see cref="CraftKnowledgeState.Held"/> only.</param>
        /// <param name="lastKnownUt">The last instant the centre knows the craft's place.</param>
        /// <param name="uncertaintyM">How far the craft can be from where the centre places it, in metres.</param>
        /// <param name="lineOfSight">Whether the centre has a line of sight to the craft now.</param>
        public CraftKnowledgeReading(CraftKnowledgeState state, HeldGrade? heldGrade, double? lastKnownUt, double? uncertaintyM, bool lineOfSight)
        {
            State = state;
            HeldGrade = heldGrade;
            LastKnownUt = lastKnownUt;
            UncertaintyM = uncertaintyM;
            LineOfSight = lineOfSight;
        }

        /// <summary>How the centre knows where the craft is.</summary>
        public CraftKnowledgeState State { get; }

        /// <summary>Why the place stopped updating. Set exactly when <see cref="State"/> is <see cref="CraftKnowledgeState.Held"/>, null otherwise.</summary>
        public HeldGrade? HeldGrade { get; }

        /// <summary>
        /// The last instant the centre knows the craft's place, in universal
        /// time: when the craft said it, or when the light the centre saw it by
        /// left it. Null exactly when <see cref="State"/> is
        /// <see cref="CraftKnowledgeState.Unknown"/>.
        /// </summary>
        public double? LastKnownUt { get; }

        /// <summary>
        /// The radius, in metres, within which the craft lies around where the
        /// centre places it, grown from what the craft could have done with its
        /// own delta-v and thrust since <see cref="LastKnownUt"/>. Zero while
        /// heard. Null when it cannot be bounded (its delta-v was never heard,
        /// or wheels or rotors can move it) and always for
        /// <see cref="CraftKnowledgeState.Unknown"/>; null is not zero.
        /// </summary>
        public double? UncertaintyM { get; }

        /// <summary>
        /// Whether the centre has a straight line to the craft now: from where
        /// the centre stands, and for the home centre from any ground station
        /// that does. Bodies block
        /// the line at the radius the comms model gives them, which is smaller
        /// than their real one, so this can be true for a craft a camera at the
        /// same place would find just behind the limb. Always false for
        /// <see cref="CraftKnowledgeState.Unknown"/>, so it never reveals a craft
        /// the centre has not learned of.
        /// </summary>
        public bool LineOfSight { get; }
    }

    /// <summary>
    /// What each command centre knows of where each craft is, read only. It
    /// reports what Gonogo's centres have heard and seen and nothing else: there
    /// is no way to tell it what a camera or another mod sees, so its answers
    /// never carry anything a centre could not know.
    ///
    /// <para>Safe to call from any thread. Ask on each use rather than holding
    /// a reading: a reading is for the instant it was asked about.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface ICraftKnowledge : ISitrepProvider
    {
        /// <summary>
        /// What <paramref name="centreId"/> knows of the craft at
        /// <paramref name="ut"/>. Never null: a centre or craft nothing is known
        /// of reads <see cref="CraftKnowledgeReading.Unknown"/>.
        /// </summary>
        /// <param name="centreId">The command centre's id, its <see cref="ICommandCentre.Id"/>.</param>
        /// <param name="vesselId">The craft's id, in the <c>vessel.id.ToString()</c> form every fleet topic keys on.</param>
        /// <param name="ut">The universal time the uncertainty is grown to, normally the game's current time.</param>
        CraftKnowledgeReading KnowledgeAt(string centreId, string vesselId, double ut);
    }
}
