using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// That every career command's declared Subject is a held-at-home topic.
    ///
    /// <para>A career write reaches the home command's node because its Subject
    /// is held at home, and the engine routes a held-at-home topic there. The
    /// end-to-end test proves that routing with a stand-in Uplink, since
    /// <c>CareerUplink</c> needs a live game. A Subject edited to a topic that
    /// is not held at home would send a remote spend to the active craft with
    /// no runtime test failing, so the declarations are read as source.</para>
    /// </summary>
    public class CareerCommandSubjectsAreHeldAtHomeTests
    {
        private const int CareerCommandCount = 9;

        private static readonly Regex CommandCall =
            new Regex(@"\bCommand\(\s*([\w.]+)\s*,\s*([\w.]+)\s*\)", RegexOptions.Compiled);

        private static string WithoutComments(string source) =>
            Regex.Replace(source, @"//[^\n]*", "");

        /// <summary>The topic expressions of every channel block that sets <c>HeldAtHome = true</c>.</summary>
        internal static HashSet<string> HeldAtHomeTopics(string source)
        {
            var held = new HashSet<string>();
            var blocks = Regex.Split(WithoutComments(source), @"new ChannelDeclaration\b").Skip(1);
            foreach (var block in blocks)
            {
                var topic = Regex.Match(block, @"\bTopic\s*=\s*([\w.]+)\s*,");
                if (topic.Success && Regex.IsMatch(block, @"\bHeldAtHome\s*=\s*true\b"))
                {
                    held.Add(topic.Groups[1].Value);
                }
            }
            return held;
        }

        internal static List<(string Command, string Subject)> CareerCommands(string careerSource) =>
            CommandCall.Matches(WithoutComments(careerSource))
                .Cast<Match>()
                .Select(m => (m.Groups[1].Value, m.Groups[2].Value))
                .ToList();

        /// <summary>The subjects that are not held at home, across both uplinks that declare them.</summary>
        internal static List<string> SubjectsNotHeldAtHome(string careerSource, string spaceCenterSource)
        {
            var held = HeldAtHomeTopics(careerSource);
            held.UnionWith(HeldAtHomeTopics(spaceCenterSource));
            return CareerCommands(careerSource)
                .Where(c => !held.Contains(c.Subject))
                .Select(c => c.Command + " -> " + c.Subject)
                .ToList();
        }

        private static string Career() => CurrencyDelaySourceText.ReadRelative("CareerUplink.cs");

        private static string SpaceCentre() => CurrencyDelaySourceText.ReadRelative("SpaceCenterUplink.cs");

        [Fact]
        public void the_scan_finds_all_nine_career_commands()
        {
            Assert.Equal(CareerCommandCount, CareerCommands(Career()).Count);
        }

        [Fact]
        public void every_career_command_subject_is_a_held_at_home_topic()
        {
            Assert.Empty(SubjectsNotHeldAtHome(Career(), SpaceCentre()));
        }

        [Fact]
        public void a_subject_moved_to_a_topic_that_is_not_held_at_home_is_caught()
        {
            var planted = Career().Replace(
                "Command(CareerCommandProvider.UnlockTechCommand, CareerViewProvider.Topic)",
                "Command(CareerCommandProvider.UnlockTechCommand, SpaceCenterViewProvider.SceneTopic)");

            var offenders = SubjectsNotHeldAtHome(planted, SpaceCentre());

            Assert.Single(offenders);
            Assert.Contains("SceneTopic", offenders[0]);
        }

        [Fact]
        public void a_subject_whose_channel_loses_its_held_flag_is_caught()
        {
            var planted = SpaceCentre().Replace("HeldAtHome = true", "HeldAtHome = false");

            Assert.NotEmpty(SubjectsNotHeldAtHome(Career(), planted));
        }
    }
}
