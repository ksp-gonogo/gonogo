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

        /// <summary>
        /// The ground-track recurrence, present whenever the producer could fit
        /// one, which is the ordinary case for a closed orbit around a rotating
        /// primary.
        ///
        /// <para>Populated by default because the producer populates it by
        /// default: it computes a closest recurrence during the analysis and its
        /// null-hypothesis path FALLS BACK to that rather than clearing it. A fake
        /// that left this null would agree with the belief this Uplink used to
        /// hold and would let the reader go on ignoring a field that is really
        /// there.</para>
        /// </summary>
        public FakeOrbitRecurrence? recurrence = new FakeOrbitRecurrence();

        /// <summary>The equatorial crossing longitudes, derived by the producer as
        /// a side effect of setting the recurrence above.</summary>
        public FakeEquatorialCrossings? ground_track_equatorial_crossings =
            new FakeEquatorialCrossings();

        /// <summary>
        /// The local mean solar times at the nodes, present only when the
        /// producer had a mean sun to compute them against.
        /// </summary>
        public FakeSolarTimesOfNodes? solar_times_of_nodes = new FakeSolarTimesOfNodes();
#pragma warning restore IDE1006
    }

    /// <summary>
    /// A ground-track recurrence, in the producer's own spelling.
    ///
    /// <para>The triple is Capderou's: <c>nuo</c> revolutions per day, <c>dto</c>
    /// the drift in revolutions, <c>cto</c> the cycle in days. The defaults here
    /// describe a repeating sun-synchronous-ish track, 16 revolutions a day over a
    /// one-day cycle, which is the shape an operator would actually be reading.</para>
    /// </summary>
    public sealed class FakeOrbitRecurrence
    {
#pragma warning disable IDE1006
        public int nuo = 16;
        public int dto = -1;
        public int cto = 7;
        public int number_of_revolutions = 111;

        /// <summary>Radians, like every angle the producer hands across.</summary>
        public double equatorial_shift = -0.0561;
        public double base_interval = 0.3927;
        public double grid_interval = 0.0561;
        public int subcycle = 3;
#pragma warning restore IDE1006
    }

    /// <summary>
    /// Local mean solar times at the nodes, each an interval in RADIANS over
    /// [0, 2π] with π at noon. An angle, not a duration.
    ///
    /// <para>The defaults sit in a narrow band, which is what a sun-synchronous
    /// orbit looks like: the craft crosses the node at the same local time every
    /// pass.</para>
    /// </summary>
    public sealed class FakeSolarTimesOfNodes
    {
#pragma warning disable IDE1006
        public FakeInterval mean_solar_times_of_ascending_nodes =
            new FakeInterval(2.7480, 2.7485);
        public FakeInterval mean_solar_times_of_descending_nodes =
            new FakeInterval(5.8896, 5.8900);
#pragma warning restore IDE1006
    }

    /// <summary>Ascending and descending crossing longitudes, each an interval in
    /// radians.</summary>
    public sealed class FakeEquatorialCrossings
    {
#pragma warning disable IDE1006
        public FakeInterval longitudes_reduced_to_ascending_pass =
            new FakeInterval(0.10, 0.14);
        public FakeInterval longitudes_reduced_to_descending_pass =
            new FakeInterval(3.24, 3.28);
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
