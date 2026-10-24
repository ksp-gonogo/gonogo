using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// The tech tree's nodes, each tech id once.
    ///
    /// <para>The game's own list can hold the whole tree twice. When the R&amp;D tree
    /// spawns while its controller already holds nodes, <c>RDTechTree.SpawnTechTreeNodes</c>
    /// wipes the controller's nodes but reloads the tree into its static node list
    /// without clearing it first, and rebuilds <c>GetTreeNodes()</c> and
    /// <c>GetTreeTechs()</c> from the doubled list. A walk that takes either as found
    /// lists every node twice, and the operator can research either copy.</para>
    /// </summary>
    internal static class TechTreeWalk
    {
        /// <summary>The first node for each tech id, in tree order; nodes with no id are dropped.</summary>
        public static IEnumerable<T> DistinctByTechId<T>(IEnumerable<T> nodes, Func<T, string?> techId)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var node in nodes)
            {
                var id = techId(node);
                if (!string.IsNullOrEmpty(id) && seen.Add(id!))
                {
                    yield return node;
                }
            }
        }
    }
}
