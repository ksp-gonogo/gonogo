using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Gonogo.KSP.GameWindows;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class GameWindowCaptureTests
    {
        /* The shapes each capture produces: immediate-mode ids key by control text, uGUI ids by object name. */
        private static CapturedNode ImmediateModeWindow() => new CapturedNode
        {
            Id = "w",
            Kind = "group",
            Dir = "v",
            Children = new List<CapturedNode>
            {
                new CapturedNode { Id = "w/label0", Kind = "label", Text = "Target: Mun" },
                new CapturedNode { Id = "w/button0:Apply", Kind = "button", Text = "Apply" },
                new CapturedNode { Id = "w/button0:Reset", Kind = "button", Text = "Reset", Enabled = false },
                new CapturedNode { Id = "w/textfield0", Kind = "textfield", Text = "45" },
            },
        };

        private static CapturedNode RetainedDialog() => new CapturedNode
        {
            Id = "w",
            Kind = "group",
            Dir = "v",
            Children = new List<CapturedNode>
            {
                new CapturedNode { Id = "w/group0:Dialog", Kind = "group", Dir = "h", Children = new List<CapturedNode>
                {
                    new CapturedNode { Id = "w/group0:Dialog/toggle0:ToggleProbe", Kind = "toggle", Text = "Probe", Bool = true },
                    new CapturedNode { Id = "w/group0:Dialog/slider0:Slider", Kind = "slider", Num = 10, Min = 1, Max = 20 },
                    new CapturedNode { Id = "w/group0:Dialog/button0:ButtonAccept", Kind = "button", Text = "Accept" },
                } },
            },
        };

        [Theory]
        [InlineData("w/button0:Apply")]
        [InlineData("w/textfield0")]
        public void A_control_still_drawn_in_an_immediate_mode_window_takes_a_press(string controlId) =>
            Assert.Null(PressRefusal.For(ImmediateModeWindow(), controlId));

        [Theory]
        [InlineData("w/group0:Dialog/toggle0:ToggleProbe")]
        [InlineData("w/group0:Dialog/button0:ButtonAccept")]
        public void A_control_still_drawn_in_a_dialog_takes_a_press(string controlId) =>
            Assert.Null(PressRefusal.For(RetainedDialog(), controlId));

        [Fact]
        public void A_press_on_a_control_the_window_no_longer_draws_is_refused() =>
            Assert.Equal(PressRefusal.ControlGone, PressRefusal.For(ImmediateModeWindow(), "w/button0:Target Mode: Body Center"));

        [Fact]
        public void A_press_on_a_greyed_out_control_is_refused() =>
            Assert.Equal(PressRefusal.ControlDisabled, PressRefusal.For(ImmediateModeWindow(), "w/button0:Reset"));

        [Fact]
        public void A_press_with_no_window_is_refused() =>
            Assert.Equal(PressRefusal.WindowClosed, PressRefusal.For(null, "w/button0:Apply"));

        [Fact]
        public void A_control_sharing_a_label_gets_its_own_ordinal()
        {
            var parent = new CapturedNode { Id = "w", Kind = "group" };

            Assert.Equal(0, parent.NextOrdinal("button|Apply"));
            Assert.Equal(1, parent.NextOrdinal("button|Apply"));
            Assert.Equal(0, parent.NextOrdinal("button|Reset"));
        }

        [Fact]
        public void The_wire_tree_uses_only_fields_the_contract_declares()
        {
            var declared = typeof(GameWindowNode)
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(p => char.ToLowerInvariant(p.Name[0]) + p.Name.Substring(1))
                .ToHashSet();

            void Check(object? wire)
            {
                if (wire is not Dictionary<string, object?> node) return;
                Assert.Subset(declared, node.Keys.ToHashSet());
                if (node.TryGetValue("children", out var children) && children is IEnumerable<object?> list)
                {
                    foreach (var child in list) Check(child);
                }
            }

            Check(ImmediateModeWindow().ToWire());
            Check(RetainedDialog().ToWire());
        }

        [Fact]
        public void An_enabled_control_omits_enabled_on_the_wire()
        {
            var nodes = (IEnumerable<object?>)ImmediateModeWindow().ToWire()["children"]!;
            var byId = nodes.Cast<Dictionary<string, object?>>().ToDictionary(n => (string)n["id"]!);

            Assert.False(byId["w/button0:Apply"].ContainsKey("enabled"));
            Assert.Equal(false, byId["w/button0:Reset"]["enabled"]);
        }
    }
}
