using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// A comms backend that can say what a link between two nodes is worth at a
    /// given separation, and what a path of such links is worth as a whole.
    ///
    /// <para><b>A companion to <see cref="ICommsBackend"/>.</b> A command centre
    /// is shown the strength of the path IT believes in, hop by hop, worked out
    /// from what it has heard and from where its plan puts each node. A backend
    /// that is not one of these states no per-hop strength, and a centre is then
    /// shown only the strength the active vessel's own radio last reported.</para>
    ///
    /// <para><b>Asked on the main thread, answered anywhere.</b>
    /// <see cref="LinkStrength"/> reads live game state. The
    /// <see cref="IContactLinkStrength"/> it returns holds what it needs as
    /// captured data and is evaluated off the main thread, as is
    /// <see cref="Combine"/>, which must be pure.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface ICommsPathStrength
    {
        /// <summary>
        /// The strength model between two nodes as their antennas stand now, or
        /// <c>null</c> when this backend states no strength for the pair.
        /// </summary>
        /// <param name="from">One end, as the backend's own node object (a stock <c>CommNode</c> on every shipped backend).</param>
        /// <param name="to">The other end, in the same form.</param>
        /// <param name="ut">The universal time the antennas were read at.</param>
        /// <returns>The model, or <c>null</c> for no stated strength.</returns>
        IContactLinkStrength? LinkStrength(object? from, object? to, double ut);

        /// <summary>
        /// The strength of a whole path from the strengths of its hops, from 0
        /// to 1. Stock CommNet multiplies them; a network whose path carries the
        /// rate of its slowest hop takes the least. Pure, and called from any
        /// thread.
        /// </summary>
        /// <param name="hopStrengths">Each hop's strength, in path order. Never empty.</param>
        /// <returns>The path's strength, from 0 to 1.</returns>
        double Combine(IReadOnlyList<double> hopStrengths);
    }

    /// <summary>
    /// What one pair's link is worth as a function of how far apart its ends
    /// are, with its antennas as they stood when the model was made.
    ///
    /// <para><b>Pure.</b> Called from any thread, any number of times, so the
    /// answer for a separation and an instant is the same however it is
    /// reached.</para>
    ///
    /// <para>It is asked only of a hop the plan already holds to be in contact,
    /// so it need not decide whether a dish is on target: the pair's
    /// <see cref="IContactLinkModel"/> has answered that.</para>
    /// </summary>
    /// <category>Comms models</category>
    public interface IContactLinkStrength
    {
        /// <summary>The link's strength and the backend's facts about the hop.</summary>
        /// <param name="ut">The universal time to evaluate at.</param>
        /// <param name="separationMeters">How far apart the two ends are, in metres.</param>
        /// <returns>The hop's facts at that separation.</returns>
        ContactHopFacts FactsAt(double ut, double separationMeters);
    }

    /// <summary>
    /// What a backend says of one hop at one separation: how strong the link
    /// is, and whatever else it knows of the hop.
    /// </summary>
    /// <category>Comms models</category>
    public readonly struct ContactHopFacts
    {
        /// <summary>Makes the facts of one hop.</summary>
        /// <param name="strength">The link's strength, from 0 to 1, in the backend's own meaning.</param>
        /// <param name="extensions">The backend's own facts about the hop, in the shape <see cref="CommsHop.Extensions"/> carries, or <c>null</c> for none.</param>
        public ContactHopFacts(double strength, Dictionary<string, object?>? extensions = null)
        {
            Strength = strength;
            Extensions = extensions;
        }

        /// <summary>The link's strength, from 0 (nothing) to 1 (full), in the backend's own meaning.</summary>
        public double Strength { get; }

        /// <summary>The backend's own facts about the hop, in the shape <see cref="CommsHop.Extensions"/> carries, or <c>null</c> for none.</summary>
        public Dictionary<string, object?>? Extensions { get; }
    }
}
