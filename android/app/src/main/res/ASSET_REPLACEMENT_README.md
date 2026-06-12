# Android icon/splash replacement notes

Capacitor generated default launcher and splash assets. Replace them with branded artwork before release.

## Launcher icon resources
Replace these files with final exports for each density:
- `mipmap-mdpi/ic_launcher.png` (48x48)
- `mipmap-hdpi/ic_launcher.png` (72x72)
- `mipmap-xhdpi/ic_launcher.png` (96x96)
- `mipmap-xxhdpi/ic_launcher.png` (144x144)
- `mipmap-xxxhdpi/ic_launcher.png` (192x192)
- matching `ic_launcher_round.png`
- matching `ic_launcher_foreground.png` for adaptive icon foreground

Adaptive icon XML is already wired via:
- `mipmap-anydpi-v26/ic_launcher.xml`
- `mipmap-anydpi-v26/ic_launcher_round.xml`

## Splash resources
Replace `drawable*/splash.png` files for all densities/orientations.

## Store listing asset
Also prepare separate Play listing icon: 512x512, 32-bit PNG.
