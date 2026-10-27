using System;
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The state a contract objective moves to: met, unmet again, or failed.
/// </summary>
/// <category>Uplink API</category>
public enum ObjectiveState
{
    /// <summary>The objective's condition holds: the game's <c>SetComplete</c>.</summary>
    Met,

    /// <summary>The objective's condition no longer holds: the game's <c>SetIncomplete</c>.</summary>
    Unmet,

    /// <summary>The objective has failed: the game's <c>SetFailed</c>.</summary>
    Failed,
}

/// <summary>
/// One change of a contract objective's state, stamped with the craft that
/// caused it and the instant it happened in that craft's own time. Handed to
/// <see cref="IObjectiveDelayLine.Hold"/> so the change takes effect at the
/// home command when word of it arrives from that craft.
/// </summary>
/// <category>Uplink API</category>
public sealed class ObjectiveChange
{
    /// <summary>The contract's <c>Contract.ContractGuid</c>.</summary>
    public Guid ContractId { get; set; }

    /// <summary>
    /// Who can apply this change again after a save is loaded: the id the
    /// holding code passes to <see cref="IObjectiveDelayLine.Rebind"/>. Gonogo's
    /// own stock hooks use <c>"stock"</c>. An Uplink uses one id of its own for
    /// every change it holds.
    /// </summary>
    public string OwnerId { get; set; } = "";

    /// <summary>
    /// Where the objective sits in its contract's tree, as the child index at
    /// each level joined by <c>/</c>: <c>"0"</c> is the contract's first
    /// objective, <c>"1/0"</c> the first child of its second. Unique within
    /// one contract, and stable across a save and load.
    /// </summary>
    public string ObjectivePath { get; set; } = "";

    /// <summary>The state the objective moves to.</summary>
    public ObjectiveState Target { get; set; }

    /// <summary>
    /// The craft whose action caused the change, by <c>Vessel.id</c> GUID
    /// string. Two for a fact that needs both craft, such as a docking, and the
    /// change waits for word from each. Empty for a change with no craft behind
    /// it, which takes effect at once.
    /// </summary>
    public IReadOnlyList<string> SourceVesselIds { get; set; } = Array.Empty<string>();

    /// <summary>The universal time the change happened at, in the source craft's own time.</summary>
    public double CraftUt { get; set; }

    /// <summary>A short label for the objective, shown on the pending-objective row.</summary>
    public string Description { get; set; } = "";
}

/// <summary>
/// The delay line contract objectives cross on their way to the home command:
/// a change of an objective's state takes effect, and the contract is decided,
/// when word of it arrives from the craft that caused it. The active instance
/// of <see cref="ObjectiveDelayCapability"/>.
///
/// <para>Gonogo registers this line, so once capabilities are resolved it is
/// present on every install; before that, resolving it through
/// <see cref="IUplinkHost.Kernel"/> returns nothing, and an Uplink lets the
/// change through unheld. Gonogo holds stock contract objectives itself. An
/// Uplink holds the objectives of a contract mod that changes them by its own
/// route, and calls <see cref="Rebind"/> once so its held changes survive a
/// save and load.</para>
///
/// <para>A change that arrives for a contract no longer active, an objective
/// already met or failed, or a deadline that passed before the craft acted is
/// dropped without calling its apply.</para>
/// <internal>
/// The core registrar is <c>Gonogo.KSP.CurrencyEventUplink</c>, which ships the
/// line as the capability's Vanilla factory, the same shape as
/// <see cref="IDelayedScienceSink"/>.
/// </internal>
/// </summary>
/// <category>Uplink API</category>
public interface IObjectiveDelayLine : ISitrepProvider
{
    /// <summary>
    /// Holds one objective change until word of it reaches the home command.
    /// <paramref name="apply"/> makes the change through the game's own route
    /// and is called on the game's thread when the change arrives; it must not
    /// be held again, so run it behind the same guard the holding hook checks.
    ///
    /// <para>A call that repeats the state the objective is already moving to
    /// is absorbed: it returns true and holds nothing new.</para>
    /// </summary>
    /// <returns>
    /// True when the change is held or absorbed, so the caller must not make it
    /// now. False when it should take effect now: signal delay is switched off,
    /// no game is loaded, or the change names no source craft.
    /// </returns>
    bool Hold(ObjectiveChange change, Action apply);

    /// <summary>
    /// Whether any change for the contract stamped at or before
    /// <paramref name="ut"/>, in craft time, is still on its way home. Useful
    /// for holding a contract's own deadline open while word of something the
    /// craft did before the deadline has not arrived.
    /// </summary>
    /// <param name="contractId">The contract's <c>Contract.ContractGuid</c>.</param>
    /// <param name="ut">The deadline, as a universal time.</param>
    bool HasHeldAtOrBefore(Guid contractId, double ut);

    /// <summary>
    /// Registers how the owner <paramref name="ownerId"/> applies a change it
    /// held, for the changes a loaded save restores without their apply. Call
    /// it once, when the Uplink registers. <paramref name="resolve"/> returns
    /// the apply for a restored change, or null when the objective can no
    /// longer be reached, which drops the change.
    ///
    /// <para>A restored change whose owner has not called this waits, neither
    /// applied nor dropped, so removing an Uplink for a session loses
    /// nothing.</para>
    /// </summary>
    void Rebind(string ownerId, Func<ObjectiveChange, Action?> resolve);
}

/// <summary>
/// The capability id an <see cref="IObjectiveDelayLine"/> is resolved under,
/// and the owner ids Gonogo knows. Use these constants rather than writing the
/// strings: a mismatched id fails silently, as a capability that never
/// resolves.
/// </summary>
/// <category>Uplink API</category>
public static class ObjectiveDelayCapability
{
    /// <summary>The capability id, <c>"objectiveDelay"</c>: resolve an <see cref="IObjectiveDelayLine"/> under exactly this string.</summary>
    public const string CapabilityId = "objectiveDelay";

    /// <summary>The owner id of the changes Gonogo holds itself, for stock contract objectives.</summary>
    public const string StockOwner = "stock";

    /// <summary>
    /// The owner id a Contract Configurator Uplink binds with. While Contract
    /// Configurator is loaded and no owner has bound under this id, Gonogo
    /// reports its contract objectives as reaching home faster than light.
    /// </summary>
    public const string ContractConfiguratorOwner = "contractConfigurator";
}
