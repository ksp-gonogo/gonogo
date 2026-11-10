using System.Collections.Generic;
using System.Linq;

namespace Gonogo.KSP.GameWindows
{
    /// <summary>One element of a captured window, in the shape the app draws.</summary>
    internal sealed class CapturedNode
    {
        public string Id = "";
        public string Kind = "";
        public string? Text;
        public bool? Bool;
        public double? Num;
        public double? Min;
        public double? Max;
        public string? Dir;
        public bool Enabled = true;
        public List<string>? Options;
        public string? Tooltip;
        public string? Tone;
        public string? Variant;
        public int? Columns;
        public string? Image;
        public List<CapturedNode>? Children;

        private Dictionary<string, int>? _ordinals;

        /* Ordinal among siblings sharing a key, so a list of "Apply" buttons still gets distinct ids. */
        public int NextOrdinal(string key)
        {
            _ordinals ??= new Dictionary<string, int>();
            _ordinals.TryGetValue(key, out var n);
            _ordinals[key] = n + 1;
            return n;
        }

        public void Add(CapturedNode child) => (Children ??= new List<CapturedNode>()).Add(child);

        public Dictionary<string, object?> ToWire()
        {
            var d = new Dictionary<string, object?> { ["id"] = Id, ["kind"] = Kind };
            if (Text != null) d["text"] = Text;
            if (Bool != null) d["bool"] = Bool;
            if (Num != null) d["num"] = Num;
            if (Min != null) d["min"] = Min;
            if (Max != null) d["max"] = Max;
            if (Dir != null) d["dir"] = Dir;
            if (!Enabled) d["enabled"] = false;
            if (Options != null) d["options"] = Options;
            if (Tooltip != null) d["tooltip"] = Tooltip;
            if (Tone != null) d["tone"] = Tone;
            if (Variant != null) d["variant"] = Variant;
            if (Columns != null) d["columns"] = Columns;
            if (Image != null) d["image"] = Image;
            if (Children != null) d["children"] = Children.Select(c => (object?)c.ToWire()).ToList();
            return d;
        }

        public CapturedNode? Find(string id)
        {
            if (Id == id) return this;
            if (Children == null) return null;
            foreach (var c in Children)
            {
                var hit = c.Find(id);
                if (hit != null) return hit;
            }
            return null;
        }
    }

    internal sealed class WindowOpenedBy
    {
        public string PartId = "";
        public string? Module;
        public string Event = "";
        public string Label = "";

        /// <summary>The session that pressed the button. Read by the channel's viewer filter and never sent to a client.</summary>
        public string Session = "";

        /// <summary>The correlation id of the press that opened the window.</summary>
        public string PressId = "";

        public Dictionary<string, object?> ToWire() => new Dictionary<string, object?>
        {
            ["partId"] = PartId,
            ["module"] = Module,
            ["event"] = Event,
            ["label"] = Label,
            ["pressId"] = PressId,
            [SessionKey] = Session,
        };

        internal const string SessionKey = "session";
    }

    /// <summary>The Topic and command of the game windows Uplink.</summary>
    internal static class GameWindowIds
    {
        internal const string WindowsTopic = "vessel.gameWindows";
        internal const string PressCommand = "vessel.gameWindow.press";
    }

    /// <summary>Why a press cannot go to the control it names, checked against what the window last drew.</summary>
    internal static class PressRefusal
    {
        internal const string WindowClosed = "window is closed";
        internal const string ControlGone = "control is no longer in the window";
        internal const string ControlDisabled = "control is disabled in the game";

        /// <summary>The refusal for a press of <paramref name="controlId"/>, or null when the control can take it.</summary>
        internal static string? For(CapturedNode? tree, string controlId)
        {
            if (tree == null) return WindowClosed;
            var node = tree.Find(controlId);
            if (node == null) return ControlGone;
            return node.Enabled ? null : ControlDisabled;
        }
    }

    /// <summary>One press of a control, waiting for the frame that delivers it.</summary>
    internal sealed class Press
    {
        public string ControlId = "";
        public bool Bool;
        public double Num;
        public string? Text;
    }
}
