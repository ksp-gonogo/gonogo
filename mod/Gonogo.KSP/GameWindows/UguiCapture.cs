using System.Collections.Generic;
using System.Linq;
using KSP.UI;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

namespace Gonogo.KSP.GameWindows
{
    /// <summary>
    /// Finds the top-level object a part menu button added to one of the game's UI
    /// canvases, and walks its GameObject tree into the same shape as an
    /// immediate-mode capture. Works for any retained dialog, including the ones
    /// built from prefabs with no MultiOptionDialog behind them.
    /// </summary>
    internal static class UguiCapture
    {
        private sealed class Tracked
        {
            public string Key = "";
            public Transform Root = null!;
            public WindowOpenedBy? OpenedBy;
            public CapturedNode? Tree;
            public readonly Dictionary<string, Component> Controls = new Dictionary<string, Component>();
            public float NextWalkAt;
        }

        private const float WalkIntervalSeconds = 0.25f;

        private static readonly List<Tracked> Windows = new List<Tracked>();
        private static readonly HashSet<int> Before = new HashSet<int>();

        private static IEnumerable<Transform> Canvases()
        {
            var ui = UIMasterController.Instance;
            if (ui != null)
            {
                foreach (var c in new[] { ui.dialogCanvas, ui.mainCanvas, ui.actionCanvas, ui.appCanvas })
                {
                    if (c != null) yield return c.transform;
                }
            }
            var popups = PopupDialogController.PopupDialogCanvas;
            if (popups != null) yield return popups.transform;
        }

        internal static void SnapshotCanvases()
        {
            Before.Clear();
            foreach (var canvas in Canvases())
            {
                foreach (Transform child in canvas) Before.Add(child.GetInstanceID());
            }
        }

        internal static void Tick()
        {
            if (OpenerWatch.Watching)
            {
                foreach (var canvas in Canvases())
                {
                    foreach (Transform child in canvas)
                    {
                        if (Before.Contains(child.GetInstanceID())) continue;
                        if (Windows.Any(w => w.Root == child)) continue;
                        Before.Add(child.GetInstanceID());
                        if (child.GetComponentInChildren<Selectable>(true) == null) continue;
                        var opener = OpenerWatch.Claim();
                        if (opener == null) continue;
                        Windows.Add(new Tracked { Key = "ugui:" + child.GetInstanceID(), Root = child, OpenedBy = opener });
                        Debug.Log($"[GameWindows] ugui window '{child.name}' opened by {opener.Module}.{opener.Event} on part {opener.PartId}");
                    }
                }
            }

            Windows.RemoveAll(w => w.Root == null);
            foreach (var w in Windows)
            {
                if (Time.realtimeSinceStartup < w.NextWalkAt) continue;
                w.NextWalkAt = Time.realtimeSinceStartup + WalkIntervalSeconds;
                w.Controls.Clear();
                var root = new CapturedNode { Id = "w", Kind = "group", Dir = "v" };
                foreach (Transform child in w.Root) Walk(child, root, w);
                w.Tree = root;
            }
        }

        private static string? TextOf(Component c)
        {
            var t = c.GetType().GetProperty("text")?.GetValue(c, null) as string;
            if (string.IsNullOrWhiteSpace(t)) return null;
            return t!.StartsWith("#") ? global::KSP.Localization.Localizer.Format(t) : t;
        }

        private static Component? TmpOrText(GameObject go)
        {
            foreach (var c in go.GetComponents<Component>())
            {
                if (c == null) continue;
                var n = c.GetType().Name;
                if (c is Text || n == "TextMeshProUGUI" || n == "TMP_Text" || n == "TextMeshPro") return c;
            }
            return null;
        }

        private static bool Multiline(Component input)
        {
            if (input is InputField field) return field.multiLine;
            var property = input.GetType().GetProperty("multiLine");
            return property != null && (bool)property.GetValue(input, null);
        }

        private static Component? FindType(GameObject go, string typeName) =>
            go.GetComponents<Component>().FirstOrDefault(c => c != null && c.GetType().Name == typeName);

        private static string LabelIn(Transform t)
        {
            foreach (var c in t.GetComponentsInChildren<Component>(false))
            {
                if (c == null) continue;
                var n = c.GetType().Name;
                if (c is Text || n == "TextMeshProUGUI" || n == "TMP_Text")
                {
                    var s = TextOf(c);
                    if (s != null) return s;
                }
            }
            return "";
        }

        private static CapturedNode AddNode(CapturedNode parent, Tracked w, string kind, string? text, Component? control, Transform t)
        {
            var key = kind + "|" + t.name;
            var node = new CapturedNode
            {
                Id = parent.Id + "/" + kind + parent.NextOrdinal(key) + ":" + t.name,
                Kind = kind,
                Text = text,
            };
            parent.Add(node);
            if (control != null) w.Controls[node.Id] = control;
            return node;
        }

