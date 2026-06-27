# `boot kernel --real` — self-hosted real Linux (v86)

This folder powers the **real x86 Linux kernel** that `boot kernel --real` boots
in the browser via [v86](https://github.com/copy/v86). It is a *genuine* kernel —
not the HERMIT-OS projection.

> **Preinstalled:** a working setup ships here already — the v86 runtime
> (`libv86.js`, `v86.wasm`), BIOS (`seabios.bin`, `vgabios.bin`), a small Buildroot
> Linux ISO (`linux4.iso`, ~7.7 MB, from copy.sh/v86), and an active `manifest.json`.
> `boot kernel --real` works out of the box and renders the real **VGA console**.
> Swap in your own image by editing `manifest.json` (see options below).

If you remove the image/manifest, the command degrades honestly and tells the
visitor it isn't installed (it never fakes a kernel).

## How it works

On `boot kernel --real`, the site fetches **`/vm/manifest.json`**. If present, it
lazy-loads the v86 WASM runtime and boots your image full-screen with a real
serial console. `Ctrl-]` (or the **detach** button) returns to HERMIT-OS.

The v86 runtime + BIOS load from the jsDelivr CDN by default (free, nothing to
host). You only need to provide a **bootable image**.

## Quick start (pick one)

Copy `manifest.example.json` → **`manifest.json`** and keep only the keys for your
chosen image.

### A. Bootable ISO (simplest)
Drop a small ISO here (e.g. **TinyCore Linux** `Core-current.iso`, ~16 MB — well
under Cloudflare Pages' 25 MiB/file limit):
```json
{ "cdrom": "/vm/linux.iso", "memory_size": 134217728 }
```

### B. Kernel + initrd (smallest)
A **Buildroot** `bzImage` + `initrd` (often just a few MB) gives a fast, tiny boot:
```json
{ "bzimage": "/vm/bzImage", "initrd": "/vm/initrd",
  "cmdline": "console=ttyS0 tty0", "memory_size": 134217728 }
```
You can grab ready-made `buildroot-bzimage` / `buildroot-initramfs` artifacts from
the v86 project, or build your own with Buildroot (enable a serial console).

### C. Saved state (instant boot)
A v86 **saved state** (`.bin.zst`) restores an already-booted Linux instantly.
Create one in a local v86 session (`save_state()`), drop it here:
```json
{ "initial_state": "/vm/state.bin.zst", "memory_size": 134217728 }
```

## Optional: fully self-host (no CDN)
Add these files to `/vm/` and point the manifest at them:
`v86.wasm`, `libv86.js`, `seabios.bin`, `vgabios.bin` — then set
`wasm_path`, `libv86`, `bios`, `vga_bios` to the `/vm/...` paths.

## Notes
- **Per-file limit:** Cloudflare Pages allows up to **25 MiB per file**. Keep the
  image under that (TinyCore and Buildroot images qualify; full Debian usually does
  not — split or use a saved state).
- Everything stays on the **free tier** (static assets, unlimited bandwidth).
- Recommended for the "wow" with the smallest footprint: **Buildroot bzImage+initrd**
  (option B) or **TinyCore ISO** (option A).
