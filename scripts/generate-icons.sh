#!/usr/bin/env sh
# Regenerates the web app's icons from public/icon.svg.
#
# Requires rsvg-convert (librsvg) and a font that carries the rupee sign
# (DejaVu Sans does). The generated PNGs are committed, so this only needs to
# run when the icon itself changes. The artwork is full-bleed and stays inside
# the maskable safe zone, so the maskable icon is the same render as the
# 512px icon.
set -eu

web="$(CDPATH= cd -- "$(dirname -- "$0")/../apps/web" && pwd)"
assets="$web/public"

rsvg-convert --width 192 --height 192 "$assets/icon.svg" --output "$assets/pwa-192x192.png"
rsvg-convert --width 512 --height 512 "$assets/icon.svg" --output "$assets/pwa-512x512.png"
rsvg-convert --width 512 --height 512 "$assets/icon.svg" --output "$assets/maskable-icon-512x512.png"
rsvg-convert --width 180 --height 180 "$assets/icon.svg" --output "$assets/apple-touch-icon-180x180.png"
