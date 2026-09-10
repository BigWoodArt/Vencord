/*
 * Vencord, a modification of the Discord desktop app
 * Copyright (c) 2026 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

// This file runs in Electron's MAIN process, not the browser-like renderer.
// That's what gives it real OS dialogs and direct filesystem access, unlike
// the renderer, which is sandboxed like a normal web page.

import { dialog, BrowserWindow, IpcMainInvokeEvent } from "electron";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export async function pickDownloadFolder(event: IpcMainInvokeEvent) {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;

    const result = await dialog.showOpenDialog(win as any, {
        title: "Choose a folder for Discord Media Scraper",
        properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
}

export async function saveFileToFolder(
    _event: IpcMainInvokeEvent,
    folderPath: string,
    filename: string,
    data: Uint8Array
) {
    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, filename), Buffer.from(data));
    return true;
}
