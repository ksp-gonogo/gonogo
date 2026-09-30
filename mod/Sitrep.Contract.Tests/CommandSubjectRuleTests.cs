using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// The pure rule <c>Sitrep.Host.ChannelEngine.ValidateCommandSubjects</c>
    /// and <c>Sitrep.Contract.TestSupport.CommandSubjectAssertion</c> both
    /// call, checked directly here against fakes so the shared logic has one
    /// test that does not depend on either caller's own registry shape.
    /// </summary>
    public class CommandSubjectRuleTests
    {
        [Fact]
        public void A_TrueNow_command_needs_no_Subject()
        {
            var commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = "time.setWarpIndex", Subject = "" },
            };

            var violations = CommandSubjectRule.Violations(
                commands,
                _ => DelayRole.TrueNow,
                _ => false,
                _ => false);

            Assert.Empty(violations);
        }

        [Fact]
        public void A_delayed_command_with_no_Subject_is_a_violation()
        {
            var commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = "planted.blank", Subject = "" },
            };

            var violations = CommandSubjectRule.Violations(
                commands,
                _ => null,
                _ => false,
                _ => false);

            var violation = Assert.Single(violations);
            Assert.Equal("planted.blank", violation.Command);
        }

        [Fact]
        public void A_Subject_matching_a_declared_channel_resolves()
        {
            var commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = "vessel.control.setThrottle", Subject = "vessel.control" },
            };

            var violations = CommandSubjectRule.Violations(
                commands,
                _ => null,
                literal => literal == "vessel.control",
                _ => false);

            Assert.Empty(violations);
        }

        [Fact]
        public void A_Subject_naming_a_channel_nobody_declares_is_a_violation()
        {
            var commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = "planted.nowhere", Subject = "planted.nowhere.{args.Id}" },
            };

            var violations = CommandSubjectRule.Violations(
                commands,
                _ => null,
                _ => false,
                _ => false);

            var violation = Assert.Single(violations);
            Assert.Equal("planted.nowhere", violation.Command);
            Assert.Contains("planted.nowhere.{args.Id}", violation.Message);
        }

        [Fact]
        public void A_Subject_cut_at_the_first_brace_checks_the_dynamic_namespace_prefix()
        {
            var commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = "vessel.partActions.toggle", Subject = "vessel.partActions.{args.PartId}" },
            };

            var violations = CommandSubjectRule.Violations(
                commands,
                _ => null,
                _ => false,
                literal => literal == "vessel.partActions.");

            Assert.Empty(violations);
        }

        [Fact]
        public void The_SitrepCommand_tag_overrides_the_declaration_Delay()
        {
            var commands = new List<CommandDeclaration>
            {
                new CommandDeclaration { Command = "tagged.trueNowInDeclaration", Subject = "", Delay = DelayRole.Delayed },
            };

            var violations = CommandSubjectRule.Violations(
                commands,
                _ => DelayRole.TrueNow,
                _ => false,
                _ => false);

            Assert.Empty(violations);
        }
    }
}
