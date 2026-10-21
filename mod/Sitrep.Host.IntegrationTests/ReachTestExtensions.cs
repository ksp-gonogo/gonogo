using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host.IntegrationTests
{
    internal static class ReachTestExtensions
    {
        /// <summary>Hands the engine a set of nodes each centre has no route to, carrying neither way.</summary>
        public static void SetUnroutable(this ChannelEngine engine, IReadOnlyDictionary<string, IReadOnlyCollection<string>> nodesByCentre) =>
            engine.SetCarried(nodesByCentre.ToDictionary(
                row => row.Key,
                row => (IReadOnlyDictionary<string, CommsDirection>)row.Value.ToDictionary(node => node, _ => CommsDirection.None)));
    }
}
