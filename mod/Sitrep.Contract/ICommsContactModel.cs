namespace Sitrep.Contract
{
    /// <summary>
    /// A comms backend that can say, for a pair of nodes, whether their link holds
    /// at a future instant beyond line of sight and range: where a dish is aimed,
    /// how wide its beam is, and which antennas can talk to which.
    ///
    /// <para><b>A companion to <see cref="ICommsBackend"/>.</b> A backend that is
    /// not one of these is planned on geometry alone: line of sight and the reach
    /// its <see cref="ICommsReachModel"/> declares. That is the whole truth for a
    /// network whose antennas see in every direction, and a backend with steered
    /// dishes implements this so a dish aimed elsewhere is never planned as a
    /// contact.</para>
    ///
    /// <para><b>Called on the main thread, evaluated on any thread.</b>
    /// The <see cref="LinkModel"/> member reads live game state, so it is asked where every
    /// other backend read is. The <see cref="IContactLinkModel"/> it returns holds
    /// everything it needs as captured data, aims included, and is evaluated by the
    /// contact planner off the main thread for hours of game time ahead.</para>
    /// </summary>
    /// <category>Comms models</category>
    /// <categoryDescription>
    /// The models a comms backend supplies to say when two nodes can see each other
    /// and how strong the link between them is, for an Uplink that brings its own
    /// radio physics.
    /// </categoryDescription>
    public interface ICommsContactModel
    {
        /// <summary>
        /// The link model between two nodes as they stand now, or <c>null</c> when
        /// this backend has nothing to add to geometry for the pair: the planner
        /// then uses line of sight and the declared reach.
        /// </summary>
        /// <param name="from">One end, as the backend's own node object (a stock <c>CommNode</c> on every shipped backend).</param>
        /// <param name="to">The other end, in the same form.</param>
        /// <param name="ut">The universal time the aims and antennas were read at.</param>
        /// <returns>The model, or <c>null</c> to leave the pair to geometry.</returns>
        IContactLinkModel? LinkModel(object? from, object? to, double ut);
    }

    /// <summary>
    /// One pair's link over time, as a continuous margin: positive while the link
    /// holds, negative while it does not, crossing zero where it opens or closes.
    ///
    /// <para>For steered dishes the natural margin is, per compatible antenna
    /// pair, the smaller of each end's beamwidth less its pointing angle and the
    /// range margin, and the largest of those over the pairs. Any measure works so
    /// long as it is continuous in time and its sign is the answer: the planner
    /// finds the crossings by bisection, so a margin that jumps places an edge
    /// anywhere inside the jump.</para>
    ///
    /// <para><b>Pure.</b> Called from any thread, in any order of
    /// <c>ut</c>, many times for one instant, so the answer for an instant is the
    /// same however it is reached. A model that simulates something that changes
    /// over the plan (a fallback chain stepping to its next target) decides those
    /// changes up front, as a function of time, rather than as state carried from
    /// one call to the next.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface IContactLinkModel
    {
        /// <summary>
        /// The link's margin at <paramref name="ut"/>. Positive is contact; the
        /// unit is the model's own and only its sign and continuity are read.
        /// </summary>
        /// <param name="ut">The universal time to evaluate at.</param>
        /// <param name="from">Where the <c>from</c> end the model was made for is, in metres.</param>
        /// <param name="to">Where the <c>to</c> end is, in the same frame.</param>
        /// <param name="positions">Where every other node and body is at <paramref name="ut"/>, for resolving where each dish points.</param>
        /// <returns>The margin; positive while the link holds.</returns>
        double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions);
    }

    /// <summary>
    /// Where the contact planner predicts every node and body to be, in one
    /// inertial frame, so a link model can resolve what its dishes are aimed at:
    /// another craft, or a body. The planner supplies it; a link model only reads
    /// it.
    /// </summary>
    /// <category>Comms models</category>
    public interface IContactPositions
    {
        /// <summary>
        /// A node's predicted position at <paramref name="ut"/>, by its id in the
        /// <c>commandCentre.roster</c> vocabulary (<c>"ground:&lt;name&gt;"</c>,
        /// <c>"vessel:&lt;guid&gt;"</c>), or <c>null</c> for a node the plan does
        /// not carry.
        /// </summary>
        /// <param name="nodeId">The node's id.</param>
        /// <param name="ut">The universal time.</param>
        /// <returns>The position in metres, or <c>null</c>.</returns>
        Vector3d? NodeAt(string nodeId, double ut);

        /// <summary>A body's predicted centre at <paramref name="ut"/>, in metres.</summary>
        /// <param name="bodyIndex">The body, by the index <see cref="PropagationTarget.BodyIndex"/> uses.</param>
        /// <param name="ut">The universal time.</param>
        /// <returns>The position in metres.</returns>
        Vector3d BodyAt(int bodyIndex, double ut);
    }
}
