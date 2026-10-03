using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ICommsContactModel"/> and the <see cref="IContactLinkModel"/>
    /// it hands back promise, for an implementer to run against their own backend.
    /// </summary>
    public static class ContactModelConformance
    {
        /// <summary>
        /// Asserts the contract for one pair: a model for an end the backend does
        /// not know is refused rather than thrown at, and a model that is returned
        /// keeps the link model's own contract over <paramref name="fromUt"/> to
        /// <paramref name="toUt"/>.
        /// </summary>
        /// <param name="model">The backend under test.</param>
        /// <param name="from">One end, as the backend's own node object.</param>
        /// <param name="to">The other end.</param>
        /// <param name="ut">The instant the aims are read at.</param>
        /// <param name="positions">Where every node and body is, as the planner would supply it, the two ends included as <c>"from"</c> and <c>"to"</c>.</param>
        /// <param name="toUt">How far ahead to evaluate the returned link.</param>
        public static void AssertContactModelContract(
            ICommsContactModel model, object? from, object? to, double ut, IContactPositions positions, double toUt)
        {
            Assert.NotNull(model);
            var name = model.GetType().Name;

            IContactLinkModel? unknown = null;
            Exception? ex = null;
            try
            {
                unknown = model.LinkModel(new object(), new object(), ut);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(
                ex == null && unknown == null,
                name + ".LinkModel must return null for nodes it does not recognise, not "
                + (ex == null ? "a model" : "throw " + ex.GetType().Name) + ". Null leaves the pair to "
                + "geometry, which is the honest answer for an end the backend knows nothing about.");

            var link = model.LinkModel(from, to, ut);
            if (link != null)
            {
                AssertLinkModelContract(link, positions, ut, toUt);
            }
        }

        /// <summary>
        /// Asserts a link model is a pure, finite function of time: every margin
        /// over the span is finite, and an instant asked again after others gets
        /// the same answer it got first.
        /// </summary>
        /// <param name="link">The link model under test.</param>
        /// <param name="positions">Where every node and body is, as the planner would supply it, the two ends included as <c>"from"</c> and <c>"to"</c>.</param>
        /// <param name="fromUt">The start of the span.</param>
        /// <param name="toUt">The end of the span; must be after <paramref name="fromUt"/>.</param>
        public static void AssertLinkModelContract(IContactLinkModel link, IContactPositions positions, double fromUt, double toUt)
        {
            Assert.NotNull(link);
            Assert.NotNull(positions);
            Assert.True(toUt > fromUt, "the span to evaluate over must end after it starts");
            var name = link.GetType().Name;

            const int samples = 64;
            var first = new double[samples + 1];
            for (var i = 0; i <= samples; i++)
            {
                var ut = fromUt + ((toUt - fromUt) * i / samples);
                first[i] = link.MarginAt(ut, End(positions, "from", ut), End(positions, "to", ut), positions);
                Assert.False(
                    double.IsNaN(first[i]) || double.IsInfinity(first[i]),
                    name + ".MarginAt(" + ut + ") is " + first[i] + ". A margin is finite: its sign is the "
                    + "answer and the planner bisects on it, so a non-finite value places no edge.");
            }

            // Backwards, so a model carrying state from one call to the next answers differently.
            for (var i = samples; i >= 0; i--)
            {
                var ut = fromUt + ((toUt - fromUt) * i / samples);
                var again = link.MarginAt(ut, End(positions, "from", ut), End(positions, "to", ut), positions);
                Assert.True(
                    again.Equals(first[i]),
                    name + ".MarginAt(" + ut + ") gave " + first[i] + " and then " + again + ". A link model "
                    + "is pure: the planner asks in any order and many times for one instant, so anything "
                    + "that changes over the plan is decided as a function of time, not carried between calls.");
            }
        }

        private static Vector3d End(IContactPositions positions, string id, double ut) =>
            positions.NodeAt(id, ut) ?? new Vector3d(0, 0, 0);
    }
}
