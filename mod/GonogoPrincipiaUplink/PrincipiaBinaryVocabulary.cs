// The closed sets the binary gate and the worker decision reason in.
//
// They live in the uplink assembly rather than in its contract slice because no
// client is ever handed one. What an operator is told about the loaded Principia
// reaches them through `system.uplinks` health, in core's own vocabulary: a state
// they can glance at and labelled facts they can quote. These are how this uplink
// works that answer out, and a client that had to learn them would be learning
// Principia's private terms to read something core already names.
namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Which of Principia's two shipped native builds a process has mapped.
    /// </summary>
    public enum PrincipiaBinaryVariant
    {
        /// <summary>Nothing was identified. The refusing answer, so a caller that
        /// forgets to check gets no binary rather than an arbitrary one.</summary>
        Unknown = 0,

        /// <summary>The baseline build, used on a CPU without FMA.</summary>
        X64 = 1,

        /// <summary>The FMA build, selected only when CPUID reports FMA.</summary>
        X64AvxFma = 2,
    }

    /// <summary>
    /// What the gate concluded about the build the game is running.
    /// </summary>
    public enum PrincipiaConformance
    {
        /// <summary>
        /// Nothing was concluded. Zero so a caller that forgets to check gets the
        /// answer that withholds: had `Conformant` been zero, a gate that failed to
        /// run would have read as a pass.
        /// </summary>
        NotEstablished = 0,

        /// <summary>A vetted release, with every intended export present.</summary>
        Conformant = 1,

        /// <summary>
        /// Readable, and nothing is wrong with it, but its interface has not been
        /// vetted here. Its hash is on the verdict so it can be recorded and added.
        /// </summary>
        UnknownRelease = 2,

        /// <summary>
        /// The build is not what it claims: unreadable, carrying no descriptor, or
        /// missing exports a vetted release of that hash is supposed to have.
        /// </summary>
        Refused = 3,
    }

    /// <summary>What relationship a computed trajectory has to the game's own arithmetic.</summary>
    public enum PrincipiaNumericsProvenance
    {
        /// <summary>
        /// Not determined. Zero so an unset field never reads as a claim: the whole
        /// point of this type is that saying "these are the game's numbers" requires
        /// evidence, and a default must not supply it.
        /// </summary>
        NotEstablished = 0,

        /// <summary>
        /// The game's own arithmetic. Same build, same numeric path, same trigonometry.
        /// </summary>
        Reproduced = 1,

        /// <summary>
        /// Everything matched except which trigonometry the save selects, which could
        /// not be read. Its own arm rather than a downgrade to
        /// <see cref="IndependentEstimate"/>: this is a much stronger claim than
        /// "computed with a different build", and collapsing them would tell an
        /// operator deciding whether to trust a burn far less than is known.
        /// </summary>
        ReproducedExceptTrig = 2,

        /// <summary>
        /// Computed with a Principia that is not in the game's configuration. Useful,
        /// and honestly labelled, but not the game's answer.
        /// </summary>
        IndependentEstimate = 3,
    }
}
