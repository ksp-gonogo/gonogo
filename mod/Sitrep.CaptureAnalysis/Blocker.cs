namespace Sitrep.CaptureAnalysis;

/// <summary>
/// A question the capture cannot answer, stated as such.
///
/// <para>This type is the reason the tool exists. Three analyses of this same
/// question have already reached wrong conclusions, and in each case the capture
/// was missing something the reader did not notice was missing: a null
/// <c>vessel.orbit</c> because recording started during a scene load, a sample
/// cadence that was assumed rather than measured. The failure was never bad
/// arithmetic, it was arithmetic performed on absent inputs and reported with the
/// same confidence as the rest.</para>
///
/// <para>So every derived conclusion here is gated on its inputs, and a gate that
/// closes emits one of these instead of a number. <see cref="Remedy"/> is not
/// decoration: a blocker that does not say what would lift it invites the reader
/// to guess, which is the behaviour being designed out.</para>
/// </summary>
public sealed class Blocker
{
    public Blocker(string question, string reason, string remedy)
    {
        Question = question;
        Reason = reason;
        Remedy = remedy;
    }

    /// <summary>What could not be concluded.</summary>
    public string Question { get; }

    /// <summary>What the capture (or the invocation) lacks.</summary>
    public string Reason { get; }

    /// <summary>What would have to change for the question to become answerable.</summary>
    public string Remedy { get; }
}
