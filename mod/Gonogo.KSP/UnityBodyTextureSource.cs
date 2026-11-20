using System;
using Sitrep.Host.BodyTextures;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Rendering;

namespace Gonogo.KSP
{
    /// <summary>
    /// Reads a body's surface map from its scaled-space material's
    /// <c>_MainTex</c>. The game keeps none of these readable on the CPU, so
    /// the map is drawn into a render texture at the size wanted, which also
    /// lets the card pick the right mipmap, and read back a strip per frame.
    /// </summary>
    internal sealed class UnityBodyTextureSource : IBodyTextureSource
    {
        private const string MapProperty = "_MainTex";

        /* FlightGlobals lives for the whole game once the loading screen has built the system, the main menu included. */
        public bool BodiesLoaded
        {
            get
            {
                var bodies = FlightGlobals.fetch != null ? FlightGlobals.Bodies : null;
                return bodies != null && bodies.Count > 0;
            }
        }

        public BodyTextureDescription? Describe(string body, out string reason)
        {
            var texture = Find(body, out reason);
            if (texture == null)
            {
                return null;
            }
            var flat = texture as Texture2D;
            return new BodyTextureDescription(
                body,
                texture.name,
                texture.width,
                texture.height,
                flat != null ? flat.format.ToString() : texture.GetType().Name,
                flat != null ? flat.mipmapCount : 1);
        }

        public IBodyTextureRead BeginRead(BodyTextureDescription description, int width, int height)
        {
            var texture = Find(description.Body, out var reason);
            if (texture == null)
            {
                throw new InvalidOperationException(reason);
            }
            var target = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            Graphics.Blit(texture, target);
            return new StripRead(target, width, height);
        }

        private static Texture? Find(string body, out string reason)
        {
            var bodies = FlightGlobals.fetch != null ? FlightGlobals.Bodies : null;
            CelestialBody? match = null;
            if (bodies != null)
            {
                foreach (var b in bodies)
                {
                    if (b != null && b.bodyName == body)
                    {
                        match = b;
                        break;
                    }
                }
            }
            if (match == null)
            {
                reason = "no body of that name is loaded";
                return null;
            }
            var scaled = match.scaledBody;
            var renderer = scaled != null ? scaled.GetComponent<Renderer>() : null;
            var material = renderer != null ? renderer.sharedMaterial : null;
            if (material == null)
            {
                reason = "it has no scaled-space material";
                return null;
            }
            if (!material.HasProperty(MapProperty))
            {
                reason = "its shader (" + material.shader.name + ") has no " + MapProperty;
                return null;
            }
            var texture = material.GetTexture(MapProperty);
            if (texture == null)
            {
                reason = "its material holds no " + MapProperty;
                return null;
            }
            if (texture.dimension != TextureDimension.Tex2D)
            {
                reason = "its " + MapProperty + " is a " + texture.dimension + ", not a flat map";
                return null;
            }
            reason = "";
            return texture;
        }

        /// <summary>A render texture read back <see cref="RowsPerStrip"/> rows per <see cref="Advance"/>.</summary>
        private sealed class StripRead : IBodyTextureRead
        {
            /* 128 rows of 4096 RGBA pixels is 2 MB per frame. */
            private const int RowsPerStrip = 128;

            private readonly RenderTexture _target;
            private readonly int _width;
            private readonly int _height;
            private readonly byte[] _rgba;
            private Texture2D? _strip;
            private int _row;
            private bool _disposed;

            public StripRead(RenderTexture target, int width, int height)
            {
                _target = target;
                _width = width;
                _height = height;
                _rgba = new byte[width * height * 4];
            }

            public byte[] Rgba => _rgba;

            public bool Advance()
            {
                var rows = Math.Min(RowsPerStrip, _height - _row);
                if (_strip == null || _strip.height != rows)
                {
                    if (_strip != null)
                    {
                        UnityEngine.Object.Destroy(_strip);
                    }
                    _strip = new Texture2D(_width, rows, TextureFormat.RGBA32, false, false);
                }

                var previous = RenderTexture.active;
                RenderTexture.active = _target;
                try
                {
                    _strip.ReadPixels(new Rect(0, _row, _width, rows), 0, 0, false);
                }
                finally
                {
                    RenderTexture.active = previous;
                }
                var data = _strip.GetRawTextureData<byte>();
                NativeArray<byte>.Copy(data, 0, _rgba, _row * _width * 4, rows * _width * 4);
                _row += rows;
                return _row >= _height;
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }
                _disposed = true;
                RenderTexture.ReleaseTemporary(_target);
                if (_strip != null)
                {
                    UnityEngine.Object.Destroy(_strip);
                    _strip = null;
                }
            }
        }
    }
}
