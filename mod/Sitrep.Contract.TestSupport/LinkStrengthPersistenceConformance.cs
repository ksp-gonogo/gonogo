using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="IPersistableLinkStrength"/> and <see cref="ILinkStrengthRestorer"/>
    /// promise, for an implementer to run against their own backend.
    /// </summary>
    public static class LinkStrengthPersistenceConformance
    {
        /// <summary>
        /// Asserts the contract for one model the backend can describe: an id the
        /// restorer does not know and data it did not write give no model and no
        /// throw, and what <paramref name="sample"/> described, as a save reads it
        /// back (<paramref name="throughASave"/>), builds a model that answers as
        /// the sample does at every separation tried, with the same strength and the
        /// same extensions.
        /// </summary>
        /// <param name="restorer">The backend under test.</param>
        /// <param name="sample">A model the backend made, with antennas that make its answers vary with separation.</param>
        /// <param name="throughASave">Writes a description as a save would and reads it back, returning nested dictionaries, lists, strings, doubles, booleans and nulls only.</param>
        /// <param name="separationsMeters">The separations to compare the two models at, in metres; at least one.</param>
        public static void AssertRestorerContract(
            ILinkStrengthRestorer restorer,
            IPersistableLinkStrength sample,
            Func<Dictionary<string, object?>, Dictionary<string, object?>> throughASave,
            IReadOnlyList<double> separationsMeters)
        {
            Assert.NotNull(restorer);
            Assert.NotNull(sample);
            Assert.NotEmpty(separationsMeters);
            var name = restorer.GetType().Name;

            Assert.False(string.IsNullOrEmpty(sample.ModelId), name + ": a model must name its kind.");

            AssertNoModelAndNoThrow(restorer, "no.such.model", new Dictionary<string, object?>(), name + " given an id it does not know");
            AssertNoThrow(restorer, sample.ModelId, new Dictionary<string, object?>(), name + " given its own id and no data");
            AssertNoThrow(restorer, sample.ModelId, new Dictionary<string, object?> { ["unexpected"] = "shape" }, name + " given its own id and data it did not write");

            var described = throughASave(sample.Describe());
            var rebuilt = restorer.RestoreLinkStrength(sample.ModelId, described);
            Assert.True(rebuilt != null, name + " could not build again a model it described.");

            foreach (var separation in separationsMeters)
            {
                var was = sample.FactsAt(0.0, separation);
                var now = rebuilt!.FactsAt(0.0, separation);
                Assert.True(
                    was.HopStrength.Equals(now.HopStrength),
                    name + ": a rebuilt model's strength at " + separation + " m was " + now.HopStrength + " and the original's " + was.HopStrength + ".");
                Assert.True(
                    was.Quantity == now.Quantity,
                    name + ": a rebuilt model states its strength as " + now.Quantity + " where the original stated " + was.Quantity + ".");
                Assert.True(
                    Same(was.Extensions, now.Extensions),
                    name + ": a rebuilt model's extensions at " + separation + " m differ from the original's.");
            }
        }

        private static void AssertNoModelAndNoThrow(ILinkStrengthRestorer restorer, string id, IReadOnlyDictionary<string, object?> data, string what)
        {
            IContactLinkStrength? model = null;
            Exception? ex = null;
            try
            {
                model = restorer.RestoreLinkStrength(id, data);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(ex == null && model == null, what + " must return null, not " + (ex == null ? "a model" : "throw " + ex.GetType().Name) + ".");
        }

        private static void AssertNoThrow(ILinkStrengthRestorer restorer, string id, IReadOnlyDictionary<string, object?> data, string what)
        {
            Exception? ex = null;
            try
            {
                restorer.RestoreLinkStrength(id, data);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(ex == null, what + " must not throw, and threw " + ex?.GetType().Name + ".");
        }

        private static bool Same(object? a, object? b)
        {
            if (a == null || b == null)
            {
                return a == null && b == null;
            }
            if (a is IDictionary<string, object?> da && b is IDictionary<string, object?> db)
            {
                if (da.Count != db.Count)
                {
                    return false;
                }
                foreach (var entry in da)
                {
                    if (!db.TryGetValue(entry.Key, out var other) || !Same(entry.Value, other))
                    {
                        return false;
                    }
                }
                return true;
            }
            if (a is System.Collections.IList la && b is System.Collections.IList lb)
            {
                if (la.Count != lb.Count)
                {
                    return false;
                }
                for (var i = 0; i < la.Count; i++)
                {
                    if (!Same(la[i], lb[i]))
                    {
                        return false;
                    }
                }
                return true;
            }
            return a.Equals(b);
        }
    }
}
