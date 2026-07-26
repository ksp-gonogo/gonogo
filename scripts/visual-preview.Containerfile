# Derived from CI's playwright image, plus the broad font set GitHub's
# ubuntu-latest runner carries. The visual gate embeds JetBrains Mono (its
# latin-400/700 woff2) but text still falls back to SYSTEM fonts for glyphs
# outside that subset (°, ↓, →, ·, Δ, …) and for fontconfig's hinting/AA
# defaults. The stock playwright:noble image is minimal (only playwright's
# --with-deps fonts), so those fall back DIFFERENTLY than on ubuntu-latest and
# text-heavy widgets drift. Installing the same families ubuntu-latest resolves
# to makes the container's rasterisation faithful to the CI `visual` job.
#
# ARG lets the wrapper pin the base to the lockfile's playwright version.
ARG PW_VERSION=1.60.0
FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      fontconfig \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-freefont-ttf \
      fonts-noto-core \
      fonts-noto-mono \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*
