// Stand-ins for the producer's own managed types, shared across this suite.
//
// Each carries the SHAPE the production readers resolve against: the same member
// names, and crucially the same KIND of member. A field that presented as a
// property here would exercise the property-audit path for a read that never
// takes it in production, and pass on a member the guard would never have been
// asked about.
//
// These outlived the flight-plan window scrape they were written for. The scrape
// is gone; the status type is not, because the plan reader asks the plugin for
// one and reads it exactly as the window reader used to.
namespace GonogoPrincipiaUplink.Tests
{
    public class FakeSlider
    {
#pragma warning disable IDE1006
        public double value { get; set; }
#pragma warning restore IDE1006
    }

    /// <summary>Fields, not properties, because that is what the game's vessel
    /// carries.</summary>
    public class FakeVessel
    {
#pragma warning disable IDE1006
        public object id = "vessel-guid";
        public string vesselName = "Munar Relay";

        /// <summary>The vessel's orbit, whose reference body is what the target
        /// frame is named and described with. A field holding an object, as the
        /// game's own does, so the two-hop read is exercised rather than
        /// short-circuited by a convenience member no production read takes.</summary>
        public object? orbit;
#pragma warning restore IDE1006
    }

    /// <summary>
    /// The plugin's status: two public FIELDS and its own health predicate, as on
    /// the real one.
    ///
    /// <para>Fields matter. <c>error</c> and <c>message</c> are plain fields on the
    /// producer's <c>Status</c>, which is why the plan reader can read them without
    /// an entry on the property audit list, and <c>ok</c> is a method, which is why
    /// it needs one on the invoke allowlist. A fake that made either the other kind
    /// would prove the reader works against a shape the producer does not have.</para>
    /// </summary>
    public class FakeStatus
    {
#pragma warning disable IDE1006
        public int error;
        public string message = "";
        internal bool isOk = true;

        public bool ok() => isOk;
#pragma warning restore IDE1006

        /// <summary>The status a write that landed comes back with.</summary>
        public static FakeStatus Ok() => new FakeStatus();

        /// <summary>The status a write the producer DECLINED comes back with: its
        /// own code and its own words, which name conditions we do not model.</summary>
        public static FakeStatus Declined(int code, string text) =>
            new FakeStatus { error = code, message = text, isOk = false };
    }
}
