namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Stand-ins carrying Principia's OWN field names, shapes and nesting, so the
    /// reflection walk under test is the real one.
    ///
    /// <para><b>Why these are not mocks.</b> Nothing here implements an interface
    /// the production code owns, and no production behaviour is replaced. The code
    /// under test resolves a field called <c>thrust_in_kilonewtons</c> on whatever
    /// object it is handed, and this is an object with a field called
    /// <c>thrust_in_kilonewtons</c>. If the walk is wrong it fails here exactly as
    /// it would fail against the producer.</para>
    ///
    /// <para><b>The value-type nesting is load-bearing.</b> On the producer,
    /// <c>intensity</c> is a struct FIELD on a class and <c>xyz</c> is a struct
    /// field on that struct. Setting a component means boxing the struct, changing
    /// the box, and writing the box back, and forgetting the write-back leaves the
    /// burn holding its original Dv while every local says otherwise. Modelling
    /// these as classes would make that bug pass, so they are structs.</para>
    ///
    /// <para>One set of these serves the whole project. Two stand-ins for one
    /// producer struct, each carrying the fields its own test needed, is how a
    /// reflection walk ends up passing against a shape the producer does not have.</para>
    /// </summary>
    public sealed class FakeBurn
    {
#pragma warning disable IDE1006
        public double thrust_in_kilonewtons = 100.0;
        public double specific_impulse_in_seconds_g0 = 300.0;

        /// <summary>
        /// NULL on a fresh burn, exactly as the producer's is.
        ///
        /// <para>The producer's frame is a CLASS with no initialiser, so a burn
        /// built rather than read out of the plugin carries nothing here. A fake
        /// that handed one out anyway is a fake kinder than reality, and it hid a
        /// composed burn failing to take a frame until the rig showed it: the
        /// composer read the null as "this build has no such field" and refused,
        /// and no test could reach the branch.</para>
        /// </summary>
        public FakeBurnFrameParameters? frame;
        public double initial_time;
        public FakeIntensity intensity;
        public bool is_inertially_fixed;
#pragma warning restore IDE1006

        public FakeBurn()
        {
            intensity = new FakeIntensity { coordinate_system_ = 1 };
        }

        /// <summary>A burn as it comes OUT of the plugin, which always carries a
        /// frame: only a burn built from nothing does not.</summary>
        public static FakeBurn FromPlugin() =>
            new FakeBurn(new FakeBurnFrameParameters(6000, 1, -1, -1));

        public FakeBurn(FakeBurnFrameParameters parameters)
            : this()
        {
            frame = parameters;
        }

        /// <summary>A fresh copy, because the producer's marshaller hands back a new
        /// managed object on every read. A fake that returned the same instance
        /// would make the round-trip probe pass by identity, which is the one thing
        /// the probe must not be able to do.</summary>
        public FakeBurn Copy() =>
            new FakeBurn
            {
                thrust_in_kilonewtons = thrust_in_kilonewtons,
                specific_impulse_in_seconds_g0 = specific_impulse_in_seconds_g0,
                frame = frame.Copy(),
                initial_time = initial_time,
                intensity = intensity,
                is_inertially_fixed = is_inertially_fixed,
            };
    }

    /// <summary>The Dv, in whichever coordinate system the burn names.</summary>
    public struct FakeIntensity
    {
#pragma warning disable IDE1006
        /// <summary>The producer stores this as a private byte behind a property
        /// that casts, and this Uplink reads the field rather than the property for
        /// the same reason it does everywhere else: a field read runs no producer
        /// code.</summary>
        public byte coordinate_system_;

        public FakeXyz xyz;
#pragma warning restore IDE1006
    }

    public struct FakeXyz
    {
#pragma warning disable IDE1006
        public double x;
        public double y;
        public double z;
#pragma warning restore IDE1006
    }

    /// <summary>
    /// A burn's manoeuvring frame. The two index fields are PRIVATE on the
    /// producer, behind array-valued properties whose setters throw on the wrong
    /// size, so they are private here too: anything reading them has to go through
    /// the same non-public field lookup production does.
    /// </summary>
    public class FakeBurnFrameParameters
    {
        /// <summary>The implicit constructor the producer's own frame type has, so
        /// a slot that has to be materialised can be.</summary>
        public FakeBurnFrameParameters()
        {
        }

        public FakeBurnFrameParameters(int type, int centre, int primary, int secondary)
        {
            extension = type;
            centre_index = centre;
            primary_index = primary;
            secondary_index = secondary;
        }

#pragma warning disable CS0414, IDE0044, IDE1006
        public int extension;
        public int centre_index;
        private int primary_index;
        private int secondary_index;
#pragma warning restore CS0414, IDE0044, IDE1006

        public FakeBurnFrameParameters Copy() =>
            new FakeBurnFrameParameters(extension, centre_index, primary_index, secondary_index);
    }

    /// <summary>The burn plus everything the plugin computed from integrating it.</summary>
    public class FakeManoeuvre
    {
        public FakeManoeuvre()
        {
        }

        public FakeManoeuvre(FakeBurnFrameParameters frame) => burn = new FakeBurn(frame);

#pragma warning disable IDE1006
        // A manœuvre's burn came OUT of the plugin, so it carries a frame. Only a
        // burn built from nothing does not.
        public FakeBurn burn = FakeBurn.FromPlugin();
        public double initial_mass_in_tonnes = 10.0;
        public double final_mass_in_tonnes = 9.0;
        public double mass_flow = 25.0;
        public double duration = 40.0;
        public double final_time;
        public double time_of_half_delta_v;
        public double time_to_half_delta_v = 20.0;
#pragma warning restore IDE1006

        /// <summary>Sets the burn's ignition instant, which lives on the burn rather
        /// than on the manoeuvre. Fluent so a fixture reads as one expression.</summary>
        public FakeManoeuvre WithIgnition(double ut)
        {
            burn.initial_time = ut;
            return this;
        }

        public FakeManoeuvre Copy() =>
            new FakeManoeuvre
            {
                burn = burn.Copy(),
                initial_mass_in_tonnes = initial_mass_in_tonnes,
                final_mass_in_tonnes = final_mass_in_tonnes,
                mass_flow = mass_flow,
                duration = duration,
                final_time = final_time,
                time_of_half_delta_v = time_of_half_delta_v,
                time_to_half_delta_v = time_to_half_delta_v,
            };
    }

    /// <summary>
    /// The plan's integrator bounds. A struct, as the producer's is, so the
    /// read-mutate-write path goes through a box exactly as it does in production.
    /// </summary>
    public struct FakeStepParameters
    {
        public FakeStepParameters(double tolerance, long steps)
        {
            integrator_kind = 1;
            generalized_integrator_kind = 2;
            max_steps = steps;
            length_integration_tolerance = tolerance;
            speed_integration_tolerance = tolerance;
        }

#pragma warning disable IDE1006
        public long integrator_kind;
        public long generalized_integrator_kind;
        public long max_steps;
        public double length_integration_tolerance;
        public double speed_integration_tolerance;
#pragma warning restore IDE1006

        /// <summary>The pair the shipped build actually holds: kind 1 over the
        /// plan's own equation and kind 2 over the generalized one. Drawn from
        /// disjoint sets, which is why swapping them is unlogged.</summary>
        public static FakeStepParameters Shipped() => new FakeStepParameters(1.0, 1024);
    }
}
