namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a propagation provider whose trajectories are integrated rather
    /// than closed-form, so a consumer can tell what shape of result it is
    /// getting.
    ///
    /// <para>A marker interface rather than a property on
    /// <see cref="IPropagationProvider"/>: a provider states the shape of its
    /// trajectories by implementing it, so one that says nothing cannot claim to
    /// be analytic by omission. The mod reads it with a type check, never by
    /// comparing a provider id.</para>
    ///
    /// <para>Independent of the horizon: the horizon says how far ahead a
    /// trajectory reaches, and this says what shape it is. An integrating
    /// provider in a low-perturbation regime can report an unbounded horizon,
    /// and a client reasoning "unbounded, therefore analytic" would draw a closed
    /// conic for a path the craft will not fly.</para>
    /// <internal>Declared in Sitrep.Contract, next to the interface it marks,
    /// because an Uplink may not reference Sitrep.Propagation and only the
    /// Uplink that knows the install's physics can implement it.</internal>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface IIntegratedTrajectorySource
    {
    }
}
