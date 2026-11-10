using System;
using System.Collections.Generic;
using System.Linq;
using HarmonyLib;
using UnityEngine;

namespace Gonogo.KSP.GameWindows
{
    /// <summary>
    /// Records what an immediate-mode window draws by patching the Unity <c>GUI</c> calls
    /// every GUILayout control ends up in, and drives a control by returning a
    /// chosen value from that call.
    ///
    /// <para>A window's content runs inside <c>GUI.CallWindowDelegate</c> once per <c>GUI</c>
    /// event. Controls are recorded on the Repaint pass only. To deliver a press,
    /// one Repaint pass is turned into a MouseUp pass: the preceding Layout pass
    /// has already reset the layout cursors, so the content runs against a valid
    /// layout, no control draws, and the handler for the pressed control runs at
    /// the point in the event cycle where a real click would run it, so it can
    /// change what the next Layout pass emits without a layout mismatch.</para>
    /// </summary>
    internal static class ImguiCapture
    {
        internal sealed class Window
        {
            public int Id;
            public string Title = "";
            public string Owner = "";
            public Rect Rect;
            public int LastSeenFrame = -1;
            public bool Tracked;
            public WindowOpenedBy? OpenedBy;
            public CapturedNode? Tree;
            public float NextRecordAt;
            public readonly Queue<Press> Presses = new Queue<Press>();
        }

        private const float RecordIntervalSeconds = 0.25f;
        private const int ClosedAfterFrames = 30;

        internal static readonly Dictionary<int, Window> Windows = new Dictionary<int, Window>();

        private static Window? _recording;
        private static CapturedNode? _root;
        private static readonly Stack<CapturedNode> Groups = new Stack<CapturedNode>();
        private static Press? _drive;
        private static Window? _driveWindow;

        internal static void Patch(Harmony harmony)
        {
            var gui = typeof(GUI);
            var layout = typeof(GUILayout);
            var util = typeof(GUILayoutUtility);

            Prefix(harmony, AccessTools.Method(gui, "DoWindow",
                new[] { typeof(int), typeof(Rect), typeof(GUI.WindowFunction), typeof(GUIContent), typeof(GUIStyle), typeof(GUISkin), typeof(bool) }),
                nameof(DoWindowPrefix));
            var call = AccessTools.Method(gui, "CallWindowDelegate");
            harmony.Patch(call,
                new HarmonyMethod(typeof(ImguiCapture), nameof(CallWindowPrefix)),
                new HarmonyMethod(typeof(ImguiCapture), nameof(CallWindowPostfix)));

            /*
             * GUI.Label is 17 IL bytes, under Mono's inline limit, so a caller compiled
             * after inlining it never reaches this patch. GUILayout.DoLabel is the
             * funnel for every layout label and is patched as well; it suppresses the
             * inner GUI.Label so a label is recorded once whichever of the two runs.
             */
            Prefix(harmony, AccessTools.Method(gui, "Label", new[] { typeof(Rect), typeof(GUIContent), typeof(GUIStyle) }), nameof(LabelPrefix));
            harmony.Patch(AccessTools.Method(layout, "DoLabel"),
                new HarmonyMethod(typeof(ImguiCapture), nameof(DoLabelPrefix)),
                new HarmonyMethod(typeof(ImguiCapture), nameof(DoLabelPostfix)));
            Prefix(harmony, AccessTools.Method(gui, "Box", new[] { typeof(Rect), typeof(GUIContent), typeof(GUIStyle) }), nameof(BoxPrefix));
            Postfix(harmony, AccessTools.Method(gui, "Button", new[] { typeof(Rect), typeof(GUIContent), typeof(GUIStyle) }), nameof(ButtonPostfix));
            Postfix(harmony, AccessTools.Method(gui, "Toggle", new[] { typeof(Rect), typeof(bool), typeof(GUIContent), typeof(GUIStyle) }), nameof(TogglePostfix));
            Postfix(harmony, AccessTools.Method(gui, "DoTextField",
                new[] { typeof(Rect), typeof(int), typeof(GUIContent), typeof(bool), typeof(int), typeof(GUIStyle), typeof(string), typeof(char) }),
                nameof(TextFieldPostfix));
            Postfix(harmony, AccessTools.Method(gui, "Slider",
                new[] { typeof(Rect), typeof(float), typeof(float), typeof(float), typeof(float), typeof(GUIStyle), typeof(GUIStyle), typeof(bool), typeof(int), typeof(GUIStyle) }),
                nameof(SliderPostfix));
            Postfix(harmony, AccessTools.Method(gui, "DoButtonGrid"), nameof(GridPostfix));
            Postfix(harmony, AccessTools.Method(gui, "DoRepeatButton"), nameof(ButtonPostfix));

            Prefix(harmony, AccessTools.Method(util, "BeginLayoutGroup"), nameof(BeginGroupPrefix));
            Prefix(harmony, AccessTools.Method(util, "EndLayoutGroup"), nameof(EndGroupPrefix));
            Postfix(harmony, AccessTools.Method(layout, "BeginHorizontal", new[] { typeof(GUIContent), typeof(GUIStyle), typeof(GUILayoutOption[]) }), nameof(HorizontalPostfix));
        }

