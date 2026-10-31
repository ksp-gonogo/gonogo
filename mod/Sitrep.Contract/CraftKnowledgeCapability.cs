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

        /// <summary>No link reaches the centre, but its ground stations had the craft in view and its place comes from that sighting. A sighting counts once the light from that moment has reached the centre, so a craft stays seen for one light time after it passes behind a body.</summary>
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

    /// <summary>How a <see cref="CraftPlace"/> was reckoned from what the centre last knew of the craft.</summary>
    /// <category>Host and Kernel</category>
    public enum CraftPlaceBasis
    {
        /// <summary>The craft was last known coasting, so its place is where the orbit it was on puts it.</summary>
        Coasting = 0,

        /// <summary>
        /// The craft was last known under thrust, so its place is the last known
        /// state carried forward with that thrust held until its delta-v is spent,
        /// under the body's gravity, by fixed-step numerical integration.
        /// </summary>
        Burning = 1,
    }

    /// <summary>
    /// Where a command centre reckons a craft is at one instant: a position from
    /// the centre of the body the craft orbits, in metres, in that body's
    /// non-rotating frame, the frame <see cref="PropagationFrame.CentredOn"/> names.
    /// Useful for an Uplink that points something at the craft, such as a ground
    /// camera, which aims at this place within
    /// <see cref="CraftKnowledgeReading.UncertaintyM"/> of it.
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class CraftPlace
    {
        /// <summary>Builds a place. Nothing but the provider needs to.</summary>
        /// <param name="bodyIndex">The index, in the provider's body table, of the body the craft orbits.</param>
        /// <param name="position">The craft's position from that body's centre, in metres.</param>
        /// <param name="basis">How the place was reckoned.</param>
        public CraftPlace(int bodyIndex, Vector3d position, CraftPlaceBasis basis)
        {
            BodyIndex = bodyIndex;
            Position = position;
            Basis = basis;
        }

        /// <summary>The index, in the provider's body table, of the body the craft orbits and the place is measured from.</summary>
        public int BodyIndex { get; }

        /// <summary>The frame <see cref="Position"/> is in: non-rotating and centred on <see cref="BodyIndex"/>.</summary>
        public PropagationFrame Frame => PropagationFrame.CentredOn(BodyIndex);

        /// <summary>The craft's position from the centre of its body, in metres, in <see cref="Frame"/>.</summary>
        public Vector3d Position { get; }

        /// <summary>How the place was reckoned from what the centre last knew of the craft.</summary>
        public CraftPlaceBasis Basis { get; }
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
        /// <param name="lineOfSight">Whether the light that has reached the centre shows the craft in view.</param>
        public CraftKnowledgeReading(CraftKnowledgeState state, HeldGrade? heldGrade, double? lastKnownUt, double? uncertaintyM, bool lineOfSight)
            : this(state, heldGrade, lastKnownUt, uncertaintyM, lineOfSight, null)
        {
        }

        /// <summary>Builds a reading that says where the craft is reckoned to be. Nothing but the provider needs to.</summary>
        /// <param name="state">How the centre knows where the craft is.</param>
        /// <param name="heldGrade">Why the place stopped updating, for <see cref="CraftKnowledgeState.Held"/> only.</param>
        /// <param name="lastKnownUt">The last instant the centre knows the craft's place.</param>
        /// <param name="uncertaintyM">How far the craft can be from where the centre places it, in metres.</param>
        /// <param name="lineOfSight">Whether the light that has reached the centre shows the craft in view.</param>
        /// <param name="place">Where the centre reckons the craft is at the instant asked about, or null when it cannot say.</param>
        public CraftKnowledgeReading(CraftKnowledgeState state, HeldGrade? heldGrade, double? lastKnownUt, double? uncertaintyM, bool lineOfSight, CraftPlace? place)
        {
            Place = place;
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
        /// own delta-v and thrust since <see cref="LastKnownUt"/>, which is
        /// at least one signal delay old even while heard. Null when it cannot
        /// be bounded (its delta-v was never heard, or wheels or rotors can
        /// move it) and always for
        /// <see cref="CraftKnowledgeState.Unknown"/>; null is not zero.
        /// </summary>
        public double? UncertaintyM { get; }

        /// <summary>
        /// Where the centre reckons the craft is at the instant asked about,
        /// which <see cref="UncertaintyM"/> is the radius around. Set for a craft
        /// last known orbiting above its atmosphere that was either coasting, or
        /// thrusting with its thrust and delta-v read, and the instant is within
        /// how far its orbit can be trusted and how far a burn is carried forward.
        /// Null otherwise, including for a craft whose thrust was not read: its
        /// place is then not predicted and <see cref="UncertaintyM"/> is the bound
        /// of a craft that burned flat out since it was last known.
        /// </summary>
        public CraftPlace? Place { get; }

        /// <summary>
        /// Whether the light that has reached the centre by the instant asked
        /// about shows the craft in view of the centre, and for the home centre
        /// of any ground station. The light of a moment takes one signal delay
        /// to arrive, so this stays true for that long after the craft passes
        /// behind a body. Bodies block the line at the radius the comms model
        /// gives them, which is smaller than their real one, so it can be true
        /// for a craft a camera at the same place would find just behind the
        /// limb. Always false for <see cref="CraftKnowledgeState.Unknown"/>, so it
        /// never reveals a craft the centre has not learned of.
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

    /// <summary>
    /// What one command centre knows of one craft at one instant, as a value
    /// the caller's own buffer holds: the fields of
    /// <see cref="CraftKnowledgeReading"/> with the craft's id beside them, so
    /// a whole centre can be read without a new object per craft. Useful for
    /// an Uplink that mirrors every craft's known place into another mod on
    /// each change of the board. Filled by
    /// <see cref="IBulkCraftKnowledge.ReadCentre"/>.
    /// </summary>
    /// <category>Host and Kernel</category>
    public readonly struct CraftKnowledgeSample
    {
        /// <summary>Builds a sample. Nothing but the provider needs to.</summary>
        /// <param name="vesselId">The craft's id, in the <c>vessel.id.ToString()</c> form every fleet topic keys on.</param>
        /// <param name="state">How the centre knows where the craft is.</param>
        /// <param name="heldGrade">Why the place stopped updating, for <see cref="CraftKnowledgeState.Held"/> only.</param>
        /// <param name="lastKnownUt">The last instant the centre knows the craft's place.</param>
        /// <param name="uncertaintyM">How far the craft can be from where the centre places it, in metres.</param>
        /// <param name="lineOfSight">Whether the light that has reached the centre shows the craft in view.</param>
        public CraftKnowledgeSample(string vesselId, CraftKnowledgeState state, HeldGrade? heldGrade, double? lastKnownUt, double? uncertaintyM, bool lineOfSight)
            : this(vesselId, state, heldGrade, lastKnownUt, uncertaintyM, lineOfSight, null)
        {
        }

        /// <summary>Builds a sample that says where the craft is reckoned to be. Nothing but the provider needs to.</summary>
        /// <param name="vesselId">The craft's id, in the <c>vessel.id.ToString()</c> form every fleet topic keys on.</param>
        /// <param name="state">How the centre knows where the craft is.</param>
        /// <param name="heldGrade">Why the place stopped updating, for <see cref="CraftKnowledgeState.Held"/> only.</param>
        /// <param name="lastKnownUt">The last instant the centre knows the craft's place.</param>
        /// <param name="uncertaintyM">How far the craft can be from where the centre places it, in metres.</param>
        /// <param name="lineOfSight">Whether the light that has reached the centre shows the craft in view.</param>
        /// <param name="place">Where the centre reckons the craft is, or null when it cannot say.</param>
        public CraftKnowledgeSample(string vesselId, CraftKnowledgeState state, HeldGrade? heldGrade, double? lastKnownUt, double? uncertaintyM, bool lineOfSight, CraftPlace? place)
            : this(vesselId, state, heldGrade, lastKnownUt, uncertaintyM, lineOfSight, place, null)
        {
        }

        /// <summary>Builds a sample that also says how large the craft is as the centre last heard of it. Nothing but the provider needs to.</summary>
        /// <param name="vesselId">The craft's id, in the <c>vessel.id.ToString()</c> form every fleet topic keys on.</param>
        /// <param name="state">How the centre knows where the craft is.</param>
        /// <param name="heldGrade">Why the place stopped updating, for <see cref="CraftKnowledgeState.Held"/> only.</param>
        /// <param name="lastKnownUt">The last instant the centre knows the craft's place.</param>
        /// <param name="uncertaintyM">How far the craft can be from where the centre places it, in metres.</param>
        /// <param name="lineOfSight">Whether the light that has reached the centre shows the craft in view.</param>
        /// <param name="place">Where the centre reckons the craft is, or null when it cannot say.</param>
        /// <param name="extentM">The craft's own radius in metres as the centre last heard it, or null when it was not heard.</param>
        public CraftKnowledgeSample(string vesselId, CraftKnowledgeState state, HeldGrade? heldGrade, double? lastKnownUt, double? uncertaintyM, bool lineOfSight, CraftPlace? place, double? extentM)
        {
            ExtentM = extentM;
            Place = place;
            VesselId = vesselId;
            State = state;
            HeldGrade = heldGrade;
            LastKnownUt = lastKnownUt;
            UncertaintyM = uncertaintyM;
            LineOfSight = lineOfSight;
        }

        /// <summary>The craft's id, in the <c>vessel.id.ToString()</c> form every fleet topic keys on.</summary>
        public string VesselId { get; }

        /// <summary>How the centre knows where the craft is; see <see cref="CraftKnowledgeReading.State"/>.</summary>
        public CraftKnowledgeState State { get; }

        /// <summary>Why the place stopped updating; set exactly when <see cref="State"/> is <see cref="CraftKnowledgeState.Held"/>.</summary>
        public HeldGrade? HeldGrade { get; }

        /// <summary>The last instant the centre knows the craft's place, in universal time; see <see cref="CraftKnowledgeReading.LastKnownUt"/>.</summary>
        public double? LastKnownUt { get; }

        /// <summary>The radius in metres around the placed craft, or null when it cannot be bounded; see <see cref="CraftKnowledgeReading.UncertaintyM"/>.</summary>
        public double? UncertaintyM { get; }

        /// <summary>Where the centre reckons the craft is, or null; see <see cref="CraftKnowledgeReading.Place"/>.</summary>
        public CraftPlace? Place { get; }

        /// <summary>Whether the light that has reached the centre shows the craft in view; see <see cref="CraftKnowledgeReading.LineOfSight"/>.</summary>
        public bool LineOfSight { get; }

        /// <summary>
        /// The radius in metres of the sphere round the craft's centre of mass that holds
        /// all of it, as the centre last heard it: the craft's parts, and the canopy of a
        /// parachute that was part or fully open. Null when the craft's size was not
        /// heard, which is not zero. Useful for framing the craft on a camera, beside
        /// <see cref="UncertaintyM"/>, which is the bound on where it is and not how big
        /// it is.
        /// </summary>
        public double? ExtentM { get; }
    }

    /// <summary>
    /// <see cref="ICraftKnowledge"/> read a whole centre at a time, with a
    /// counter that moves whenever what any centre knows changes. Resolve the
    /// <c>craftKnowledge</c> capability and test it for this interface. Useful
    /// for an Uplink that publishes every craft's known place from a thread
    /// the game does not stall on: it reads again only when
    /// <see cref="Version"/> has moved, into a buffer it keeps, so nothing is
    /// allocated per craft.
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface IBulkCraftKnowledge : ICraftKnowledge
    {
        /// <summary>
        /// A number that is larger after every change to what any centre knows.
        /// Equal numbers mean nothing was written between the two reads; a
        /// reading still ages with the instant it is asked at, so the number
        /// does not move as time passes.
        /// </summary>
        long Version { get; }

        /// <summary>
        /// Fills <paramref name="buffer"/> with what <paramref name="centreId"/>
        /// knows of every craft it has heard or seen, at
        /// <paramref name="ut"/>, and returns how many crafts that is. A buffer
        /// shorter than the count is filled to its length: the caller grows it
        /// and reads again. A centre nothing is known of returns 0. Entries
        /// past the count are left as they were.
        /// </summary>
        /// <param name="centreId">The command centre's id, its <see cref="ICommandCentre.Id"/>.</param>
        /// <param name="ut">The universal time the uncertainty is grown to, normally the game's current time.</param>
        /// <param name="buffer">The caller's own array, written in place.</param>
        /// <param name="version">The <see cref="Version"/> of the board this read was taken from, so a change between two reads cannot go unseen.</param>
        int ReadCentre(string centreId, double ut, CraftKnowledgeSample[] buffer, out long version);
    }
}
