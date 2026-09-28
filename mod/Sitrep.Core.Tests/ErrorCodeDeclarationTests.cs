using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Every error code core declares says what it means and what an operator
    /// reads, and no id means two things.
    ///
    /// <para>The meaning is the field's doc comment and is what the published
    /// table and the AsyncAPI document carry, so an undocumented code would
    /// publish an empty description. The sentence is what the kit renders after
    /// "refused:" or "failed:".</para>
    /// </summary>
    public class ErrorCodeDeclarationTests
    {
        /// <summary>The core domains a core refinement may be owned by; an Uplink's are owned by its own id.</summary>
        private static readonly string[] CoreDomains = { "repair" };

        private static readonly Type[] Holders = { typeof(CommandErrorCode), typeof(FaultCode), typeof(RepairRefusal) };

        [Fact]
        public void TheCatalogSeesEveryHolder()
        {
            Assert.True(ErrorCodeCatalog.Of(typeof(CommandErrorCode)).Count >= 20, "BLIND: the roots were not found");
            Assert.True(ErrorCodeCatalog.FaultsOf(typeof(FaultCode)).Count >= 10, "BLIND: the faults were not found");
            Assert.NotEmpty(CommandErrorCode.CoreRefinements);
        }

        [Fact]
        public void EveryCoreCodeIsDocumentedAndCarriesASentence()
        {
            var documented = DocumentedFields();
            var missing = new List<string>();
            foreach (var holder in Holders)
            {
                foreach (var (name, code) in ErrorCodeCatalog.NamedFieldsOf<RefusalCode>(holder))
                {
                    if (!documented.Contains("F:" + holder.FullName + "." + name)) missing.Add(holder.Name + "." + name + " (no doc comment)");
                    if (string.IsNullOrWhiteSpace(code.Sentence)) missing.Add(code.Id + " (no sentence)");
                }
                foreach (var (name, code) in ErrorCodeCatalog.NamedFieldsOf<FaultCode>(holder))
                {
                    if (!documented.Contains("F:" + holder.FullName + "." + name)) missing.Add(holder.Name + "." + name + " (no doc comment)");
                    if (string.IsNullOrWhiteSpace(code.Sentence)) missing.Add(code.Id + " (no sentence)");
                }
            }
            Assert.True(missing.Count == 0, "Every error code says what it means:\n  " + string.Join("\n  ", missing));
        }

        [Fact]
        public void NoIdIsDeclaredTwice()
        {
            var ids = CommandErrorCode.Roots.Select(c => c.Id)
                .Concat(CommandErrorCode.CoreRefinements.Select(c => c.Id))
                .Concat(FaultCode.All.Select(c => c.Id))
                .ToList();
            var twice = ids.GroupBy(id => id).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
            Assert.True(twice.Count == 0, "Declared twice: " + string.Join(", ", twice));
        }

        [Fact]
        public void RootsAreRootsAndCoreRefinementsBelongToACoreDomain()
        {
            Assert.All(CommandErrorCode.Roots, root => Assert.True(root.IsRoot, root.Id));
            Assert.All(CommandErrorCode.CoreRefinements, code =>
            {
                Assert.False(code.IsRoot, code.Id);
                Assert.Contains(code.Owner, CoreDomains);
                Assert.Contains(code.Root, CommandErrorCode.Roots);
            });
        }

        [Fact]
        public void ARefinementCannotBeRefinedAndIdsAreShaped()
        {
            Assert.Throws<InvalidOperationException>(() => RepairRefusal.NoKits.Refine("repair.fewer", "fewer"));
            Assert.Throws<ArgumentException>(() => CommandErrorCode.NotFound.Refine("noDot", "no owner"));
            Assert.Throws<ArgumentException>(() => CommandErrorCode.NotFound.Refine("probe.Upper", "upper case name"));
            Assert.Throws<ArgumentException>(() => CommandErrorCode.NotFound.Refine("probe.silent", " "));
        }

        [Fact]
        public void AnIdReadOffTheWireKeepsItsRootWhetherOrNotItIsKnown()
        {
            Assert.Same(RepairRefusal.NoKits, RefusalCode.FromWire("insufficientResource", "repair.noKits"));
            var unknown = RefusalCode.FromWire("careerModeRequired", "someUplink.notManaging");
            Assert.Equal("someUplink.notManaging", unknown.Id);
            Assert.Equal(CommandErrorCode.CareerModeRequired, unknown.Root);
            Assert.Equal("aLaterRoot", RefusalCode.FromWire("aLaterRoot", null).Id);
            Assert.Same(FaultCode.UnknownTopic, FaultCode.FromWire("unknownTopic"));
        }

        private static HashSet<string> DocumentedFields()
        {
            var path = Path.ChangeExtension(typeof(RefusalCode).Assembly.Location, ".xml");
            Assert.True(File.Exists(path), $"BLIND: no XML doc file beside {typeof(RefusalCode).Assembly.Location}");
            return new HashSet<string>(
                XDocument.Load(path).Descendants("member")
                    .Where(m => m.Elements().Any())
                    .Select(m => (string)m.Attribute("name")!));
        }
    }
}
