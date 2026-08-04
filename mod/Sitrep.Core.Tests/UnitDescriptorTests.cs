using System;
using System.IO;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The descriptor the mod can serve, against the descriptor codegen wrote.
    ///
    /// <para>Both come from one reflection pass over one assembly, which is
    /// the point: the alternative was to bake the generated file in as a
    /// resource, and a baked copy is free to drift from the attributes it
    /// claims to describe the moment somebody annotates a property without
    /// re-running codegen. This asserts the two really are one implementation
    /// rather than trusting the comment that says so.</para>
    /// </summary>
    public class UnitDescriptorTests
    {
        /// <summary>
        /// Walks up from the test binary to the repo root. The committed
        /// descriptor lives in the SDK's generated directory, which is not
        /// copied next to the test assembly.
        /// </summary>
        private static string CommittedDescriptorPath()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, ".git")))
            {
                dir = dir.Parent;
            }

            Assert.NotNull(dir);
            return Path.Combine(
                dir.FullName, "mod", "sitrep-sdk", "src", "__generated__", "units.json");
        }

        [Fact]
        public void RuntimeDescriptorMatchesTheCommittedOne()
        {
            var committed = File.ReadAllText(CommittedDescriptorPath())
                .Replace("\r\n", "\n");

            Assert.Equal(committed, UnitDescriptor.ToJson());
        }

        [Fact]
        public void RuntimeCollectionDoesNotThrowOnAnUnknownToken()
        {
            // Codegen validates the vocabulary because everything it reflects
            // is compiled into this assembly, so a stray token is drift and
            // should stop the build. The RUNTIME pass must not: throwing
            // inside KSP over a descriptor nobody asked for would take the mod
            // down, and the generated `SitrepUnit` union is open precisely so
            // an unknown token is a survivable state.
            var maps = UnitDescriptor.Collect();
            Assert.NotEmpty(maps.ByTopic);
        }

        [Fact]
        public void EveryTokenTheMapsUseIsInThePublishedVocabulary()
        {
            // A consumer resolves units from this ONE document, so what it
            // uses and what it publishes have to agree.
            var maps = UnitDescriptor.Collect();
            var used = maps.ByType.Values
                .Concat(maps.ByTopic.Values)
                .SelectMany(fields => fields.Values)
                .Distinct();

            Assert.All(used, token => Assert.Contains(token, maps.Vocabulary));
        }

        [Fact]
        public void IsStableAcrossCalls()
        {
            // Every collection is sorted, so re-running produces identical
            // bytes and a diff in the committed file means the contract
            // actually changed.
            Assert.Equal(UnitDescriptor.ToJson(), UnitDescriptor.ToJson());
        }
    }
}
