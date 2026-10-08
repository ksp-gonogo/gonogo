namespace Sitrep.Contract
{
    /// <summary>
    /// The two dishes that carry one link, one on each end. Either is
    /// <c>null</c> when that end has no steered dish on the link, as an omni
    /// antenna or a stock antenna has none.
    ///
    /// <para>A dish id is <c>"&lt;nodeId&gt;#&lt;partPersistentId&gt;/&lt;ordinal&gt;"</c>:
    /// the node it is on, in the <c>commandCentre.roster</c> vocabulary, then the
    /// part's persistent id and the antenna's ordinal on that part. It is the key
    /// a backend's restore record is stored under, so an id read from a plan names
    /// the same antenna after a save and a load, on a craft that is on rails.</para>
    /// </summary>
    /// <category>Comms models</category>
    public readonly struct DishPair
    {
        /// <summary>A pair of dishes, either of which may be null.</summary>
        /// <param name="fromDish">The dish on the <c>from</c> end, or null.</param>
        /// <param name="toDish">The dish on the <c>to</c> end, or null.</param>
        public DishPair(string? fromDish, string? toDish)
        {
            FromDish = fromDish;
            ToDish = toDish;
        }

        /// <summary>The dish on the <c>from</c> end that carries the link, or null.</summary>
        public string? FromDish { get; }

        /// <summary>The dish on the <c>to</c> end that carries the link, or null.</summary>
        public string? ToDish { get; }

        /// <summary>Whether neither end names a dish.</summary>
        public bool IsEmpty => FromDish == null && ToDish == null;
    }

    /// <summary>
    /// An <see cref="IContactLinkModel"/> that also says which dish carries the
    /// link at each instant, so the network can tell which dish a message is on its
    /// way to, and which dishes are idle.
    ///
    /// <para>Same rules as the link model: pure, finite, called from any thread in
    /// any order. The dishes are a function of time alone, so a model that
    /// simulates a fallback chain decides its steps up front, as it does for the
    /// margin.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface IAttributedContactLinkModel : IContactLinkModel
    {
        /// <summary>
        /// The dishes carrying the pair's link at <paramref name="ut"/>, the pair of
        /// antennas that gives <see cref="IContactLinkModel.MarginAt"/> its best
        /// margin. Only meaningful while that margin is positive.
        /// </summary>
        /// <param name="ut">The universal time to evaluate at.</param>
        /// <param name="from">Where the <c>from</c> end is, in metres.</param>
        /// <param name="to">Where the <c>to</c> end is, in the same frame.</param>
        /// <param name="positions">Where every other node and body is at <paramref name="ut"/>.</param>
        /// <returns>The dish on each end, null for an end with none.</returns>
        DishPair DishesAt(double ut, Vector3d from, Vector3d to, IContactPositions positions);
    }

    /// <summary>One steered dish on a node, and what it is aimed at.</summary>
    /// <category>Comms models</category>
    public readonly struct DishAim
    {
        /// <summary>A dish and what it is aimed at.</summary>
        /// <param name="dishId">The dish's id.</param>
        /// <param name="aimLabel">What it is aimed at, in words.</param>
        public DishAim(string dishId, string aimLabel)
        {
            DishId = dishId;
            AimLabel = aimLabel;
        }

        /// <summary>The dish's id, as <see cref="DishPair"/> spells it.</summary>
        public string DishId { get; }

        /// <summary>What the dish is aimed at, in words an operator reads: a body, a craft, a station.</summary>
        public string AimLabel { get; }
    }

    /// <summary>
    /// A comms backend that can turn a dish to carry a message. Implemented
    /// beside <see cref="ICommsContactModel"/> by a backend with steered dishes.
    ///
    /// <para><see cref="RetargetModel"/> is read on the main thread, one node at
    /// a time as each craft's state is recorded, so what a command centre plans
    /// from is the dishes as it last heard them. <see cref="TurnDish"/> and
    /// <see cref="RestoreDish"/> are called on the game's main thread, which the
    /// host hands them to. <see cref="AutoRetargetAllowed"/> and
    /// <see cref="PeerCanReceive"/> are read from any thread, inside the network's
    /// lock, so they answer from data the backend captured on the main thread and
    /// never wait on it.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface ICommsRetargetBackend
    {
        /// <summary>
        /// The retarget model for one node as its dishes stand now, captured as data
        /// so the planner can evaluate it off the main thread. It answers for that
        /// node's own dishes and for whether that node can receive. Null when the
        /// node has no dish it would turn.
        /// </summary>
        /// <param name="node">The backend's own node object, as <see cref="ICommsContactModel.LinkModel"/> takes.</param>
        /// <param name="ut">The universal time the aims were read at.</param>
        IRetargetModel? RetargetModel(object? node, double ut);

        /// <summary>
        /// Whether <paramref name="peerId"/> can receive light that <paramref name="nodeId"/>
        /// sent it, as the game's links stand now, whatever <paramref name="nodeId"/> has
        /// aimed since. Judges the landing of a hop sent on a dish that has been turned
        /// back: the light left on the turned dish and travels on.
        /// </summary>
        bool PeerCanReceive(string peerId, string nodeId, double ut);

        /// <summary>Whether <paramref name="nodeId"/> may turn a dish on its own right now. False for a craft whose operator has opted out. Read from any thread.</summary>
        bool AutoRetargetAllowed(string nodeId);

        /// <summary>
        /// Aims <paramref name="dishId"/> of <paramref name="nodeId"/> at
        /// <paramref name="peerId"/>, saving what it was aimed at first, and
        /// returns the id of the restore record, or null when the dish would not
        /// turn. The record is kept with the game, so a save and a load, or a craft
        /// going on rails, does not lose what the dish must go back to.
        /// </summary>
        string? TurnDish(string nodeId, string dishId, string peerId, double ut);

        /// <summary>
        /// Puts a dish back as <paramref name="recordId"/> says, only if it is still
        /// aimed where the turn put it. Idempotent: a record already restored, or a
        /// dish someone else has aimed since, is left alone. Returns whether the
        /// record is now settled.
        /// </summary>
        bool RestoreDish(string recordId, double ut);
    }

    /// <summary>
    /// What turning a node's dish toward a peer would do, as a pure function of
    /// time over captured data.
    ///
    /// <para>The network decides, from this and from the plan, whether a node
    /// holding a message for a peer should turn an idle dish to it: the dish must
    /// close the link when aimed at the peer, and the peer must already be able to
    /// receive from the node without changing anything.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface IRetargetModel
    {
        /// <summary>Whether <paramref name="nodeId"/> may turn a dish on its own. False for a craft whose operator has opted out.</summary>
        bool AutoRetargetAllowed(string nodeId);

        /// <summary>The steered dishes <paramref name="nodeId"/> could turn, with what each is aimed at.</summary>
        System.Collections.Generic.IReadOnlyList<DishAim> DishesOf(string nodeId);

        /// <summary>
        /// The margin of the link from <paramref name="dishId"/> to <paramref name="peerId"/> if the dish were
        /// aimed at the peer: positive while it would hold. Continuous in time, as
        /// <see cref="IContactLinkModel.MarginAt"/> is.
        /// </summary>
        double MarginIfAimedAt(string dishId, string peerId, double ut, Vector3d dish, Vector3d peer, IContactPositions positions);

        /// <summary>
        /// The margin of the peer's side: positive while <paramref name="peerId"/> can
        /// receive from <paramref name="nodeId"/> with nothing changed on its end.
        /// </summary>
        double PeerReceiveMargin(string peerId, string nodeId, double ut, Vector3d peer, Vector3d node, IContactPositions positions);
    }
}