        private static void Prefix(Harmony h, System.Reflection.MethodInfo m, string patch) =>
            h.Patch(m, prefix: new HarmonyMethod(typeof(ImguiCapture), patch));

        private static void Postfix(Harmony h, System.Reflection.MethodInfo m, string patch) =>
            h.Patch(m, postfix: new HarmonyMethod(typeof(ImguiCapture), patch));

        private static Window Get(int id)
        {
            if (!Windows.TryGetValue(id, out var w))
            {
                w = new Window { Id = id };
                Windows[id] = w;
            }
            return w;
        }

        public static void DoWindowPrefix(int id, Rect clientRect, GUI.WindowFunction func, GUIContent title)
        {
            var w = Get(id);
            w.Title = title?.text ?? "";
            w.Rect = clientRect;
            if (w.Owner.Length == 0)
            {
                w.Owner = OwnerName(func);
            }
        }

        private static string OwnerName(GUI.WindowFunction func)
        {
            // GUILayout.Window wraps the caller's function; the wrapper's field holds the real one.
            var target = func.Target;
            if (target != null && target.GetType().Name == "LayoutedWindow")
            {
                var inner = Traverse.Create(target).Field("m_Func").GetValue() as GUI.WindowFunction;
                if (inner != null) func = inner;
            }
            return func.Method.DeclaringType?.FullName ?? func.Method.Name;
        }

        public static void CallWindowPrefix(int id, out bool __state)
        {
            __state = false;
            var ev = Event.current;
            if (ev == null || ev.type != EventType.Repaint) return;

            var w = Get(id);
            bool wasAway = w.LastSeenFrame < Time.frameCount - ClosedAfterFrames;
            w.LastSeenFrame = Time.frameCount;
            if (wasAway && !w.Tracked)
            {
                var opener = OpenerWatch.Claim();
                if (opener != null)
                {
                    w.Tracked = true;
                    w.OpenedBy = opener;
                    Debug.Log($"[GameWindows] imgui window {id} '{w.Title}' ({w.Owner}) opened by {opener.Module}.{opener.Event} on part {opener.PartId}");
                }
            }
            if (!w.Tracked) return;

            if (w.Presses.Count > 0)
            {
                _drive = w.Presses.Dequeue();
                _driveWindow = w;
                ev.type = EventType.MouseUp;
                __state = true;
            }

            if (__state || Time.realtimeSinceStartup >= w.NextRecordAt)
            {
                _recording = w;
                _root = new CapturedNode { Id = "w", Kind = "group", Dir = "v" };
                Groups.Clear();
                Groups.Push(_root);
            }
        }

        public static void CallWindowPostfix(int id, bool __state)
        {
            if (__state && Event.current != null)
            {
                Event.current.type = EventType.Repaint;
            }
            if (_recording != null && _recording.Id == id)
            {
                if (!__state)
                {
                    _recording.Tree = _root;
                    _recording.NextRecordAt = Time.realtimeSinceStartup + RecordIntervalSeconds;
                }
                _recording = null;
                _root = null;
                Groups.Clear();
            }
            if (__state)
            {
                if (_drive != null)
                {
                    Debug.LogWarning($"[GameWindows] press for {_drive.ControlId} matched no control this pass");
                    _drive = null;
                }
                _driveWindow = null;
            }
        }

        private static CapturedNode? AddControl(string kind, string? text, bool keyByText, GUIContent? content = null)
        {
            if (_recording == null) return null;
            var parent = Groups.Peek();
            var key = keyByText ? kind + "|" + text : kind;
            var ordinal = parent.NextOrdinal(key);
            var node = new CapturedNode
            {
                Id = parent.Id + "/" + kind + ordinal + (keyByText ? ":" + (text ?? content?.image?.name) : ""),
                Kind = kind,
                Text = text,
                Enabled = GUI.enabled,
                Tooltip = string.IsNullOrEmpty(content?.tooltip) ? null : content!.tooltip,
                Image = content?.image != null ? content.image.name : null,
                Tone = ToneOf(GUI.color) ?? ToneOf(GUI.contentColor),
            };
            parent.Add(node);
            return node;
        }

        /* A window that sets GUI.color is saying something about the state of the control; the game's own skin colours are not read. */
        private static string? ToneOf(Color c)
        {
            if (c.r > 0.85f && c.g > 0.85f && c.b > 0.85f) return null;
            if (c.r > c.g * 1.4f && c.r > c.b * 1.4f) return c.g > 0.5f ? "warn" : "nogo";
            if (c.g > c.r * 1.2f && c.g > c.b * 1.2f) return "go";
            return null;
        }

