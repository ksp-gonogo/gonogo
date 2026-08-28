using System;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Stand-ins carrying Principia's own analysis field names and nesting, so the
    /// reflection walk under test is the real one.
    ///
    /// <para>Same rule as <see cref="FakeBurn"/>: nothing here implements a
    /// production interface and no production behaviour is replaced. The reader
    /// resolves a field called <c>mean_semimajor_axis</c> on whatever it is handed,
    /// and this is an object with a field of that name.</para>
    /// </summary>
    public sealed class FakeOrbitAnalysis
    {
#pragma warning disable IDE1006
        public double progress_of_next_analysis;
        public int? primary_index = 1;
        public double mission_duration = 604800.0;

        /// <summary>Null on an analysis that ran and could not determine elements,
        /// which is a state distinct from having no analysis at all.</summary>
        public FakeOrbitalElements? elements = new FakeOrbitalElements();
#pragma warning restore IDE1006
    }

    /// <summary>
    /// The element set. A CLASS holding <see cref="FakeInterval"/> STRUCTS, which is
    /// the producer's own nesting: a reader that only handles class-typed fields
    /// would pass against a flatter fake and read nothing off the real one.
    /// </summary>
    public sealed class FakeOrbitalElements
    {
#pragma warning disable IDE1006
        public double sidereal_period = 5400.0;
        public double nodal_period = 5390.0;
        public double anomalistic_period = 5410.0;

        /// <summary>Radians per second, which is what the producer carries and NOT
        /// what an operator reads. A fake holding degrees per day would make the
        /// conversion under test invisible.</summary>
        public double nodal_precession = 1.0e-6;

        public FakeInterval mean_semimajor_axis = new FakeInterval(6_700_000, 6_710_000);
        public FakeInterval mean_eccentricity = new FakeInterval(0.001, 0.004);
        public FakeInterval mean_inclination = new FakeInterval(Math.PI / 4, Math.PI / 4);
        public FakeInterval mean_longitude_of_ascending_nodes = new FakeInterval(0.0, 0.1);
        public FakeInterval mean_argument_of_periapsis = new FakeInterval(1.0, 1.2);

        /// <summary>DISTANCES from the primary's centre, as the producer carries
        /// them. The altitude an operator reads is these minus the radius, and a
        /// fake holding altitudes would hide the offset the reader has to
        /// apply.</summary>
        public FakeInterval mean_periapsis_distance = new FakeInterval(6_650_000, 6_660_000);
        public FakeInterval mean_apoapsis_distance = new FakeInterval(6_750_000, 6_760_000);
        public FakeInterval radial_distance = new FakeInterval(6_640_000, 6_770_000);

        public double? first_collision_time;
        public double? first_collision_risk_time;
        public double? first_reentry_time;

        /// <summary>The iterator the reader frees and reads nothing from. Its
        /// disposal is the point: the producer's marshaller cleanup is empty, so
        /// nothing but a finaliser ever frees the native vector behind one.</summary>
        public FakeDisposableIterator plottable_elements = new FakeDisposableIterator();
#pragma warning restore IDE1006
    }

    /// <summary>A closed interval. A struct, as the producer's is.</summary>
    public struct FakeInterval
    {
#pragma warning disable IDE1006
        public double min;
        public double max;
#pragma warning restore IDE1006

        public FakeInterval(double min, double max)
        {
            this.min = min;
            this.max = max;
        }
    }

    /// <summary>Records whether it was disposed, which is the only thing the reader
    /// is meant to do with it.</summary>
    public sealed class FakeDisposableIterator : IDisposable
    {
        public int Disposals { get; private set; }

        public void Dispose() => Disposals++;
    }
}
