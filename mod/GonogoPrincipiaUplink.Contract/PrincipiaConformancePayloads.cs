#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoPrincipiaUplink;

/// <summary>
/// Which of Principia's two shipped native builds a process has mapped.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
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
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
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
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
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


/// <summary>
/// The <c>principia.conformance</c> channel: whether the Principia build this game
/// is running is one the Uplink may call into, and how it knows.
///
/// <para>Published because an operator cannot otherwise tell the difference between
/// "your Principia is a release we have vetted" and "we have never seen this build
/// and are not going to guess". Both leave the trajectory looking the same.</para>
///
/// <para>TrueNow rather than delayed, like the settings channel beside it: this is a
/// ground-side fact about which files are on the operator's own machine, not an
/// observation travelling from a craft.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class PrincipiaConformanceReport
{
    /// <summary>The verdict. Absent while the gate has not run yet, which is not the
    /// same as a build that failed it.</summary>
    [SitrepUnit(Units.Enumeration)]
    public PrincipiaConformance State { get; set; }

    /// <summary>Which of the two builds the game actually loaded.</summary>
    [SitrepUnit(Units.Enumeration)]
    public PrincipiaBinaryVariant Variant { get; set; }

    /// <summary>The file the verdict is about, so an operator can go and look at it.</summary>
    public string? ActivePath { get; set; }

    /// <summary>
    /// The interface hash. Carried even for an unrecognised release, because it is
    /// the thing to record when vetting one, and an operator reporting an unknown
    /// build has nothing else to quote.
    /// </summary>
    public string? DescriptorSha256 { get; set; }

    /// <summary>Principia's own build stamp, when the release is one we know.</summary>
    public string? ReleaseName { get; set; }

    /// <summary>How many <c>principia__</c> functions the build exports.</summary>
    [SitrepUnit(Units.Count)]
    public int InterfaceExports { get; set; }

    /// <summary>Why, in the operator's terms. Null when the build is conformant.</summary>
    public string? Reason { get; set; }

    /// <summary>
    /// What a trajectory computed beside the game could claim about its
    /// relationship to the game's own arithmetic.
    ///
    /// <para>Separate from <see cref="State"/> because they answer different
    /// questions. A build can be perfectly vetted while the machine that would
    /// compute with it selects a different numeric path, and an operator deciding
    /// whether to trust a burn needs both.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public PrincipiaNumericsProvenance Provenance { get; set; }

    /// <summary>Why the numbers cannot be the game's own. Null when they can.</summary>
    [SitrepUnit(Units.Text)]
    public string? ProvenanceReason { get; set; }
}
