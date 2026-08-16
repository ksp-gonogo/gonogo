using System;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A margin function chosen by the test rather than derived from an orbit,
    /// so the crossings are known in closed form. It is the only way to test the
    /// SEARCH without the answer depending on the propagator that the search is
    /// supposed to be tested independently of.
    /// </summary>
    internal sealed class AnalyticGeometry : IVisibilityGeometry
    {
        private readonly Func<double, double> _margin;

        public AnalyticGeometry(Func<double, double> margin)
        {
            _margin = margin;
        }

        public int Evaluations { get; private set; }

        public double MarginAt(double ut)
        {
            Evaluations++;
            return _margin(ut);
        }

        public double SeparationAt(double ut) => 0.0;
    }
}