        private static void Walk(Transform t, CapturedNode parent, Tracked w)
        {
            if (!t.gameObject.activeInHierarchy) return;
            var go = t.gameObject;

            var input = (Component?)go.GetComponent<InputField>() ?? FindType(go, "TMP_InputField");
            if (input != null)
            {
                var node = AddNode(parent, w, Multiline(input) ? "textarea" : "textfield", TextOf(input), input, t);
                node.Enabled = input is Selectable s1 ? s1.interactable : true;
                return;
            }
            var button = go.GetComponent<Button>();
            if (button != null)
            {
                var node = AddNode(parent, w, "button", LabelIn(t), button, t);
                node.Enabled = button.interactable;
                return;
            }
            var toggle = go.GetComponent<Toggle>();
            if (toggle != null)
            {
                var node = AddNode(parent, w, toggle.group != null ? "radio" : "toggle", LabelIn(t), toggle, t);
                node.Bool = toggle.isOn;
                if (t.name.IndexOf("button", System.StringComparison.OrdinalIgnoreCase) >= 0) node.Variant = "button";
                node.Enabled = toggle.interactable;
                return;
            }
            var slider = go.GetComponent<Slider>();
            if (slider != null)
            {
                var node = AddNode(parent, w, "slider", null, slider, t);
                node.Num = slider.value;
                node.Min = slider.minValue;
                node.Max = slider.maxValue;
                node.Enabled = slider.interactable;
                return;
            }
            var label = TmpOrText(go);
            if (label != null)
            {
                var text = TextOf(label);
                if (text != null) AddNode(parent, w, "label", text, null, t);
            }

            if (t.childCount == 0) return;
            var layoutH = go.GetComponent<HorizontalLayoutGroup>() != null;
            var group = AddNode(parent, w, "group", null, null, t);
            group.Dir = layoutH ? "h" : "v";
            if (go.GetComponent<ScrollRect>() != null) group.Kind = "scroll";
            var grid = go.GetComponent<GridLayoutGroup>();
            if (grid != null && grid.constraint == GridLayoutGroup.Constraint.FixedColumnCount) group.Columns = grid.constraintCount;
            foreach (Transform child in t) Walk(child, group, w);
            if (group.Children == null)
            {
                parent.Children!.Remove(group);
            }
        }

        private static string? FirstLabel(CapturedNode node)
        {
            if (node.Kind == "label" && !string.IsNullOrEmpty(node.Text)) return node.Text;
            return node.Children?.Select(FirstLabel).FirstOrDefault(t => t != null);
        }

        internal static IEnumerable<Dictionary<string, object?>> Wire()
        {
            foreach (var w in Windows)
            {
                if (w.Root == null || w.Tree == null) continue;
                yield return new Dictionary<string, object?>
                {
                    ["id"] = w.Key,
                    ["technology"] = "ugui",
                    ["title"] = FirstLabel(w.Tree) ?? w.Root.name,
                    ["openedBy"] = w.OpenedBy?.ToWire(),
                    ["root"] = w.Tree.ToWire(),
                };
            }
        }

        internal static string? Drive(string key, Press press)
        {
            var w = Windows.FirstOrDefault(x => x.Key == key);
            if (w == null || w.Root == null) return PressRefusal.WindowClosed;
            var refusal = PressRefusal.For(w.Tree, press.ControlId);
            if (refusal != null) return refusal;
            if (!w.Controls.TryGetValue(press.ControlId, out var c) || c == null) return PressRefusal.ControlGone;
            switch (c)
            {
                case Button b:
                    if (!b.interactable) return PressRefusal.ControlDisabled;
                    b.onClick.Invoke();
                    return null;
                case Toggle t:
                    if (!t.interactable) return PressRefusal.ControlDisabled;
                    t.isOn = press.Bool;
                    return null;
                case Slider s:
                    if (!s.interactable) return PressRefusal.ControlDisabled;
                    s.value = (float)press.Num;
                    return null;
                case InputField f:
                    if (!f.interactable) return PressRefusal.ControlDisabled;
                    f.text = press.Text ?? "";
                    f.onEndEdit.Invoke(f.text);
                    return null;
            }
            if (c.GetType().Name == "TMP_InputField")
            {
                c.GetType().GetProperty("text")?.SetValue(c, press.Text ?? "", null);
                (c.GetType().GetField("onEndEdit")?.GetValue(c) as UnityEvent<string>)?.Invoke(press.Text ?? "");
                return null;
            }
            return "control type is not driveable";
        }
    }
}
