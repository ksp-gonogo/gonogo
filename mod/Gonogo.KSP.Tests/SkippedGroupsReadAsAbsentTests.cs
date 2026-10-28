using System;
using System.Text.RegularExpressions;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A sample that leaves a skippable group out leaves its key out of the snapshot,
    /// so whatever reads it (a channel, an alarm, an Uplink's capture) finds the group
    /// absent, never an empty list or zeros that would read as "no contracts" or "no parts".
    ///
    /// <para>Source text, not behaviour: the sample reads live KSP and cannot be compiled
    /// into this project.</para>
    /// </summary>
    public class SkippedGroupsReadAsAbsentTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void a_skipped_career_is_no_key_at_all()
        {
            var gate = Regex.Match(Source, @"var career = Samples\(SnapshotGroups\.Career\) \? \w+\(\w*\) : null;\s*if \(career != null\)\s*\{\s*values\[""career""\] = career;");
            Assert.True(gate.Success, "the career gate must leave the key out when the group is skipped");
        }

        [Fact]
        public void a_skipped_space_center_is_no_key_at_all()
        {
            Assert.Matches(@"var spaceCenter = Samples\(SnapshotGroups\.SpaceCenter\) \? BuildSpaceCenter\(\) : null;\s*if \(spaceCenter != null\)", Source);
            Assert.Matches(@"if \(Samples\(SnapshotGroups\.SpaceCenter\)\)\s*\{\s*AttachSpaceCenterGroup\(values, ""crewRoster""", Source);
        }

        [Fact]
        public void a_skipped_part_tree_is_no_key_at_all()
        {
            Assert.Matches(@"if \(Samples\(SnapshotGroups\.Topology\)\)\s*\{\s*PartsGroup\(""topology"", \(\) => BuildTopology\(vessel\)\);\s*\}", Source);
        }
    }
}
