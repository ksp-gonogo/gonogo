using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The host's half of "declared once": whether a command rides the signal
    /// delay is read off its <c>[SitrepCommand]</c>, which is the same
    /// declaration the SDK codegen turns into the table a client's delay UX
    /// reads.
    ///
    /// <para>What this cannot see, and what covers it instead: the client side
    /// lives in TypeScript, so the agreement itself is asserted in
    /// <c>packages/core/src/styleguide-command-delay-single-source.test.ts</c>,
    /// over every generated command map in the repo. This file pins the end of
    /// the chain that is C#, which is that the catalog reads the attribute and
    /// nothing else has to.</para>
    /// </summary>
    public class CommandDelayCatalogTests
    {
        /// <summary>
        /// Every command the contract tags is resolvable. The failure this
        /// guards is silent: an unresolved id falls back to delayed, which is
        /// indistinguishable from a command that legitimately delays, so a scan
        /// that stopped seeing the contract assembly would report nothing.
        /// </summary>
        [Fact]
        public void EveryTaggedCommandInTheContractResolves()
        {
            var tagged = TaggedCommands();
            Assert.True(tagged.Count > 40, "the contract tags far more than forty commands; a small count means the reflection stopped working, not that the contract shrank");

            var unresolved = new List<string>();
            foreach (var pair in tagged)
            {
                bool delayed;
                if (!CommandDelayCatalog.TryGetDelayed(pair.Key, out delayed))
                {
                    unresolved.Add(pair.Key);
                }
            }

            Assert.Empty(unresolved);
        }

        /// <summary>
        /// And it answers what the attribute says, rather than a default that
        /// happens to match. Asserted over the WHOLE set rather than a sample:
        /// the defect being guarded against is one command drifting, and a
        /// sample is exactly what misses that.
        /// </summary>
        [Fact]
        public void ItAnswersWhatTheAttributeDeclared()
        {
            var disagreed = new List<string>();
            foreach (var pair in TaggedCommands())
            {
                bool delayed;
                CommandDelayCatalog.TryGetDelayed(pair.Key, out delayed);
                if (delayed != pair.Value) disagreed.Add(pair.Key);
            }

            Assert.Empty(disagreed);
        }

        /// <summary>
        /// Both branches are reachable, so neither is a derivation nobody has
        /// checked. A contract where everything delayed would pass the two
        /// assertions above while proving only that the default is the default.
        /// </summary>
        [Fact]
        public void BothAnswersAreDeclaredSomewhere()
        {
            var tagged = TaggedCommands();
            Assert.Contains(tagged, pair => pair.Value);
            Assert.Contains(tagged, pair => !pair.Value);
        }

        /// <summary>
        /// An id nothing tags is not claimed. The engine turns that into
        /// "delayed", which is the safe direction, but the catalog says it does
        /// not know rather than pretending it does: a caller that cannot tell
        /// "declared delayed" from "never heard of it" cannot report the second.
        /// </summary>
        [Fact]
        public void AnUntaggedIdIsAMissRatherThanADefault()
        {
            bool delayed;
            Assert.False(CommandDelayCatalog.TryGetDelayed("nobody.declared.this", out delayed));
            Assert.True(delayed);
        }

        private static Dictionary<string, bool> TaggedCommands()
        {
            var found = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (var type in typeof(CommandDeclaration).Assembly.GetTypes())
            {
                foreach (var attr in type.GetCustomAttributes<SitrepCommandAttribute>())
                {
                    found[attr.CommandId] = attr.Delayed;
                }
            }
            return found;
        }
    }
}
