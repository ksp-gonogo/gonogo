using System;
using System.Runtime.CompilerServices;

namespace Sitrep.Contract;

/// <summary>
/// A comms backend's own node, carried through Gonogo without Gonogo knowing
/// what it is: in practice a KSP <c>CommNet.CommNode</c>, or a subclass of one.
///
/// <para>Every seam that names a node takes or returns one of these:
/// <see cref="ICommsBackend.RouteBetween"/>, <see cref="ICommsBackend.ReachModel"/>,
/// <see cref="ICommsBackend.ControlPathTerminus"/>,
/// <see cref="ICommsContactModel.LinkModel"/>, <see cref="ICommsPathStrength.LinkStrength"/>
/// and <see cref="ICommsRetargetBackend.RetargetModel"/>, and the handles on
/// <see cref="CommsNodeView"/> and <see cref="CommsRouteHop"/>. A node is never
/// confused with a craft or a link at any of them, because neither is one of
/// these.</para>
///
/// <para>Make one with <see cref="Of"/> and read the node back with
/// <see cref="As{T}"/>. Two handles are equal when they wrap the same object,
/// by reference, however many times it was wrapped. Gonogo only compares and
/// carries a handle; it never reads the node.</para>
///
/// <para>The node is live game state: a handle must not cross a thread or
/// outlive the capture that produced it.</para>
/// </summary>
/// <category>Uplink API</category>
public sealed class CommsNodeHandle : IEquatable<CommsNodeHandle>
{
    private readonly object _node;

    private CommsNodeHandle(object node)
    {
        _node = node;
    }

    /// <summary>A handle on <paramref name="node"/>, or null when there is no node.</summary>
    /// <param name="node">The backend's own node object.</param>
    /// <returns>The handle, or null for a null node.</returns>
    public static CommsNodeHandle? Of(object? node) => node == null ? null : new CommsNodeHandle(node);

    /// <summary>
    /// The node as <typeparamref name="T"/>, or null when it is not one: a node
    /// some other backend made, which this backend treats as unrecognised.
    /// </summary>
    /// <typeparam name="T">The node type this backend works in.</typeparam>
    /// <returns>The node, or null.</returns>
    public T? As<T>() where T : class => _node as T;

    /// <summary>Whether both handles wrap the same object.</summary>
    /// <param name="other">The other handle.</param>
    /// <returns>True for the same node.</returns>
    public bool Equals(CommsNodeHandle? other) => other is not null && ReferenceEquals(_node, other._node);

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as CommsNodeHandle);

    /// <inheritdoc />
    public override int GetHashCode() => RuntimeHelpers.GetHashCode(_node);

    /// <summary>Whether two handles wrap the same object, two nulls included.</summary>
    /// <param name="a">One handle.</param>
    /// <param name="b">The other.</param>
    /// <returns>True for the same node, or both null.</returns>
    public static bool operator ==(CommsNodeHandle? a, CommsNodeHandle? b) =>
        a is null ? b is null : a.Equals(b);

    /// <summary>Whether two handles wrap different objects.</summary>
    /// <param name="a">One handle.</param>
    /// <param name="b">The other.</param>
    /// <returns>False for the same node, or both null.</returns>
    public static bool operator !=(CommsNodeHandle? a, CommsNodeHandle? b) => !(a == b);
}
