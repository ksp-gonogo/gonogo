using System;

namespace Sitrep.Host.BodyTextures
{
    /// <summary>
    /// The <c>bodies.texture.&lt;body&gt;</c> namespace: the Topic each
    /// celestial body's surface map is sent on, keyed by the body's name as the
    /// stream reports it, escaped as one topic segment.
    /// </summary>
    public static class BodyTextureWire
    {
        /// <summary>The namespace every body's map Topic sits under.</summary>
        public const string Prefix = "bodies.texture.";

        /// <summary>The key under <see cref="Prefix"/> for the body named <paramref name="body"/>.</summary>
        public static string Key(string body) => CraftFileTopic.EscapeSegment(body);

        /// <summary>
        /// The body name a <see cref="Key"/> was made from, or <c>false</c> when
        /// <paramref name="key"/> is not one: empty, holding a dot, or with an
        /// escape that is not two hexadecimal digits.
        /// </summary>
        public static bool TryParseKey(string key, out string body)
        {
            body = "";
            if (string.IsNullOrEmpty(key) || key.IndexOf('.') >= 0)
            {
                return false;
            }
            if (!PartShapeWire.TryParseKey(key, out var name, out var variant) || variant != null)
            {
                return false;
            }
            body = name;
            return body.Length > 0;
        }

        /// <summary>The Topic for the body named <paramref name="body"/>.</summary>
        public static string Topic(string body) => Prefix + Key(body ?? throw new ArgumentNullException(nameof(body)));
    }
}
