namespace Sitrep.Propagation
{
    /// <summary>
    /// Marks a provider whose trajectories are INTEGRATED rather than
    /// closed-form, so a consumer can tell what SHAPE of answer it is getting.
    ///
    /// <para>A marker interface rather than a property on
    /// <see cref="IPropagationProvider"/> because this assembly deliberately has
    /// no project references, and the enumeration a client sees
    /// (<c>Sitrep.Contract.TrajectoryKind</c>) lives in the contract. Keeping
    /// this assembly dependency-free is worth more than folding one more member
    /// onto the interface.</para>
    ///
    /// <para>Read by a TYPE check at the election site, never by comparing a
    /// provider id. Whether trajectories are integrated is a fact about the
    /// ANSWER that every provider can state; who computed them is a name, and
    /// nothing outside the election may branch on a name.</para>
    ///
    /// <para>Why a consumer needs it, given the horizon already exists: the
    /// horizon answers REACH and this answers SHAPE, and neither implies the
    /// other. An integrating provider in a low-perturbation regime can honestly
    /// report an unbounded horizon, and a client reasoning "unbounded, therefore
    /// analytic, therefore an ellipse is fine" would draw a closed conic for a
    /// path the craft will not fly.</para>
    /// </summary>
    public interface IIntegratedTrajectorySource
    {
    }
}
