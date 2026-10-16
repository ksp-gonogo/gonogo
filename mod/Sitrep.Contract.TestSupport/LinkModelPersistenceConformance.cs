using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="IPersistableContactLinkModel"/> and <see cref="ILinkModelRestorer"/>
    /// promise, for an implementer to run against their own backend.
    /// </summary>
    public static class LinkModelPersistenceConformance
    {
        /// <summary>
        /// Asserts the contract for one model the backend can describe: an id the
        /// restorer does not know and data it did not write give no model and no
        /// throw, and what <paramref name="sample"/> described, as a save reads it
        /// back (<paramref name="throughASave"/>), builds a model whose margin is
        /// the sample's at every pair of ends tried.
        /// </summary>
        /// <param name="restorer">The backend under test.</param>
        /// <param name="sample">A model the backend made, with antennas that make its margin vary with where the ends are.</param>
        /// <param name="throughASave">Writes a description as a save would and reads it back, returning nested dictionaries, lists, strings, doubles, booleans and nulls only.</param>
        /// <param name="positions">Where every other node and body is, for a model that resolves where a dish points.</param>
        /// <param name="ends">The positions of the model's two ends to compare the two models at, in metres; at least one pair.</param>
        public static void AssertRestorerContract(
            ILinkModelRestorer restorer,
            IPersistableContactLinkModel sample,
            Func<Dictionary<string, object?>, Dictionary<string, object?>> throughASave,
            IContactPositions positions,
            IReadOnlyList<(Vector3d From, Vector3d To)> ends)
        {
            Assert.NotNull(restorer);
            Assert.NotNull(sample);
            Assert.NotEmpty(ends);
            var name = restorer.GetType().Name;

            Assert.False(string.IsNullOrEmpty(sample.ModelId), name + ": a model must name its kind.");

            AssertNoModelAndNoThrow(restorer, "no.such.model", new Dictionary<string, object?>(), name + " given an id it does not know");
            AssertNoThrow(restorer, sample.ModelId, new Dictionary<string, object?>(), name + " given its own id and no data");
            AssertNoThrow(restorer, sample.ModelId, new Dictionary<string, object?> { ["unexpected"] = "shape" }, name + " given its own id and data it did not write");

            var rebuilt = restorer.RestoreLinkModel(sample.ModelId, throughASave(sample.Describe()));
            Assert.True(rebuilt != null, name + " could not build again a model it described.");

            foreach (var (from, to) in ends)
            {
                var was = sample.MarginAt(0.0, from, to, positions);
                var now = rebuilt!.MarginAt(0.0, from, to, positions);
                Assert.True(
                    was.Equals(now),
                    name + ": a rebuilt model's margin between " + Text(from) + " and " + Text(to) + " was " + now + " and the original's " + was + ".");
            }
        }

        private static string Text(Vector3d v) => "(" + v.X + ", " + v.Y + ", " + v.Z + ")";

        private static void AssertNoModelAndNoThrow(ILinkModelRestorer restorer, string id, IReadOnlyDictionary<string, object?> data, string what)
        {
            IContactLinkModel? model = null;
            Exception? ex = null;
            try
            {
                model = restorer.RestoreLinkModel(id, data);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(ex == null && model == null, what + " must return null, not " + (ex == null ? "a model" : "throw " + ex.GetType().Name) + ".");
        }

        private static void AssertNoThrow(ILinkModelRestorer restorer, string id, IReadOnlyDictionary<string, object?> data, string what)
        {
            Exception? ex = null;
            try
            {
                restorer.RestoreLinkModel(id, data);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(ex == null, what + " must not throw, and threw " + ex?.GetType().Name + ".");
        }
    }
}
