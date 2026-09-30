using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// <c>system.frame</c> as the dictionary the writer takes. A contract POCO on
    /// the wire throws in the writer and takes the whole uplink down with it,
    /// every channel and command at once, so the frame and each of its settable
    /// frames travel flattened.
    /// </summary>
    internal static class ControlFrameWire
    {
        internal static Dictionary<string, object?> Flatten(ControlFrame frame) =>
            new Dictionary<string, object?>
            {
                ["kind"] = (int)frame.Kind,
                ["centreBody"] = frame.CentreBody,
                ["primaryBody"] = frame.PrimaryBody,
                ["secondaryBody"] = frame.SecondaryBody,
                ["primaryBodies"] = frame.PrimaryBodies,
                ["secondaryBodies"] = frame.SecondaryBodies,
                ["targetFrameSelected"] = frame.TargetFrameSelected,
                ["targetId"] = frame.TargetId,
                ["settableFrames"] = frame.SettableFrames?
                    .Select(option => (object?)FlattenOption(option))
                    .ToList(),
            };

        internal static Dictionary<string, object?> FlattenOption(ControlFrameOption option) =>
            new Dictionary<string, object?>
            {
                ["kind"] = (int)option.Kind,
                ["centreBody"] = option.CentreBody,
                ["primaryBody"] = option.PrimaryBody,
                ["secondaryBody"] = option.SecondaryBody,
                ["targetFrameSelected"] = option.TargetFrameSelected,
            };
    }
}
