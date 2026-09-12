using System;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// The frame's <c>type</c> discriminant is absent, unreadable, or names no
    /// envelope this build knows, so there is nothing to say about it beyond
    /// "not mine". A server that receives one echoes it back as a diagnostic
    /// (see <c>ChannelEngine.OnMessageReceived</c>): it genuinely cannot tell
    /// a client newer than itself from a stray message on the socket.
    /// </summary>
    public class UnknownEnvelopeTypeException : FormatException
    {
        public UnknownEnvelopeTypeException(string message)
            : base(message)
        {
        }

        public UnknownEnvelopeTypeException(string message, Exception innerException)
            : base(message, innerException)
        {
        }
    }

    /// <summary>
    /// The frame's type WAS recognised and a required field inside it was
    /// missing or the wrong JSON type.
    ///
    /// <para>Held apart from <see cref="UnknownEnvelopeTypeException"/> because
    /// the two want opposite answers. Here the server knows exactly which
    /// envelope it was handed and exactly which field is wrong, so it says so;
    /// echoing instead hands a command-request author back their own frame,
    /// which reads as a reply and hides the refusal completely.</para>
    /// </summary>
    public class InvalidEnvelopeException : FormatException
    {
        public InvalidEnvelopeException(string envelopeType, string? requestId, Exception innerException)
            : base(envelopeType + " envelope rejected: " + innerException.Message, innerException)
        {
            EnvelopeType = envelopeType;
            RequestId = requestId;
        }

        /// <summary>The <c>type</c> the frame did carry, e.g. <c>command-request</c>.</summary>
        public string EnvelopeType { get; }

        /// <summary>
        /// The <c>requestId</c> read straight off the raw JSON where the frame
        /// carried a readable one, so a refusal can be correlated to the
        /// caller's pending command instead of being dropped. Null for the
        /// envelopes that have no such field, and for a command-request whose
        /// <c>requestId</c> is itself the broken part.
        /// </summary>
        public string? RequestId { get; }

        /// <summary>What was wrong, naming the field: the parser's own message.</summary>
        public string Detail => InnerException?.Message ?? Message;
    }
}
