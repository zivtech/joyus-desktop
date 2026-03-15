# App Icons

Icons must be generated before building for distribution. Use Tauri's icon generation tool:

```bash
cargo tauri icon path/to/source-1024x1024.png
```

This generates all required sizes automatically and places them in this directory.

## Required sizes

| File | Size | Platform |
|------|------|----------|
| `32x32.png` | 32×32 px | Linux, Windows taskbar |
| `128x128.png` | 128×128 px | Linux, macOS |
| `128x128@2x.png` | 256×256 px | macOS Retina |
| `icon.icns` | Multi-size | macOS app bundle |
| `icon.ico` | Multi-size | Windows app bundle |

## Tray icons

Tray icons are loaded at runtime from the Rust binary. Place them alongside the app icons:

| File | Size | Use |
|------|------|-----|
| `tray-normal.png` | 22×22 px | macOS menu bar (normal state) |
| `tray-warning.png` | 22×22 px | macOS menu bar (warning state) |
| `tray-error.png` | 22×22 px | macOS menu bar (error state) |

On macOS the tray icon should be a monochrome template image (white/transparent) so the system
can apply the correct colour for light/dark menu bar modes.

## Source image requirements

- Start from a 1024×1024 PNG with transparency
- Solid background for Windows `.ico` (the tool handles this automatically)
- Simple, recognisable shape — icons render as small as 16×16 on Windows taskbars
