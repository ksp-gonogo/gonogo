using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    public sealed partial class ChannelEngine
    {
        /// <summary>
        /// The dynamic namespaces registered so far, by prefix, with the template
        /// each was registered under. Read by <c>scripts/uplink-routing-probe</c>,
        /// which asks the engine how it routes what a released Uplink declared.
        /// </summary>
        internal IReadOnlyDictionary<string, ChannelDeclaration> DynamicNamespaceTemplates => _dynamicNamespaces;

        /// <summary>
        /// The publishing side of a namespace that is already registered, for a
        /// caller that is not the Uplink which registered it.
        /// </summary>
        internal IDynamicChannelSource DynamicSourceFor(string prefix) => new DynamicChannelSource(this, prefix);
    }
}