        private static string? Text(GUIContent? content) =>
            content == null || string.IsNullOrEmpty(content.text) ? null : content.text;

        private static bool TakeDrive(CapturedNode? node, out Press press)
        {
            press = null!;
            if (node == null || _drive == null || _drive.ControlId != node.Id) return false;
            press = _drive;
            _drive = null;
            if (!node.Enabled) return false;
            /* A real control consumes its event, so the rest of the pass skips layout even if the press changes what the window draws. */
            Event.current.Use();
            return true;
        }

        private static bool _inDoLabel;

        public static void DoLabelPrefix(GUIContent content)
        {
            _inDoLabel = true;
            AddLabel(content);
        }

        private static void AddLabel(GUIContent content)
        {
            if (Text(content) != null || content?.image != null) AddControl("label", Text(content), false, content);
        }

        public static void DoLabelPostfix() => _inDoLabel = false;

        public static void LabelPrefix(GUIContent content)
        {
            if (_inDoLabel) return;
            AddLabel(content);
        }

        public static void BoxPrefix(GUIContent content)
        {
            var t = Text(content);
            if (t != null) AddControl("box", t, false);
        }

        public static void ButtonPostfix(GUIContent content, ref bool __result)
        {
            if (Text(content) == null && content?.image == null) return;
            var node = AddControl("button", Text(content), true, content);
            if (node != null) node.Tone = node.Tone ?? ToneOf(GUI.backgroundColor);
            if (TakeDrive(node, out _)) __result = true;
        }

        public static void TogglePostfix(bool value, GUIContent content, GUIStyle style, ref bool __result)
        {
            if (Text(content) == null && content?.image == null) return;
            var node = AddControl("toggle", Text(content), true, content);
            if (node == null) return;
            node.Bool = value;
            if (style == GUI.skin.button || style.name.IndexOf("button", StringComparison.OrdinalIgnoreCase) >= 0) node.Variant = "button";
            if (TakeDrive(node, out var press)) __result = press.Bool;
        }

        public static void TextFieldPostfix(GUIContent content, bool multiline)
        {
            var node = AddControl(multiline ? "textarea" : "textfield", content.text, false);
            if (node == null) return;
            if (TakeDrive(node, out var press))
            {
                content.text = press.Text ?? "";
                GUI.changed = true;
            }
        }

        public static void SliderPostfix(float value, float size, float start, float end, ref float __result)
        {
            if (size != 0f) return;
            var node = AddControl("slider", null, false);
            if (node == null) return;
            node.Num = value;
            node.Min = Math.Min(start, end);
            node.Max = Math.Max(start, end);
            if (TakeDrive(node, out var press)) __result = (float)press.Num;
        }

        public static void GridPostfix(int selected, GUIContent[] contents, int xCount, ref int __result)
        {
            var node = AddControl("grid", null, false);
            if (node == null) return;
            node.Num = selected;
            node.Columns = xCount;
            node.Options = contents.Select(c => Text(c) ?? c.tooltip ?? c.image?.name ?? "").ToList();
            if (TakeDrive(node, out var press)) __result = (int)press.Num;
        }

        public static void BeginGroupPrefix(Type layoutType)
        {
            var node = AddControl(layoutType.Name.Contains("Scroll") ? "scroll" : "group", null, false);
            if (node == null) return;
            node.Dir = "v";
            Groups.Push(node);
        }

        public static void EndGroupPrefix()
        {
            if (_recording != null && Groups.Count > 1) Groups.Pop();
        }

        public static void HorizontalPostfix()
        {
            if (_recording != null && Groups.Count > 1) Groups.Peek().Dir = "h";
        }

        internal static IEnumerable<Dictionary<string, object?>> Wire()
        {
            var cutoff = Time.frameCount - ClosedAfterFrames;
            foreach (var w in Windows.Values.ToList())
            {
                if (!w.Tracked) continue;
                if (w.LastSeenFrame < cutoff)
                {
                    w.Tracked = false;
                    w.Tree = null;
                    w.OpenedBy = null;
                    continue;
                }
                if (w.Tree == null) continue;
                yield return new Dictionary<string, object?>
                {
                    ["id"] = "imgui:" + w.Id,
                    ["technology"] = "imgui",
                    ["title"] = w.Title,
                    ["openedBy"] = w.OpenedBy?.ToWire(),
                    ["root"] = w.Tree.ToWire(),
                };
            }
        }

        internal static string? Enqueue(int id, Press press)
        {
            if (!Windows.TryGetValue(id, out var w) || !w.Tracked) return PressRefusal.WindowClosed;
            var refusal = PressRefusal.For(w.Tree, press.ControlId);
            if (refusal == null) w.Presses.Enqueue(press);
            return refusal;
        }
    }
}
