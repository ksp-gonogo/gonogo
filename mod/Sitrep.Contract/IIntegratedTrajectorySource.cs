namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a provider whose trajectories are INTEGRATED rather than
    /// closed-form, so a consumer can tell what SHAPE of answer it is getting.
    ///
    /// <para>A marker interface rather than a property on
    /// <see cref="IPropagationProvider"/> because it is answered by a TYPE rather
    /// than by a value: an implementation states the shape of its trajectories by
    /// being one of these, and a provider that forgot to say cannot claim to be
    /// analytic by omission.</para>
    ///
    /// <para>Read by a TYPE check at the election site, never by comparing a
    /// provider id. Whether trajectories are integrated is a fact about the
    /// ANSWER that every provider can state; who computed them is a name, and
    /// nothing outside the election may branch on a name.</para>
    ///
    /// <para><b>Here rather than in <c>Sitrep.Propagation</c>, and that move is
    /// what made it reachable.</b> It shipped beside the integrator, which an
    /// Uplink may not reference, so the only assemblies that could declare it were
    /// core's own and none of them knows what physics an install runs. The result
    /// was an interface with one <c>is</c> check, no implementer, and a suite green
    /// over a feature that had never executed. It belongs next to the interface it
    /// marks, where whoever knows the install can say so.</para>
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
