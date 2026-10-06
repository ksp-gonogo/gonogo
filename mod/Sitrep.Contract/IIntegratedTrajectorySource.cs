namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a propagation provider whose trajectories are integrated rather
    /// than closed-form, so a consumer can tell what shape of result it is
    /// getting.
    ///
    /// <para>Implement it on an <see cref="IPropagationProvider"/> that
    /// integrates. A provider that does not implement it is read as closed-form.
    /// Gonogo checks the type, never the provider id.</para>
    ///
    /// <para>It is independent of the horizon: the horizon says how far ahead a
    /// trajectory reaches, and this says what shape it is. An integrating
    /// provider with little perturbation can report an unbounded horizon, and is
    /// still not closed-form.</para>
    /// <internal>A marker interface rather than a property, so a provider that
    /// says nothing cannot claim to be analytic by omission. Declared in
    /// Sitrep.Contract, next to the interface it marks, because an Uplink may not
    /// reference Sitrep.Propagation and only the Uplink that knows the install's
    /// physics can implement it.</internal>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface IIntegratedTrajectorySource
    {
    }
}
