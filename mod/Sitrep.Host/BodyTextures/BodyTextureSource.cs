using System;

namespace Sitrep.Host.BodyTextures
{
    /// <summary>
    /// What the game says about one body's surface texture before anything is
    /// read from the graphics card: enough to name the cached copy and to size
    /// the read.
    /// </summary>
    public sealed class BodyTextureDescription
    {
        public BodyTextureDescription(string body, string textureName, int width, int height, string format, int mipCount)
        {
            Body = body ?? throw new ArgumentNullException(nameof(body));
            TextureName = textureName ?? "";
            Width = width;
            Height = height;
            Format = format ?? "";
            MipCount = mipCount;
        }

        /// <summary>The body's name, as the stream reports it.</summary>
        public string Body { get; }

        /// <summary>The texture asset's own name in the game.</summary>
        public string TextureName { get; }

        /// <summary>Source width in pixels.</summary>
        public int Width { get; }

        /// <summary>Source height in pixels.</summary>
        public int Height { get; }

        /// <summary>The texture's storage format as the game names it, such as <c>BC7</c> or <c>DXT1Crunched</c>.</summary>
        public string Format { get; }

        /// <summary>How many mipmap levels the texture carries.</summary>
        public int MipCount { get; }
    }

    /// <summary>
    /// One body's map being read back from the graphics card a strip at a time,
    /// so no single frame waits for the whole picture. Driven on the game's main
    /// thread; dispose it to release what it holds on the card.
    /// </summary>
    public interface IBodyTextureRead : IDisposable
    {
        /// <summary>Reads the next strip; true once every row has been read.</summary>
        bool Advance();

        /// <summary>The map once <see cref="Advance"/> has returned true: RGBA32, bottom row first, at the size the read was started at.</summary>
        byte[] Rgba { get; }
    }

    /// <summary>The game side of serving body maps. Every member is called on the game's main thread.</summary>
    public interface IBodyTextureSource
    {
        /// <summary>
        /// Whether the game has built its bodies. Until it has, as while the game
        /// is still loading, a request waits rather than being answered with no map.
        /// </summary>
        bool BodiesLoaded { get; }

        /// <summary>
        /// Describes the surface texture of the body named <paramref name="body"/>,
        /// or returns null with <paramref name="reason"/> saying why there is none
        /// to read: no such body, or its material carries no readable map.
        /// </summary>
        BodyTextureDescription? Describe(string body, out string reason);

        /// <summary>Starts reading the described texture, scaled on the card to <paramref name="width"/> by <paramref name="height"/>.</summary>
        IBodyTextureRead BeginRead(BodyTextureDescription texture, int width, int height);
    }
}
