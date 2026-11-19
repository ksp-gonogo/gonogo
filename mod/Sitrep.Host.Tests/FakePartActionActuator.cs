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
        public readonly List<string> ListedPartIds = new List<string>();
        public string? LastInvokePartId;
        public string? LastInvokeEventName;
        public int? LastInvokeModuleIndex;

        /// <summary>
        /// What <see cref="List"/> answers per part id. An id with no entry here
        /// answers empty, which is exactly what the real actuator does for a part
        /// that does not resolve.
        /// </summary>
        public readonly Dictionary<string, List<PartActionEntry>> ActionsByPartId =
            new Dictionary<string, List<PartActionEntry>>();

        public readonly List<string> ListedWindowPartIds = new List<string>();

        public readonly Dictionary<string, List<PartWindowItem>> WindowByPartId =
            new Dictionary<string, List<PartWindowItem>>();

        public IReadOnlyList<PartWindowItem> ListWindow(string partId)
        {
            ListedWindowPartIds.Add(partId);
            return WindowByPartId.TryGetValue(partId, out var items) ? items : new List<PartWindowItem>();
        }

        public CommandResult InvokeResult = CommandResult.Ok();

        public string? LastSetFieldPartId;
        public string? LastSetFieldModule;
        public string? LastSetFieldName;
        public double? LastSetFieldValue;
        public CommandResult SetFieldResult = CommandResult.Ok();

        public IReadOnlyList<PartActionEntry> List(string partId)
        {
            ListedPartIds.Add(partId);
            return ActionsByPartId.TryGetValue(partId, out var entries)
                ? entries
                : new List<PartActionEntry>();
        }

        public CommandResult Invoke(string partId, string eventName, int? moduleIndex)
        {
            LastInvokeModuleIndex = moduleIndex;
            LastInvokePartId = partId;
            LastInvokeEventName = eventName;
            return InvokeResult;
        }

        public CommandResult SetField(string partId, string moduleName, string fieldName, double value)
        {
            LastSetFieldPartId = partId;
            LastSetFieldModule = moduleName;
            LastSetFieldName = fieldName;
            LastSetFieldValue = value;
            return SetFieldResult;
        }
    }
}
