/*
 * Vencord, a modification of the Discord desktop app
 * Copyright (c) 2026 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { definePluginSettings } from "@api/Settings";
import { findGroupChildrenByChildId } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { saveFile } from "@utils/web";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Constants, Menu, RestAPI, showToast, Toasts } from "@webpack/common";

const logger = new Logger("DiscordMediaScraper");

const IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/bmp",
]);

const VIDEO_TYPES = new Set([
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/avi",
    "video/mov",
]);

interface Attachment {
    id: string;
    filename: string;
    url: string;
    content_type?: string;
    size?: number;
}

interface DiscordMessage {
    id: string;
    channel_id: string;
    attachments?: Attachment[];
}

const settings = definePluginSettings({
    includeImages: {
        type: OptionType.BOOLEAN,
        description: "Download image attachments.",
        default: true,
    },
    includeVideos: {
        type: OptionType.BOOLEAN,
        description: "Download video attachments.",
        default: true,
    },
    includeGifs: {
        type: OptionType.BOOLEAN,
        description: "Treat GIF files as images.",
        default: true,
    },
    defaultCount: {
        type: OptionType.NUMBER,
        description: "Default number of media files to download.",
        default: 50,
    },
    maxMessages: {
        type: OptionType.NUMBER,
        description: "Maximum messages to scan when looking backward.",
        default: 5000,
    },
});

// Cached for the current Discord session. Cleared on restart, or via
// "Change download folder" in the context menu.
let saveFolderPath: string | undefined;

function nativeHelpers() {
    return (window as any).VencordNative?.pluginHelpers?.DiscordMediaScraper;
}

function supportsNativeFolders() {
    const helpers = nativeHelpers();
    return !!helpers?.pickDownloadFolder && !!helpers?.saveFileToFolder;
}

async function pickFolder() {
    const helpers = nativeHelpers();
    if (!helpers) {
        showToast("Native file access isn't available here. Falling back to one save dialog per file.", Toasts.Type.MESSAGE);
        return undefined;
    }

    try {
        const folder = await helpers.pickDownloadFolder();
        if (!folder) {
            showToast("Folder selection cancelled.", Toasts.Type.MESSAGE);
            return undefined;
        }
        saveFolderPath = folder;
        return folder;
    } catch (error: any) {
        logger.error("Folder picker failed", error);
        showToast(`Couldn't open the folder picker: ${error?.message ?? error}`, Toasts.Type.FAILURE);
        return undefined;
    }
}

function isWantedAttachment(attachment: Attachment) {
    const type = attachment.content_type?.toLowerCase();

    if (type && IMAGE_TYPES.has(type)) {
        return settings.store.includeImages && (type !== "image/gif" || settings.store.includeGifs);
    }

    if (type && VIDEO_TYPES.has(type)) {
        return settings.store.includeVideos;
    }

    const lower = attachment.filename.toLowerCase();

    if (/\.(jpg|jpeg|png|webp|avif|bmp)$/.test(lower)) {
        return settings.store.includeImages;
    }

    if (lower.endsWith(".gif")) {
        return settings.store.includeImages && settings.store.includeGifs;
    }

    if (/\.(mp4|webm|mov|mkv|avi)$/.test(lower)) {
        return settings.store.includeVideos;
    }

    return false;
}

function safeFilename(name: string, fallback: string) {
    const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
    return cleaned || fallback;
}

function uniqueName(name: string, used: Set<string>, id: string) {
    if (!used.has(name)) {
        used.add(name);
        return name;
    }

    const dot = name.lastIndexOf(".");
    const withId = dot === -1
        ? `${name}_${id}`
        : `${name.slice(0, dot)}_${id}${name.slice(dot)}`;

    used.add(withId);
    return withId;
}

async function getMedia(channelId: string, wanted: number) {
    const results: Attachment[] = [];
    const seen = new Set<string>();
    let before: string | undefined;
    let scannedMessages = 0;

    while (results.length < wanted && scannedMessages < settings.store.maxMessages) {
        const response = await RestAPI.get({
            url: Constants.Endpoints.MESSAGES(channelId),
            query: {
                limit: 100,
                ...(before ? { before } : {}),
            },
            retries: 2,
        });

        const messages = (response.body ?? []) as DiscordMessage[];
        if (!messages.length) break;

        scannedMessages += messages.length;

        for (const message of messages) {
            for (const attachment of message.attachments ?? []) {
                if (!isWantedAttachment(attachment)) continue;
                if (seen.has(attachment.url)) continue;

                seen.add(attachment.url);
                results.push(attachment);

                if (results.length >= wanted) break;
            }

            if (results.length >= wanted) break;
        }

        before = messages[messages.length - 1].id;

        if (messages.length < 100) break;
    }

    return { results, scannedMessages };
}

async function downloadMedia(attachments: Attachment[], folderPath?: string) {
    let completed = 0;
    const usedNames = new Set<string>();
    const helpers = nativeHelpers();

    for (const attachment of attachments) {
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const blob = await response.blob();
            const baseName = safeFilename(
                attachment.filename,
                `discord_media_${attachment.id}`
            );
            const filename = uniqueName(baseName, usedNames, attachment.id);

            if (folderPath && helpers) {
                const bytes = new Uint8Array(await blob.arrayBuffer());
                const ok = await helpers.saveFileToFolder(folderPath, filename, bytes);
                if (!ok) throw new Error("Native save reported failure");
            } else {
                saveFile(new File([blob], filename, {
                    type: blob.type || attachment.content_type || "application/octet-stream",
                }));
            }

            completed++;
            await sleep(75);
        } catch (error) {
            logger.warn(`Could not download ${attachment.filename}`, error);
        }
    }

    return completed;
}

async function run(channelId: string, count: number) {
    if (!settings.store.includeImages && !settings.store.includeVideos) {
        showToast("Turn on images or videos in the plugin settings first.", Toasts.Type.FAILURE);
        return;
    }

    let folderPath = saveFolderPath;

    if (supportsNativeFolders() && !folderPath) {
        folderPath = await pickFolder();
        if (!folderPath) return;
    }

    showToast(`Looking for the newest ${count} media files...`, Toasts.Type.MESSAGE);

    try {
        const { results, scannedMessages } = await getMedia(channelId, count);

        if (!results.length) {
            showToast(`No matching media found after scanning ${scannedMessages} messages.`, Toasts.Type.FAILURE);
            return;
        }

        showToast(`Found ${results.length} files. Starting downloads.`, Toasts.Type.SUCCESS);

        const downloaded = await downloadMedia(results, folderPath);

        showToast(
            folderPath
                ? `Downloaded ${downloaded} of ${results.length} files to your chosen folder.`
                : `Downloaded ${downloaded} of ${results.length} files. Check Discord's normal download folder.`,
            downloaded === results.length ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
        );
    } catch (error) {
        logger.error("Media scrape failed", error);
        showToast("The media scrape failed. Check the Vencord console for details.", Toasts.Type.FAILURE);
    }
}

function buildMenuItems(idPrefix: string, getChannelId: () => string | undefined) {
    const counts = [25, 50, 100, 250, 500];
    const defaultCount = Math.max(1, Math.min(1000, Math.floor(settings.store.defaultCount)));

    const items = [
        <Menu.MenuItem
            id={`${idPrefix}-default`}
            label={`Download newest ${defaultCount} (default)`}
            action={() => {
                const channelId = getChannelId();
                if (channelId) void run(channelId, defaultCount);
            }}
        />,
        ...counts.map(count => (
            <Menu.MenuItem
                id={`${idPrefix}-${count}`}
                label={`Download newest ${count}`}
                action={() => {
                    const channelId = getChannelId();
                    if (channelId) void run(channelId, count);
                }}
            />
        )),
    ];

    if (supportsNativeFolders()) {
        items.push(
            <Menu.MenuItem
                id={`${idPrefix}-change-folder`}
                label={saveFolderPath ? "Change download folder…" : "Choose download folder…"}
                action={() => {
                    pickFolder().catch(error => {
                        logger.error("Choose download folder failed", error);
                        showToast(`Couldn't set the folder: ${error?.message ?? error}`, Toasts.Type.FAILURE);
                    });
                }}
            />
        );
    }

    return items;
}

export default definePlugin({
    name: "DiscordMediaScraper",
    description: "Downloads recent image and video attachments from a Discord channel or DM.",
    authors: [Devs.Wood],
    tags: ["Utility"],
    settings,
    contextMenus: {
        "channel-context"(children, props) {
            if (!props?.channel?.id) return;

            const group = findGroupChildrenByChildId(["mute-channel", "unmute-channel"], children);
            const channelId = props.channel.id;
            const items = buildMenuItems("discord-media-scraper", () => channelId);

            if (group) group.push(...items);
            else children.push(<Menu.MenuGroup>{items}</Menu.MenuGroup>);
        },
        "user-context"(children, props) {
            const userId = props?.user?.id;
            if (!userId) return;

            const items = buildMenuItems(
                "discord-media-scraper-dm",
                () => ChannelStore.getDMFromUserId(userId)
            );

            children.push(<Menu.MenuGroup>{items}</Menu.MenuGroup>);
        },
    },
});
