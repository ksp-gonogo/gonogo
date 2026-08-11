using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Test double for <see cref="IPartActionActuator"/>: records exactly what each
    /// call was made with (so a test can assert "typed args produced the correct
    /// actuator call with the correct values, unscrambled"), serves a
    /// per-part-configurable event list for the read side, and returns a
    /// configurable result for the invoke, all without touching KSP. Mirrors
    /// <see cref="FakeRoboticsActuator"/>'s "record + configurable" convention.
    /// </summary>
    internal sealed class FakePartActionActuator : IPartActionActuator
    {
        // ---- recorded calls ----
        public readonly List<string> ListedPartIds = new List<string>();
        public string? LastInvokePartId;
        public string? LastInvokeEventName;

        /// <summary>
        /// What <see cref="List"/> answers per part id. An id with no entry here
        /// answers empty, which is exactly what the real actuator does for a part
        /// that does not resolve.
        /// </summary>
        public readonly Dictionary<string, List<PartActionEntry>> ActionsByPartId =
            new Dictionary<string, List<PartActionEntry>>();

        // ---- configurable result (default: success) ----
        public CommandResult InvokeResult = CommandResult.Ok();

        public IReadOnlyList<PartActionEntry> List(string partId)
        {
            ListedPartIds.Add(partId);
            return ActionsByPartId.TryGetValue(partId, out var entries)
                ? entries
                : new List<PartActionEntry>();
        }

        public CommandResult Invoke(string partId, string eventName)
        {
            LastInvokePartId = partId;
            LastInvokeEventName = eventName;
            return InvokeResult;
        }
    }
}
