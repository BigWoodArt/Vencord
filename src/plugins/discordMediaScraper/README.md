# Discord Media Scraper for Vencord — v0.1.3

**Desktop app only** (Electron) — the folder picker won't work on the browser or Vesktop-web versions of Vencord. It falls back gracefully to one save dialog per file there.

A Vencord userplugin that adds a **Download Recent Media** option to Discord channel and DM right-click menus.

It searches backward through message history and downloads the newest matching image/video attachments.

## What's new in 0.1.3

- **Bulk download to one folder, for real this time.** The folder picker is now a native OS dialog (like any desktop app), and files are written directly with no browser permission issues. Pick a folder once via "Choose download folder…"; every file after that goes straight there.
- **DMs now work.** Right-click a person in your DM list to scrape that conversation.
- This version adds a `native.ts` file that runs in Electron's main process (not the browser-like renderer) — that's what gives it real file access. Because of this, **you must fully close and reopen Discord after building** — reloading the window (Ctrl+R) is not enough for native code to load.

## How to update (you already have a Vencord dev build)

1. Close Discord.
2. Delete the old plugin folder: `[your Vencord folder]\src\userplugins\discordMediaScraper`
3. Copy the new `discordMediaScraper` folder (from this zip) into `[your Vencord folder]\src\userplugins\`
4. Open a terminal **in your Vencord folder** (use `cmd`, not PowerShell, if you hit the "running scripts is disabled" error again).
5. Run `pnpm build` then `pnpm inject`.
6. **Fully quit Discord** (not just close the window — check your system tray) and reopen it.

## Using it

- Right-click a channel **or** a DM → pick a count (or your default) → the first time, choose a folder → files land there.
- If your Discord version doesn't support the folder picker for some reason, it silently falls back to the old one-dialog-per-file behavior — nothing breaks.

## Supported files

Images: JPG/JPEG, PNG, WEBP, GIF, AVIF, BMP
Videos: MP4, WEBM, MOV, MKV, AVI

Uses Discord's attachment `content_type` when available, falls back to the filename extension.

## Settings (Vencord → Plugins → DiscordMediaScraper)

- Include images / videos / GIFs
- Default download count
- Max messages to scan backward
