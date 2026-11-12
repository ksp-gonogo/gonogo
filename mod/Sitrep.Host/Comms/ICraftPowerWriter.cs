using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Tells the engine which craft have no electric charge to run their radio
    /// (see <see cref="CraftPower"/>). An unpowered craft records nothing, so what
    /// it would have said while dark is a gap on the ground, never a recording
    /// replayed when its link returns.
    ///
    /// <para>Off <c>IUplinkHost</c> because its only writer is gonogo's own comms
    /// capture, which already references this assembly.</para>
    /// </summary>
    public interface ICraftPowerWriter
    {
        /// <summary>Replace the whole set, each craft as <c>vessel:&lt;guid&gt;</c>. Callable from any thread.</summary>
        void SetUnpoweredCraft(IReadOnlyCollection<string> craftIds);
    }
}
