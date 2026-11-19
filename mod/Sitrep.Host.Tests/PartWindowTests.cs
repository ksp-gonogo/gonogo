using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>The window rows beside the buttons: what reaches the wire, what moves the change-gate, and how the walk is paced.</summary>
    public class PartWindowTests
    {
        private static PartWindowItem Slider(double value) => new PartWindowItem
        {
            Kind = "slider", Module = "ModuleEnginesFX", Name = "thrustPercentage", Label = "Thrust Limiter",
            Text = value + "%", Number = value, Min = 0, Max = 100, Step = 0.5, Editable = true,
        };

        [Fact]
        public void Rows_reach_the_wire_in_the_games_order()
        {
            var actuator = new FakePartActionActuator();
            actuator.WindowByPartId["1"] = new List<PartWindowItem>
            {
                Slider(73.5),
                new PartWindowItem { Kind = "resource", Name = "LiquidFuel", Label = "Liquid Fuel", Number = 80, Min = 0, Max = 100, Flows = true },
            };

            var publication = PartActionsViewProvider.Build(actuator, new[] { "1" }, "v").Single();
            var rows = (List<object?>)publication.Payload!["window"]!;

            Assert.Equal(2, rows.Count);
            var first = (Dictionary<string, object?>)rows[0]!;
            Assert.Equal("slider", first["kind"]);
            Assert.Equal(73.5, first["number"]);
            Assert.Equal(true, first["editable"]);
        }

        [Fact]
        public void A_moved_slider_changes_the_signature_and_an_unmoved_one_does_not()
        {
            var actuator = new FakePartActionActuator();
            actuator.WindowByPartId["1"] = new List<PartWindowItem> { Slider(73.5) };
            var cache = new PartActionsPublicationCache();

            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "v")));
            Assert.Empty(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "v")));

            actuator.WindowByPartId["1"] = new List<PartWindowItem> { Slider(60) };
            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "v")));
        }

        [Fact]
        public void A_partial_batch_does_not_forget_the_parts_it_left_out()
        {
            var actuator = new FakePartActionActuator();
            actuator.WindowByPartId["1"] = new List<PartWindowItem> { Slider(1) };
            actuator.WindowByPartId["2"] = new List<PartWindowItem> { Slider(2) };
            var cache = new PartActionsPublicationCache();
            var both = new[] { "1", "2" };

            Assert.Equal(2, cache.Changed(PartActionsViewProvider.Build(actuator, both, "v"), both).Count);
            Assert.Empty(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "v"), both));
            Assert.Empty(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "2" }, "v"), both));
        }

        [Fact]
        public void A_build_stops_when_its_time_is_out_but_reads_at_least_one_part()
        {
            var actuator = new FakePartActionActuator();
            var ids = new[] { "1", "2", "3", "4" };

            PartActionsViewProvider.Build(actuator, ids, "v", () => true, out var read);

            Assert.Equal(1, read);
            Assert.Equal(new[] { "1" }, actuator.ListedWindowPartIds);
        }

        private static List<string> Ids(int count) =>
            Enumerable.Range(1, count).Select(i => i.ToString()).ToList();

        [Fact]
        public void Every_one_of_112_subscribed_parts_publishes_a_first_sample()
        {
            var actuator = new FakePartActionActuator();
            var ids = Ids(112);
            foreach (var id in ids)
            {
                actuator.WindowByPartId[id] = new List<PartWindowItem> { Slider(int.Parse(id)) };
            }

            var sweep = new PartActionsSweep(500);
            var cache = new PartActionsPublicationCache();
            var published = new HashSet<string>();
            long now = 0;

            for (var tick = 0; tick < 400 && published.Count < ids.Count; tick++)
            {
                var read = 0;
                var batch = PartActionsViewProvider.Tick(
                    actuator, sweep, () => ids, () => "v", now, () => ++read >= 5, out var subscribed);
                foreach (var publication in cache.Changed(batch, subscribed))
                {
                    published.Add(publication.SubTopic);
                }

                now += 20;
            }

            Assert.Equal(112, published.Count);
        }

        [Fact]
        public void A_sweep_reads_each_part_once_and_waits_out_its_interval_before_the_next()
        {
            var actuator = new FakePartActionActuator();
            var ids = Ids(12);
            var sweep = new PartActionsSweep(500);
            long now = 0;
            var reads = 0;

            for (var tick = 0; tick < 20; tick++)
            {
                var read = 0;
                reads += PartActionsViewProvider.Tick(
                    actuator, sweep, () => ids, () => "v", now, () => ++read >= 5, out _).Count;
                now += 20;
            }

            Assert.Equal(12, reads);

            now = 500;
            var again = PartActionsViewProvider.Tick(
                actuator, sweep, () => ids, () => "v", now, () => false, out _);
            Assert.Equal(12, again.Count);
        }

        [Fact]
        public void A_new_subscription_starts_a_sweep_at_once()
        {
            var actuator = new FakePartActionActuator();
            var ids = Ids(3);
            var sweep = new PartActionsSweep(500);
            PartActionsViewProvider.Tick(actuator, sweep, () => ids, () => "v", 0, () => false, out _);
            Assert.Empty(PartActionsViewProvider.Tick(actuator, sweep, () => ids, () => "v", 10, () => false, out _));

            sweep.Wake();

            Assert.Equal(3, PartActionsViewProvider.Tick(actuator, sweep, () => ids, () => "v", 11, () => false, out _).Count);
        }

        [Fact]
        public void An_empty_subscription_is_counted_once_per_interval_not_once_per_tick()
        {
            var counts = 0;
            var sweep = new PartActionsSweep(500);
            var actuator = new FakePartActionActuator();
            for (long now = 0; now < 400; now += 20)
            {
                PartActionsViewProvider.Tick(actuator, sweep, () => { counts++; return new List<string>(); }, () => "v", now, () => false, out _);
            }

            Assert.Equal(1, counts);
        }

        private static PartWindowItem Resource(double amount) => new PartWindowItem
        {
            Kind = "resource", Name = "ElectricCharge", Label = "Electric Charge",
            Text = amount + " units", Number = amount, Min = 0, Max = 150, Flows = true,
        };

        [Fact]
        public void A_resource_that_drifts_by_a_thousandth_of_its_capacity_does_not_reopen_the_gate()
        {
            var actuator = new FakePartActionActuator();
            actuator.WindowByPartId["1"] = new List<PartWindowItem> { Resource(139.997) };
            var cache = new PartActionsPublicationCache();

            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "v")));

            actuator.WindowByPartId["1"] = new List<PartWindowItem> { Resource(140.2) };
            Assert.Empty(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "v")));

            actuator.WindowByPartId["1"] = new List<PartWindowItem> { Resource(135) };
            var moved = Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "v")));
            var rows = (List<object?>)moved.Payload!["window"]!;
            Assert.Equal(135d, ((Dictionary<string, object?>)rows[0]!)["number"]);
        }

        [Theory]
        [InlineData("temperature", "287.7 K")]
        [InlineData("habitat radiation", "0.405 mrad/h")]
        [InlineData("ECLSS", "nominal")]
        [InlineData("Engine", "remaining burn: 5m 50s, ignitions: 5")]
        public void Several_fields_named_Status_each_keep_their_own_value(string label, string value)
        {
            // A string field is its own value, however the game joins it to the label.
            Assert.Equal(value, PartWindowText.LabelValue(value, label + ": " + value, label, label));

            // A field that holds something else is the printed form without the label.
            Assert.Equal(value, PartWindowText.LabelValue(null, label + ": " + value, label));
            Assert.Equal(value, PartWindowText.LabelValue(null, label.ToUpperInvariant() + " : " + value, label));
        }

        [Fact]
        public void A_value_that_is_empty_until_the_mods_first_update_reads_empty_not_as_the_label()
        {
            Assert.Equal("", PartWindowText.LabelValue("", "temperature: ", "temperature"));
            Assert.Equal("", PartWindowText.LabelValue(null, "temperature: ", "temperature"));
        }

        [Fact]
        public void A_printed_form_that_does_not_start_with_the_label_is_left_alone()
        {
            Assert.Equal("40 %", PartWindowText.WithoutLabel("40 %", "Thrust Limiter"));
            Assert.Equal("Engine ignited: yes", PartWindowText.WithoutLabel("Engine ignited: yes", "Engine"));
        }

        private static PartActionEntry Button(string module, int index, string name, string label, bool active = true) =>
            new PartActionEntry { ModuleName = module, ModuleIndex = index, Name = name, Label = label, Active = active };

        [Fact]
        public void Two_modules_of_one_class_each_keep_their_button_of_the_same_name()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry>
            {
                Button("ProcessController", 8, "Toggle", "1 Scrubber: running"),
                Button("ProcessController", 9, "Toggle", "1 Water recycler: running"),
                Button("ProcessController", 9, "DumpValve", "Dump: Ammonia"),
                Button("ProcessController", 8, "DumpValve", "Dump:", active: false),
            };

            var publication = PartActionsViewProvider.Build(actuator, new[] { "1" }, "v").Single();
            var actions = (List<object?>)publication.Payload!["actions"]!;

            Assert.Equal(4, actions.Count);
            Assert.Equal(9, ((Dictionary<string, object?>)actions[1]!)["moduleIndex"]);
        }

        [Fact]
        public void A_press_carries_the_module_index_to_the_actuator()
        {
            var actuator = new FakePartActionActuator();

            PartActionCommandProvider.HandleInvoke(
                actuator, new InvokePartActionArgs { PartId = "1", EventName = "Toggle", ModuleIndex = 9 });

            Assert.Equal(9, actuator.LastInvokeModuleIndex);
        }

        [Fact]
        public void A_button_whose_module_switches_on_after_the_first_read_is_sent_on_a_later_sweep()
        {
            var actuator = new FakePartActionActuator();
            var ids = new List<string> { "1" };
            var sweep = new PartActionsSweep(500);
            var cache = new PartActionsPublicationCache();
            var nameTag = Button("NameTagModule", 23, "PopupNameTagChanger", "Change Name Tag");

            List<string> Sweep(long now)
            {
                var batch = PartActionsViewProvider.Tick(actuator, sweep, () => ids, () => "v", now, () => false, out var subscribed);
                return cache.Changed(batch, subscribed)
                    .SelectMany(p => ((List<object?>)p.Payload!["actions"]!).Select(a => (string)((Dictionary<string, object?>)a!)["name"]!))
                    .ToList();
            }

            // The module reads as switched off at the first read, so its button is not listed.
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Button("ModuleCommand", 1, "RenameVessel", "Rename Vessel") };
            Assert.Equal(new[] { "RenameVessel" }, Sweep(0));

            // It switches on: the next sweep lists it and the gate lets the changed part through.
            actuator.ActionsByPartId["1"] = new List<PartActionEntry>
            {
                Button("ModuleCommand", 1, "RenameVessel", "Rename Vessel"),
                nameTag,
            };
            Assert.Empty(Sweep(100));
            Assert.Equal(new[] { "RenameVessel", "PopupNameTagChanger" }, Sweep(500));

            // And switches off again: it is dropped by the same route.
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Button("ModuleCommand", 1, "RenameVessel", "Rename Vessel") };
            Assert.Equal(new[] { "RenameVessel" }, Sweep(1000));
        }

        private static string? Localise(string? stored) => stored switch
        {
            "#autoLOC_8003391" => "Vessel Naming",
            null or "" => null,
            var s when s.StartsWith("#") => null,
            var s => s,
        };

        [Fact]
        public void A_group_is_named_by_its_localised_display_name_and_never_by_a_bare_key()
        {
            Assert.Equal("Vessel Naming", PartWindowText.Group(Localise, "#autoLOC_8003391", "ignored"));
            Assert.Equal("Control", PartWindowText.Group(Localise, "Control", null));
        }

        [Fact]
        public void A_group_whose_display_name_cannot_be_read_falls_to_its_code_name_and_then_to_none()
        {
            Assert.Equal("Sensors", PartWindowText.Group(Localise, "#SOMEMOD_Group_Sensors", "Sensors"));
            Assert.Null(PartWindowText.Group(Localise, "#SOMEMOD_Group_Sensors", "#SOMEMOD_Group_Sensors"));
        }
    }
}
