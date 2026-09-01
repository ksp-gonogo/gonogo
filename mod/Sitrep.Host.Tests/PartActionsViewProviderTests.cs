using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless tests for <see cref="PartActionsViewProvider"/> and
    /// <see cref="PartActionsPublicationCache"/>: the topic namespace, the
    /// dedup/ordering rules, the wire flatten, and the producer-side change gate.
    /// Everything downstream of the one thing only KSP can do (the
    /// <c>part.Events</c> + module walk, which
    /// <see cref="FakePartActionActuator"/> stands in for) is exercised here.
    /// </summary>
    public class PartActionsViewProviderTests
    {
        private static PartActionEntry Entry(
            string name,
            string? label = null,
            string? moduleName = null,
            string? group = null,
            bool active = true) => new PartActionEntry
            {
                Name = name,
                Label = label ?? name,
                ModuleName = moduleName,
                Group = group,
                Active = active,
            };

        [Fact]
        public void TopicIsThePrefixPlusThePartId()
        {
            // The exact string the client subscribes to; the client's map-topic
            // pattern and carried-prefix entry mirror this.
            Assert.Equal("vessel.partActions.", PartActionsViewProvider.PartActionsPrefix);
            Assert.Equal("vessel.partActions.1234567", PartActionsViewProvider.Topic("1234567"));
            Assert.Equal("1234567", PartActionsViewProvider.SubTopic("1234567"));
        }

        [Fact]
        public void BuildEnumeratesOnlyTheRequestedParts()
        {
            // The subscription gate: the caller passes the subscribed set, and a
            // part nobody is watching must never be enumerated (that is what keeps
            // a 200-part vessel free while no popover is open).
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Deploy") };
            actuator.ActionsByPartId["2"] = new List<PartActionEntry> { Entry("Retract") };

            var publications = PartActionsViewProvider.Build(actuator, new[] { "2" }, "guid-1");

            Assert.Equal(new[] { "2" }, actuator.ListedPartIds);
            Assert.Single(publications);
            Assert.Equal("2", publications[0].SubTopic);
        }

        [Fact]
        public void BuildWithNoSubscribedPartsCallsTheActuatorNotAtAll()
        {
            var actuator = new FakePartActionActuator();

            var publications = PartActionsViewProvider.Build(actuator, new string[0], "guid-1");

            Assert.Empty(publications);
            Assert.Empty(actuator.ListedPartIds);
        }

        /// <summary>
        /// The investigation could not settle statically whether
        /// <c>part.Events</c> already aggregates its modules' events. Dedup on
        /// (module, name) makes the answer stop mattering: an aggregated duplicate
        /// collapses.
        /// </summary>
        [Fact]
        public void BuildCollapsesTheSameEventReportedTwiceForOneModule()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry>
            {
                Entry("ToggleSolarPanel", moduleName: "ModuleDeployableSolarPanel"),
                Entry("ToggleSolarPanel", moduleName: "ModuleDeployableSolarPanel"),
            };

            var publications = PartActionsViewProvider.Build(actuator, new[] { "1" }, "guid-1");
            var actions = WireActions(publications[0]);

            Assert.Single(actions);
        }

        /// <summary>
        /// The other half of the same rule: one name on two different modules is two
        /// genuinely different buttons in the real PAW, so it must NOT collapse.
        /// </summary>
        [Fact]
        public void BuildKeepsTheSameEventNameOnTwoDifferentModulesSeparate()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry>
            {
                Entry("Toggle", moduleName: "ModuleAnimateGeneric"),
                Entry("Toggle", moduleName: "ModuleLight"),
                // ... and the part's own event of the same name (null module) is a
                // third distinct button.
                Entry("Toggle"),
            };

            var publications = PartActionsViewProvider.Build(actuator, new[] { "1" }, "guid-1");

            Assert.Equal(3, WireActions(publications[0]).Count);
        }

        [Fact]
        public void BuildDropsAnEventWithNoNameBecauseTheNameIsTheInvokeKey()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry>
            {
                Entry(""),
                Entry("Deploy"),
            };

            var publications = PartActionsViewProvider.Build(actuator, new[] { "1" }, "guid-1");
            var actions = WireActions(publications[0]);

            Assert.Single(actions);
            Assert.Equal("Deploy", actions[0]["name"]);
        }

        [Fact]
        public void BuildPreservesTheActuatorsOrderRatherThanSorting()
        {
            // KSP builds the window part-events-first, then modules in order; the
            // operator's list must read the same way round as the game's.
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry>
            {
                Entry("Zebra"),
                Entry("Alpha"),
                Entry("Middle"),
            };

            var publications = PartActionsViewProvider.Build(actuator, new[] { "1" }, "guid-1");

            Assert.Equal(
                new[] { "Zebra", "Alpha", "Middle" },
                WireActions(publications[0]).Select(a => (string?)a["name"]));
        }

        /// <summary>
        /// An inert button is CARRIED with <c>active: false</c>, not filtered out:
        /// KSP greys it rather than removing it, and dropping it would make the
        /// list jump around as craft state changes.
        /// </summary>
        [Fact]
        public void BuildCarriesInactiveEntriesRatherThanFilteringThem()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry>
            {
                Entry("Deploy", active: false),
            };

            var publications = PartActionsViewProvider.Build(actuator, new[] { "1" }, "guid-1");
            var actions = WireActions(publications[0]);

            Assert.Single(actions);
            Assert.Equal(false, actions[0]["active"]);
        }

        [Fact]
        public void WireCarriesEveryDeclaredFieldAndNoPerTopicVesselId()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["77"] = new List<PartActionEntry>
            {
                new PartActionEntry
                {
                    Name = "ToggleSolarPanel",
                    Label = "Extend Solar Panel",
                    Group = "Solar Panel",
                    ModuleName = "ModuleDeployableSolarPanel",
                    Active = true,
                    GuiActiveUnfocused = true,
                    AdvancedTweakable = false,
                    RequireFullControl = true,
                },
            };

            var wire = PartActionsViewProvider.Build(actuator, new[] { "77" }, "guid-9")[0].Payload!;

            Assert.Equal("77", wire["partId"]);

            // The vessel reaches the wire ONLY through meta.source, the convention
            // every other vessel payload uses. There is no per-Topic vesselId field:
            // the subject boundary belongs at the ledger, not repeated on every
            // sample, so a stray one reappearing is a regression.
            Assert.Equal("vessel:guid-9", ((IDictionary<string, object?>)wire["meta"]!)["source"]);
            Assert.False(wire.ContainsKey("vesselId"));

            var action = ((List<object?>)wire["actions"]!).Cast<IDictionary<string, object?>>().Single();
            Assert.Equal("ToggleSolarPanel", action["name"]);
            Assert.Equal("Extend Solar Panel", action["label"]);
            Assert.Equal("Solar Panel", action["group"]);
            Assert.Equal("ModuleDeployableSolarPanel", action["moduleName"]);
            Assert.Equal(true, action["active"]);
            Assert.Equal(true, action["guiActiveUnfocused"]);
            Assert.Equal(false, action["advancedTweakable"]);
            Assert.Equal(true, action["requireFullControl"]);
        }

        [Fact]
        public void APartWithNoActionsPublishesAnEmptyListNotNothing()
        {
            // "This part has no buttons" is a real answer the popover must be able
            // to render, distinct from "no payload yet".
            var actuator = new FakePartActionActuator();

            var wire = PartActionsViewProvider.Build(actuator, new[] { "5" }, "guid-1")[0].Payload!;

            Assert.Empty((List<object?>)wire["actions"]!);
        }

        /// <summary>
        /// The gate exists because <c>ChannelEmitter</c> compares payloads with
        /// <c>Equals</c>, which is REFERENCE equality for a freshly-built
        /// dictionary: without this, an unchanged action list would emit a keyframe
        /// on every single tick an operator kept a part open.
        /// </summary>
        [Fact]
        public void CacheSuppressesAnUnchangedRepublish()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Deploy") };
            var cache = new PartActionsPublicationCache();

            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g")));
            Assert.Empty(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g")));
        }

        [Fact]
        public void CacheLetsThroughARelabelledButtonBecauseTheOperatorCanSeeIt()
        {
            // The read-back that makes the stream shape worth having: invoking
            // "Extend" turns the button into "Retract" one light-time later.
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Toggle", label: "Extend Solar Panel") };
            var cache = new PartActionsPublicationCache();
            cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g"));

            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Toggle", label: "Retract Solar Panel") };

            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g")));
        }

        [Fact]
        public void CacheLetsThroughAButtonThatMerelyWentInactive()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Deploy") };
            var cache = new PartActionsPublicationCache();
            cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g"));

            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Deploy", active: false) };

            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g")));
        }

        [Fact]
        public void CacheLetsThroughTheSameListOnADifferentVessel()
        {
            // Two vessels can carry identically-configured parts; the payload still
            // differs in meta.source, the one place it names the craft it describes.
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Deploy") };
            var cache = new PartActionsPublicationCache();
            cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "guid-a"));

            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "guid-b")));
        }

        /// <summary>
        /// Closing a popover drops the part from the subscribed set the caller
        /// passes, which must forget its signature so re-opening republishes rather
        /// than being gated out by state from the previous session.
        /// </summary>
        [Fact]
        public void CacheForgetsAPartThatLeavesTheSubscribedSetSoAReopenRepublishes()
        {
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Deploy") };
            var cache = new PartActionsPublicationCache();
            cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g"));

            // Popover closed: nothing subscribed this tick.
            cache.Changed(new List<PartActionsViewProvider.Publication>());

            // Re-opened, same unchanged content: must publish again.
            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g")));
        }

        [Fact]
        public void InvalidateForcesARepublishForAFreshSubscriber()
        {
            // A second viewer subscribing while the first still holds the part open:
            // the part never leaves the subscribed set, so pruning cannot help and
            // the OnSubscribed hook clears the entry instead.
            var actuator = new FakePartActionActuator();
            actuator.ActionsByPartId["1"] = new List<PartActionEntry> { Entry("Deploy") };
            var cache = new PartActionsPublicationCache();
            cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g"));

            cache.Invalidate("1");

            Assert.Single(cache.Changed(PartActionsViewProvider.Build(actuator, new[] { "1" }, "g")));
        }

        private static List<IDictionary<string, object?>> WireActions(PartActionsViewProvider.Publication publication) =>
            ((List<object?>)publication.Payload!["actions"]!)
                .Cast<IDictionary<string, object?>>()
                .ToList();
    }
}
