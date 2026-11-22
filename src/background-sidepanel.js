// 侧边栏字幕桥接：content script 把当前视频的字幕推送到这里，
// 侧边栏页面从后台读取。这样侧边栏是独立 Document，视频页面无需覆盖层，
// 播放/暂停/进度完全不受影响。
"use strict";

var SIDE_PANEL_STORAGE_KEY = "auraSidePanelTranscript";
var SIDE_PANEL_TAB_KEY = "auraSidePanelTabId";
var sidePanelTranscript = null;
var sidePanelSourceTabId = 0;

function normalizeSidePanelCue(cue) {
    if (!cue || typeof cue !== "object") return null;
    const startMs = Number(cue.startMs);
    if (!Number.isFinite(startMs) || startMs < 0) return null;
    const endMs = Number(cue.endMs);
    const text = (value) => typeof value === "string" ? value.slice(0, 4000) : "";
    return {
        id: text(cue.id),
        startMs,
        endMs: Number.isFinite(endMs) && endMs >= startMs ? endMs : startMs,
        sourceText: text(cue.sourceText),
        displaySourceText: text(cue.displaySourceText),
        translatedText: text(cue.translatedText),
        status: text(cue.status)
    };
}

function normalizeSidePanelPayload(message) {
    const raw = Array.isArray(message && message.cues) ? message.cues : [];
    const cues = raw.map(normalizeSidePanelCue).filter(Boolean).slice(0, 5000);
    return {
        videoId: String(message && message.videoId || "").slice(0, 200),
        videoTitle: String(message && message.videoTitle || "").slice(0, 300),
        pageUrl: String(message && message.pageUrl || "").slice(0, 2048),
        sourceLanguage: String(message && message.sourceLanguage || "en").slice(0, 40),
        targetLanguage: String(message && message.targetLanguage || "zh-CN").slice(0, 40),
        cues,
        updatedAt: Date.now()
    };
}

async function storeSidePanelTranscript(payload) {
    sidePanelTranscript = payload;
    try {
        if (chrome.storage && chrome.storage.session) {
            await chrome.storage.session.set({[SIDE_PANEL_STORAGE_KEY]: payload});
        }
    } catch (_) {
        // 会话存储不可用时仍保留内存副本，本次会话内可正常读取。
    }
    return payload;
}

async function readSidePanelTranscript() {
    if (sidePanelTranscript) return sidePanelTranscript;
    try {
        if (chrome.storage && chrome.storage.session) {
            const values = await chrome.storage.session.get(SIDE_PANEL_STORAGE_KEY);
            if (values && values[SIDE_PANEL_STORAGE_KEY]) {
                sidePanelTranscript = values[SIDE_PANEL_STORAGE_KEY];
                return sidePanelTranscript;
            }
        }
    } catch (_) { /* 会话存储不可用，返回空 */ }
    return null;
}

// 记住侧边栏属于哪个视频标签页，供点击字幕跳转时回传消息。
async function rememberSidePanelTab(sender) {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!Number.isFinite(tabId)) return;
    sidePanelSourceTabId = tabId;
    try {
        if (chrome.storage && chrome.storage.session) {
            await chrome.storage.session.set({[SIDE_PANEL_TAB_KEY]: tabId});
        }
    } catch (_) { /* 会话存储不可用，内存副本仍有效 */ }
}

async function readSidePanelTab() {
    if (Number.isFinite(sidePanelSourceTabId) && sidePanelSourceTabId) return sidePanelSourceTabId;
    try {
        if (chrome.storage && chrome.storage.session) {
            const values = await chrome.storage.session.get(SIDE_PANEL_TAB_KEY);
            if (values && Number.isFinite(values[SIDE_PANEL_TAB_KEY])) {
                sidePanelSourceTabId = values[SIDE_PANEL_TAB_KEY];
                return sidePanelSourceTabId;
            }
        }
    } catch (_) { /* 忽略 */ }
    return 0;
}

async function handleSidePanelStore(message, sender) {
    await rememberSidePanelTab(sender);
    return {type: "SIDE_PANEL_STORE_RESULT", ok: true,
        transcript: await storeSidePanelTranscript(normalizeSidePanelPayload(message))};
}

async function handleSidePanelGet() {
    return {type: "SIDE_PANEL_GET_RESULT", ok: true, transcript: await readSidePanelTranscript()};
}

async function handleOpenSidePanel(message, sender) {
    const transcript = await storeSidePanelTranscript(normalizeSidePanelPayload(message));
    await rememberSidePanelTab(sender);
    const tabId = sender && sender.tab && sender.tab.id;
    if (chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
        try {
            await chrome.sidePanel.open(tabId ? {tabId} : {});
            return {type: "OPEN_SIDE_PANEL_RESULT", ok: true, opened: true, transcript};
        } catch (error) {
            // 侧边栏 API 调用失败（例如无用户手势）时降级为新标签页，功能仍可用。
        }
    }
    const url = chrome.runtime.getURL("sidepanel/sidepanel.html");
    await new Promise((resolve, reject) => {
        chrome.tabs.create({url}, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve();
        });
    });
    return {type: "OPEN_SIDE_PANEL_RESULT", ok: true, opened: false, transcript};
}

// 侧边栏点击字幕行请求跳转：转发到来源视频标签页的 content script。
async function handleSidePanelSeek(message, sender) {
    let tabId = await readSidePanelTab();
    // 若内存/会话里没有（如 service worker 刚重启且未再推字幕），
    // 尝试用消息发送方的 tabId 兜底。
    if (!tabId && sender && sender.tab && Number.isFinite(sender.tab.id)) {
        tabId = sender.tab.id;
    }
    const startMs = Number(message && message.startMs);
    if (!Number.isFinite(startMs) || startMs < 0) {
        return {ok: false, error: "无效的时间点"};
    }
    if (!tabId) {
        return {ok: false, error: "找不到视频页面，请重新打开全部字幕"};
    }
    try {
        await chrome.tabs.sendMessage(tabId, {type: "SIDE_PANEL_SEEK_VIDEO", startMs});
        return {ok: true};
    } catch (error) {
        return {ok: false, error: (error && error.message) || "跳转失败，请重新打开全部字幕"};
    }
}
