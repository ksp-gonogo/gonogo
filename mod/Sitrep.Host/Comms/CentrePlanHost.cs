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

        /// <summary>News of the node <paramref name="nodeId"/> has just reached <paramref name="centre"/>. Courier thread only.</summary>
        void NoteHeard(string centre, string nodeId);
    }
}
