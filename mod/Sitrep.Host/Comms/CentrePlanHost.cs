using System;
using Sitrep.Propagation.Contacts;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Takes each command centre's own contact plan, for whatever sends on a
    /// centre's belief: store-and-forward delivery, its predictions, and the
    /// refusal of a continuous input that would wait.
    /// </summary>
    public interface ICentrePlanHost
    {
        /// <param name="planOf">The plan a centre holds now, or null when it holds none. Courier thread only.</param>
        /// <param name="version">A count that moves each time any centre's plan is replaced or dropped. Any thread.</param>
        void SetCentrePlans(Func<string, ContactPlan?> planOf, Func<int> version);

        /// <summary>
        /// Takes the name a centre knows a node by: a craft's as the centre last
        /// heard it, a ground station's own. Null from the lookup when the centre
        /// knows none. Courier thread only.
        /// </summary>
        /// <param name="nameAt">The centre, then the node's id.</param>
        void SetNodeNames(Func<string, string, string?> nameAt);

        /// <summary>
        /// Takes the two calls a save and a load need of what the centres have
        /// heard: read it now, on any thread, and at each reset of the
        /// timeline, on the courier thread and before the reset is announced,
        /// what to start the new timeline knowing, or null for nothing.
        /// </summary>
        void SetHeardStore(Func<HeardSnapshot?> now, Action<HeardSnapshot?> restoreAtReset);

        /// <summary>News of the node <paramref name="nodeId"/> has just reached <paramref name="centre"/>. Courier thread only.</summary>
        void NoteHeard(string centre, string nodeId);
    }
}
