// Player tools share the content-script scope, but React owns their markup.
// The controller keeps the player/caption state and pushes snapshots into the
// mounted PlayerTools component.
var playerControls = null;
var playerControlsTimer = null;

function startPlayerControls() {
    if (IS_DRIVE_PLAYER || playerControlsTimer) return;
    bindSidePanelSeekMessages();
    updatePlayerControls();
    playerControlsTimer = setInterval(updatePlayerControls, 250);
    document.addEventListener("pointerdown", (event) => {
        if (playerControls && !event.target.closest(".ytbt-player-ui, .ytbt-player-button")) closePlayerMenu();
    });
    document.addEventListener("fullscreenchange", () => {
        if (playerControls) playerControls.panel.style.removeProperty("left");
        if (playerControls) playerControls.panel.style.removeProperty("top");
        updatePlayerControls();
    });
}

// 全部字幕侧边栏点击某行时，background 会把时间点转发到这里。
// 跳转到对应字幕并继续播放；content script 作用域内只注册一次。
var sidePanelSeekBound = false;
function bindSidePanelSeekMessages() {
    if (sidePanelSeekBound) return;
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) return;
    sidePanelSeekBound = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== "SIDE_PANEL_SEEK_VIDEO") return;
        const startMs = Number(message.startMs);
        const video = state.video || document.querySelector("video");
        if (!Number.isFinite(startMs) || startMs < 0 || !video) {
            sendResponse({ok: false});
            return;
        }
        try {
            // 末尾留 20ms 余量，避免落在上一句尾部。
            video.currentTime = Math.max(0, startMs - 20) / 1000;
            handleSeek();
            const playResult = video.play && video.play();
            if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
            sendResponse({ok: true});
        } catch (error) {
            sendResponse({ok: false, error: (error && error.message) || String(error)});
        }
    });
}

function createPlayerControls() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ytp-button ytbt-player-button";
    button.title = "AuraTranslate";
    button.setAttribute("aria-label", "AuraTranslate");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "ytbt-player-menu");

    const root = document.createElement("div");
    root.className = "ytbt-player-ui";
    root.setAttribute("translate", "no");

    playerControls = {
        button, root, menu: null, panel: null,
        data: null, view: "transcript", rows: [], query: "", limit: 200,
        activeCue: null, follow: true, menuOpen: false, styleView: false, panelOpen: false,
        error: "", react: null, dragBound: false,
        wordfreq: {rows: [], count: 0, loading: false, empty: "暂无字幕", expanded: "", definitions: {}, loadingWord: "", saved: new Set(), limit: 100, computed: false, cues: [], examplesAll: false},
        phrase: {rows: [], count: 0, loading: false, empty: "暂无字幕", expanded: "", computed: false, cues: [], examplesAll: false, disabled: false}
    };
    if (globalThis.AuraContentUI) {
        globalThis.AuraContentUI.mountPlayerButton(button, {iconUrl: chrome.runtime.getURL("icons/icon-32.png")});
        playerControls.react = globalThis.AuraContentUI.mountPlayerTools(root, buildPlayerToolsProps(playerControls));
    } else {
        const logo = document.createElement("img");
        logo.src = chrome.runtime.getURL("icons/icon-32.png");
        logo.alt = "";
        logo.draggable = false;
        button.appendChild(logo);
    }
    playerControls.menu = root.querySelector(".ytbt-player-menu");
    playerControls.panel = root.querySelector(".ytbt-tools-panel");

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = !playerControls.menuOpen;
        playerControls.menuOpen = open;
        playerControls.styleView = false;
        button.setAttribute("aria-expanded", String(open));
        if (open) {
            playerControls.panelOpen = false;
            positionPlayerTools();
        }
        renderPlayerTools();
        if (open) {
            root.querySelector("[data-setting]")?.focus();
        }
    });
    button.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") closePlayerMenu();
    });
    for (const type of ["click", "dblclick", "pointerdown", "pointerup", "keyup"]) root.addEventListener(type, (event) => event.stopPropagation());
    root.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            if (playerControls.styleView && playerControls.menuOpen) showPlayerStyle(false);
            else {
                closePlayerMenu();
                closePlayerPanel();
                button.focus();
            }
        }
    });
    bindPlayerPanelDrag();
    syncPlayerControlsSettings();
    return playerControls;
}

function buildPlayerToolsProps(ui) {
    const config = Core.resolveTranslationConfig(state.settings);
    const data = ui.data;
    return {
        menuOpen: ui.menuOpen,
        styleView: ui.styleView,
        panelOpen: ui.panelOpen,
        view: ui.view,
        error: ui.error,
        settings: {
            subtitleEnabled: state.settings.subtitleEnabled,
            subtitleDisplayMode: state.settings.subtitleDisplayMode,
            fontScale: state.settings.fontScale,
            subtitleBackgroundOpacity: state.settings.subtitleBackgroundOpacity,
            subtitleColor: state.settings.subtitleColor,
            wordFreqEnabled: state.settings.wordFreqEnabled !== false,
            pipEnabled: state.settings.pipEnabled !== false,
            pipOpen: typeof ytbtPipIsOpen === "function" && ytbtPipIsOpen()
        },
        transcript: {
            rows: ui.rows,
            count: ui.matchCount || 0,
            hasMore: (ui.matchCount || 0) > ui.limit,
            hasCues: playerToolCues().length > 0,
            loading: Boolean(data && data.loading),
            empty: data && data.loading
                ? "正在读取字幕..."
                : (data && data.error) || (ui.query ? "没有匹配的字幕" : "暂无字幕"),
            query: ui.query,
            follow: ui.follow
        },
        wordfreq: {
            rows: buildWordFreqRows(ui),
            count: ui.wordfreq.count,
            loading: ui.wordfreq.loading,
            loadingWord: ui.wordfreq.loadingWord,
            empty: ui.wordfreq.loading ? "正在统计字幕词频..." : (data && data.error) || "暂无字幕",
            expanded: ui.wordfreq.expanded,
            definitions: ui.wordfreq.definitions,
            examplesAll: ui.wordfreq.examplesAll,
            disabled: state.settings.wordFreqEnabled === false
        },
        phrase: {
            rows: buildPhraseRows(ui),
            count: ui.phrase.count,
            loading: ui.phrase.loading,
            empty: ui.phrase.loading ? "正在扫描字幕短语..." : (data && data.error) || "本视频未发现词库中的短语",
            expanded: ui.phrase.expanded,
            examplesAll: ui.phrase.examplesAll,
            disabled: state.settings.phraseEnabled === false
        },
        onAction: (action, arg) => handlePlayerControlAction(action, arg).catch(showPlayerControlError),
        onSetting: applyPlayerSetting,
        onSearch: updatePlayerSearch,
        onFollow: updatePlayerFollow,
        onSeek: seekPlayerCue
    };
}

function renderPlayerTools() {
    const ui = playerControls;
    if (!ui || !ui.react) return;
    ui.react.update(buildPlayerToolsProps(ui));
}

function applyPlayerSetting(key, value) {
    state.settings[key] = value;
    state.settings = normalizeSettings(state.settings);
    applySettings();
    savePlayerSettings({[key]: value}).catch(showPlayerControlError);
}

function updatePlayerSearch(value) {
    const ui = playerControls;
    if (!ui) return;
    ui.query = String(value || "").trim().toLocaleLowerCase();
    ui.limit = 200;
    renderPlayerTranscript();
}

function updatePlayerFollow(checked) {
    const ui = playerControls;
    if (!ui || ui.follow === Boolean(checked)) return;
    ui.follow = Boolean(checked);
    if (!ui.follow) ui.activeCue = null;
    renderPlayerTools();
}

function seekPlayerCue(cue) {
    // 在字幕行里划线取词时，mouseup 之后仍会触发行的 click。
    // 此时跳过跳转，避免选区和取词工具栏被立即清掉。
    const selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed) {
        const node = selection.anchorNode || selection.focusNode;
        const element = node && (node.nodeType === 1 ? node : node.parentElement);
        if (element && element.closest && element.closest(".ytbt-cue-row")) return;
    }
    const video = state.video || document.querySelector("video");
    if (!video) return;
    video.currentTime = cue.startMs / 1000;
    handleSeek();
}

function readPlayerSetting(input) {
    return input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
}

async function savePlayerSettings(values) {
    try {
        await storageSet(values);
        state.settings = normalizeSettings(Object.assign({}, state.settings, values));
        applySettings();
        if (values.subtitleEnabled) requestPlayerResponse();
        showPlayerControlError(null);
    } catch (error) {
        await loadSettings();
        applySettings();
        throw error;
    }
}

function syncPlayerControlsSettings() {
    if (!playerControls) return;
    playerControls.button.dataset.enabled = String(state.settings.subtitleEnabled);
    renderPlayerTools();
}

function closePlayerMenu() {
    if (!playerControls || !playerControls.menuOpen) return;
    playerControls.menuOpen = false;
    playerControls.button.setAttribute("aria-expanded", "false");
    renderPlayerTools();
}

function closePlayerPanel() {
    if (!playerControls || !playerControls.panelOpen) return;
    playerControls.panelOpen = false;
    renderPlayerTools();
}

function showPlayerStyle(show) {
    if (!playerControls) return;
    playerControls.styleView = Boolean(show);
    renderPlayerTools();
    if (show) playerControls.root.querySelector("[data-action='back']")?.focus();
}

function showPlayerControlError(error) {
    if (!playerControls) return;
    playerControls.error = error ? (error.message || String(error)) : "";
    renderPlayerTools();
}

async function handlePlayerControlAction(action, arg) {
    const ui = playerControls;
    if (!ui) return;
    if (action === "style") showPlayerStyle(true);
    else if (action === "back") showPlayerStyle(false);
    else if (action === "close-menu") {
        closePlayerMenu();
        ui.button.focus();
    } else if (action === "close-panel") {
        closePlayerPanel();
        ui.button.focus();
    } else if (action === "reset-style") await savePlayerSettings({fontScale: 1, subtitleColor: "#ffffff", subtitleBackgroundOpacity: 0.88, subtitleDisplayMode: "bilingual"});
    else if (action === "reset-position") await savePlayerSettings({subtitlePosition: null});
    else if (action === "transcript") {
        closePlayerMenu();
        ui.panelOpen = true;
        ui.view = action;
        renderPlayerTools();
        positionPlayerTools();
        ui.root.querySelector(".ytbt-transcript-search")?.focus();
        await loadPlayerToolCues();
    } else if (action === "wordfreq") {
        if (state.settings.wordFreqEnabled === false) return;
        closePlayerMenu();
        ui.panelOpen = true;
        ui.view = "wordfreq";
        renderPlayerTools();
        positionPlayerTools();
        await loadPlayerToolCues();
        await computeWordFreq(false);
    } else if (action === "phrase") {
        if (state.settings.phraseEnabled === false) return;
        closePlayerMenu();
        ui.panelOpen = true;
        ui.view = "phrase";
        renderPlayerTools();
        positionPlayerTools();
        await loadPlayerToolCues();
        await computePhrase(false);
    } else if (action === "ph-reload") {
        await loadPlayerToolCues();
        await computePhrase(true);
    } else if (action === "ph-expand") {
        ui.phrase.expanded = arg || "";
        renderPlayerTools();
    } else if (action === "ph-collapse") {
        ui.phrase.expanded = "";
        renderPlayerTools();
    } else if (action === "ph-examples-all") {
        ui.phrase.examplesAll = !ui.phrase.examplesAll;
        renderPlayerTools();
    } else if (action === "ph-example-seek") {
        if (arg && arg.cue) seekPlayerCue(arg.cue);
    } else if (action === "ph-speak") {
        if (arg) speakWordFreqWord(arg);
    } else if (action === "wf-reload") {
        await loadPlayerToolCues();
        await computeWordFreq(true);
    } else if (action === "wf-expand") {
        ui.wordfreq.expanded = arg || "";
        renderPlayerTools();
        if (arg && !ui.wordfreq.definitions[arg]) lookupWordFreqDefinition(arg);
    } else if (action === "wf-collapse") {
        ui.wordfreq.expanded = "";
        renderPlayerTools();
    } else if (action === "wf-def") {
        if (arg) await lookupWordFreqDefinition(arg);
    } else if (action === "wf-speak") {
        if (arg) speakWordFreqWord(arg);
    } else if (action === "wf-save") {
        if (arg) await saveWordFreqWord(arg);
    } else if (action === "wf-examples-all") {
        ui.wordfreq.examplesAll = !ui.wordfreq.examplesAll;
        renderPlayerTools();
    } else if (action === "wf-example-seek") {
        // 例句跳转：复用字幕列表的 seek 逻辑，但不切换视图、不关闭面板。
        if (arg && arg.cue) seekPlayerCue(arg.cue);
    } else if (action === "more") {
        ui.limit += 200;
        renderPlayerTranscript();
    } else if (action === "full-view") {
        // 独立的全部字幕侧边栏：先把当前字幕推给后台，再打开侧边栏。
        // 不建覆盖层、不暂停视频，播放完全不受影响。
        closePlayerMenu();
        await openFullTranscript();
    } else if (action === "load-captions") {
        await loadPlayerToolCues();
    } else if (action === "pip-toggle") {
        if (state.settings.pipEnabled === false) return;
        if (typeof ytbtPipToggle !== "function") {
            showPlayerControlError("画中画模块未加载。");
            return;
        }
        try {
            await ytbtPipToggle({
                showHeader: state.settings.pipShowHeader !== false,
                fontScale: state.settings.pipFontScale,
                opacity: state.settings.pipOpacity,
                onClose: () => { if (playerControls) renderPlayerTools(); }
            });
            renderPlayerTools();
        } catch (error) {
            showPlayerControlError(error);
        }
        closePlayerMenu();
    }
}

function updatePlayerControls() {
    const player = findVideoPlayer();
    if (!player) {
        if (playerControls) {
            closePlayerPanel();
            closePlayerMenu();
            playerControls.root.remove();
            playerControls.button.remove();
        }
        return;
    }
    const controls = player.querySelector(".ytp-right-controls");
    if (!controls) {
        if (playerControls && !playerControls.button.isConnected) {
            closePlayerPanel();
            closePlayerMenu();
            playerControls.root.remove();
            playerControls.button.remove();
        }
        return;
    }
    const ui = playerControls || createPlayerControls();
    if (ui.button.parentElement !== controls) controls.insertBefore(ui.button, controls.firstChild);
    const host = document.fullscreenElement || document.body;
    if (host && ui.root.parentElement !== host) {
        host.appendChild(ui.root);
        ui.panel.style.removeProperty("left");
        ui.panel.style.removeProperty("top");
    }
    syncPlayerToolsTheme();
    positionPlayerTools();
    const videoId = getUrlVideoId() || state.videoId;
    const config = Core.resolveTranslationConfig(state.settings);
    const key = JSON.stringify([videoId, state.settings.sourceLanguage, state.settings.targetLanguage,
        config.provider, config.model, config.baseUrl, state.settings.cacheVersion]);
    if (!ui.data || ui.data.key !== key) {
        ui.data = {key, videoId, rawCues: [], loading: null, error: ""};
        ui.activeCue = null;
        ui.query = "";
        ui.limit = 200;
        if (ui.wordfreq) {
            ui.wordfreq.computed = false;
            ui.wordfreq.words = [];
            ui.wordfreq.count = 0;
            ui.wordfreq.expanded = "";
            ui.wordfreq.definitions = {};
            ui.wordfreq.saved = new Set();
        }
        if (ui.phrase) {
            ui.phrase.computed = false;
            ui.phrase.phrases = [];
            ui.phrase.count = 0;
            ui.phrase.expanded = "";
        }
        if (ui.panelOpen) loadPlayerToolCues();
        if (ui.panelOpen && ui.view === "wordfreq") computeWordFreq(false);
        if (ui.panelOpen && ui.view === "phrase") computePhrase(false);
    }
    if (ui.panelOpen) {
        clampPlayerPanel();
        if (ui.view === "transcript") renderPlayerTranscript();
        else if (ui.view === "wordfreq" && ui.wordfreq.computed && !ui.wordfreq.words.length) computeWordFreq(false);
        else if (ui.view === "phrase" && ui.phrase.computed && !ui.phrase.phrases.length) computePhrase(false);
    }
}

function playerToolCues() {
    const data = playerControls && playerControls.data;
    return data && data.videoId === state.videoId && state.cues.length ? state.cues : data ? data.rawCues : [];
}

async function loadPlayerToolCues() {
    const ui = playerControls;
    if (!ui) return;
    const data = ui.data;
    if (!data || playerToolCues().length) return;
    if (data.loading) return data.loading;
    data.error = "";
    data.loading = (async () => {
        try {
            if (state.captionLoadPromise && state.videoId === data.videoId) await state.captionLoadPromise;
            if (ui.data !== data || playerToolCues().length) return;
            let response = state.lastPlayerResponse;
            if (!response || response.videoId !== data.videoId) {
                requestPlayerResponse();
                for (let attempt = 0; attempt < 15; attempt++) {
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    if (ui.data !== data) return;
                    response = state.lastPlayerResponse;
                    if (response && response.videoId === data.videoId) break;
                }
            }
            if (!response || response.videoId !== data.videoId) throw new Error("尚未读取到视频信息，请稍后重新读取。");
            const track = selectSourceTrack(response.captionTracks || []);
            if (!track && !hasTranscriptApi(response.transcript)) throw new Error("当前视频没有可用的源语言字幕。");
            // Reading the list must not enable subtitle translation or segmentation.
            const cues = await fetchCaptionData(track, data.videoId, response.transcript);
            if (ui.data !== data) return;
            data.rawCues = cues;
            if (!cues.length) throw new Error("当前视频没有可用字幕。");
        } catch (error) {
            if (ui.data === data) data.error = formatCaptionLoadError(error);
        } finally {
            data.loading = null;
            if (ui.data === data) {
                renderPlayerTranscript();
            }
        }
    })();
    return data.loading;
}

function playerTimestamp(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(seconds / 3600);
    return `${hours ? `${hours}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderPlayerTranscript() {
    const ui = playerControls;
    if (!ui || !ui.data) return;
    const cues = Core.getCaptionDisplayCues(playerToolCues());
    const current = Core.findCueAtTime(cues, getCurrentTimeMs());
    if (ui.follow && !ui.query && current && cues.indexOf(current) >= ui.limit) {
        ui.limit = cues.indexOf(current) + 100;
    }
    const matches = cues.filter((cue) => !ui.query || `${cue.sourceText} ${cue.displaySourceText || ""} ${cue.translatedText || ""}`.toLocaleLowerCase().includes(ui.query));
    const followMoved = ui.follow && current && current !== ui.activeCue;
    ui.rows = matches.slice(0, ui.limit).map((cue) => ({
        cue,
        start: playerTimestamp(cue.startMs),
        original: cue.displaySourceText || cue.sourceText || "",
        translation: cue.translatedText || "",
        current: cue === current
    }));
    ui.matchCount = matches.length;
    ui.activeCue = current;
    renderPlayerTools();
    if (followMoved && ui.panelOpen && ui.view === "transcript") {
        const list = ui.root.querySelector(".ytbt-cue-list");
        const row = list && list.querySelector('.ytbt-cue-row[aria-current="true"]');
        if (list && row) list.scrollTop = Math.max(0, row.offsetTop - list.offsetTop - list.clientHeight / 3);
    }
}

// --- 全部字幕侧边栏 ---
// 独立 Document，字幕带时间码、可划词翻译/朗读/收藏。视频页面不覆盖、不暂停，
// 播放进度完全不受影响。这里只负责把当前字幕推给后台，再请求打开侧边栏。
function buildSidePanelPayload() {
    const ui = playerControls;
    if (!ui) return null;
    const cues = Core.getCaptionDisplayCues(playerToolCues()).map((cue) => ({
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        sourceText: cue.sourceText || "",
        displaySourceText: cue.displaySourceText || "",
        translatedText: cue.translatedText || "",
        status: cue.status || ""
    }));
    const config = Core.resolveTranslationConfig(state.settings);
    return {
        type: "OPEN_SIDE_PANEL",
        videoId: getUrlVideoId() || state.videoId || "",
        videoTitle: document.title || "",
        pageUrl: location.href,
        sourceLanguage: state.settings.sourceLanguage || (config && config.sourceLanguage) || "en",
        targetLanguage: state.settings.targetLanguage || "zh-CN",
        cues
    };
}

async function openFullTranscript() {
    const ui = playerControls;
    if (!ui) return;
    // 先确保字幕已读取，再推送完整内容。
    await loadPlayerToolCues();
    const payload = buildSidePanelPayload();
    if (!payload) return;
    if (!payload.cues.length) {
        showPlayerControlError("字幕还未加载完成，请稍后重试。");
        return;
    }
    try {
        const response = await Core.sendRuntimeMessage(chrome.runtime, payload, 10000);
        if (!response || response.ok === false) {
            showPlayerControlError((response && response.error) || "打开侧边栏失败，请重试。");
        }
    } catch (error) {
        showPlayerControlError(error);
    }
}

function closeFullTranscript() {
    // 侧边栏在独立 Document 中自行关闭，视频页面无需状态。
}

function renderFullTranscript() {
    // 兼容旧调用：侧边栏内容变化时由 sidepanel.js 主动读取，这里不再渲染覆盖层。
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWordFreqExamples(occurrences, cues, forms) {
    const highlight = Array.from(new Set((forms || []).concat(
        (occurrences || []).reduce((acc, item) => acc.concat(item.forms || []), [])
    ))).filter(Boolean).sort((a, b) => b.length - a.length);
    return (occurrences || []).map((item) => {
        const cue = cues[item.cueIndex];
        if (!cue) return null;
        const text = cue.displaySourceText || cue.sourceText || "";
        let parts;
        if (highlight.length) {
            const re = new RegExp(`\\b(${highlight.map(escapeRegExp).join("|")})\\b`, "gi");
            parts = [];
            let last = 0;
            let match;
            while ((match = re.exec(text)) !== null) {
                if (match.index > last) parts.push({hit: false, text: text.slice(last, match.index)});
                parts.push({hit: true, text: match[0]});
                last = match.index + match[0].length;
            }
            if (last < text.length) parts.push({hit: false, text: text.slice(last)});
        } else {
            parts = [{hit: false, text}];
        }
        return {
            cue,
            cueIndex: item.cueIndex,
            start: playerTimestamp(cue.startMs),
            parts
        };
    }).filter(Boolean);
}

function buildWordFreqRows() {
    const wf = playerControls && playerControls.wordfreq;
    if (!wf || !wf.words) return [];
    return wf.words.map((entry) => ({
        ...entry,
        saved: wf.saved.has(entry.word),
        examples: buildWordFreqExamples(entry.occurrences, wf.cues || [], entry.forms)
    }));
}

function buildPhraseRows() {
    const ph = playerControls && playerControls.phrase;
    if (!ph || !ph.phrases) return [];
    return ph.phrases.map((entry) => ({
        ...entry,
        examples: buildWordFreqExamples(entry.occurrences, ph.cues || [], entry.forms)
    }));
}

// Read custom entries saved by the options "My phrase library" page. Built-in
// entries always remain; custom ones are merged by the shared engine.
function readCustomPhrases(callback) {
    try {
        const key = Core.PHRASE_CUSTOM_STORAGE_KEY;
        if (!key || !chrome || !chrome.storage || !chrome.storage.local) return callback([]);
        chrome.storage.local.get([key], (result) => callback((result && result[key]) || []));
    } catch (error) {
        callback([]);
    }
}

function computePhrase(force) {
    const ui = playerControls;
    if (!ui) return Promise.resolve();
    const ph = ui.phrase;
    if (!force && ph.computed) return Promise.resolve();
    const cues = Core.getCaptionDisplayCues(playerToolCues());
    if (!cues.length) {
        ph.phrases = [];
        ph.cues = [];
        ph.count = 0;
        ph.computed = false;
        renderPlayerTools();
        return Promise.resolve();
    }
    ph.loading = true;
    ph.computed = true;
    renderPlayerTools();
    return new Promise((resolve) => {
        readCustomPhrases((custom) => {
            try {
                const analysis = Core.phraseLibraryAnalyze
                    ? Core.phraseLibraryAnalyze(cues, {entries: custom, limit: 200})
                    : {phrases: []};
                ph.cues = cues;
                ph.phrases = analysis.phrases;
                ph.count = analysis.total;
            } catch (error) {
                ph.phrases = [];
                ph.count = 0;
                ph.error = error && error.message ? error.message : String(error);
            }
            ph.loading = false;
            renderPlayerTools();
            resolve();
        });
    });
}

function computeWordFreq(force) {
    const ui = playerControls;
    if (!ui) return Promise.resolve();
    const wf = ui.wordfreq;
    if (!force && wf.computed) return Promise.resolve();
    const cues = Core.getCaptionDisplayCues(playerToolCues());
    if (!cues.length) {
        wf.words = [];
        wf.cues = [];
        wf.count = 0;
        wf.computed = false;
        renderPlayerTools();
        return Promise.resolve();
    }
    wf.loading = true;
    wf.computed = true;
    renderPlayerTools();
    const limit = Math.max(20, Math.min(500, Number(state.settings.wordFreqLimit) || 100));
    const includeStop = Boolean(state.settings.wordFreqIncludeStopWords);
    return Promise.resolve().then(() => {
        const analysis = Core.wordFreqAnalyze
            ? Core.wordFreqAnalyze(cues, {includeStopWords: includeStop, minLength: 3})
            : {words: []};
        wf.cues = cues;
        wf.words = analysis.words.slice(0, limit);
        wf.count = analysis.words.length;
    }).catch((error) => {
        wf.words = [];
        wf.count = 0;
        wf.error = error && error.message ? error.message : String(error);
    }).then(() => {
        wf.loading = false;
        renderPlayerTools();
    });
}

async function lookupWordFreqDefinition(word) {
    const ui = playerControls;
    if (!ui) return;
    const wf = ui.wordfreq;
    if (wf.definitions[word]) return;
    wf.loadingWord = word;
    renderPlayerTools();
    try {
        const response = await Core.sendRuntimeMessage(chrome.runtime, {
            type: "BATCH_LOOKUP_WORD", words: [word]
        }, 12000);
        const results = response && response.results;
        if (results && results[word]) wf.definitions[word] = results[word];
    } catch (error) {
        // 查词失败不打扰用户，词条下方会提示重试。
    } finally {
        wf.loadingWord = "";
        renderPlayerTools();
    }
}

function speakWordFreqWord(word) {
    if (typeof window === "undefined" || !window.speechSynthesis ||
        typeof window.SpeechSynthesisUtterance !== "function") return;
    try {
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(word);
        utterance.lang = "en-US";
        const rate = Number(state.settings.selectionSpeakRate);
        utterance.rate = rate > 0 ? rate : 1;
        const voices = window.speechSynthesis.getVoices() || [];
        const local = voices.find((v) => /^en\b/i.test(v.lang || "") && v.localService);
        const anyEn = voices.find((v) => /^en\b/i.test(v.lang || ""));
        if (local || anyEn) utterance.voice = local || anyEn;
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        // 语音不可用时静默跳过。
    }
}

async function saveWordFreqWord(word) {
    const ui = playerControls;
    if (!ui || ui.wordfreq.saved.has(word)) return;
    const entry = ui.wordfreq.words.find((item) => item.word === word);
    const definition = ui.wordfreq.definitions[word];
    const translatedText = definition && definition.entries
        ? definition.entries.map((item) => item.variants.join("，")).join("；")
        : word;
    const settings = state.settings || {};
    try {
        await Core.sendRuntimeMessage(chrome.runtime, {
            type: "VOCABULARY",
            action: "add",
            entry: {
                sourceText: word,
                translatedText,
                sourceLanguage: settings.sourceLanguage || "en",
                targetLanguage: settings.targetLanguage || "zh-CN",
                contextText: (entry && entry.forms && entry.forms.join(" / ")) || "",
                sourceUrl: location.href,
                sourceTitle: document.title
            }
        }, 8000);
        ui.wordfreq.saved.add(word);
        renderPlayerTools();
    } catch (error) {
        showPlayerControlError(error);
    }
}

function clampPlayerPanel() {
    const panel = playerControls && playerControls.panel;
    if (!panel || !panel.style.left) return;
    panel.style.left = `${Math.max(8, Math.min(parseFloat(panel.style.left), window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(parseFloat(panel.style.top), window.innerHeight - panel.offsetHeight - 8))}px`;
}

function syncPlayerToolsTheme() {
    const html = document.documentElement;
    const page = document.querySelector("ytd-app") || document.body;
    let dark = html.hasAttribute("dark");
    if (!dark) {
        let background;
        for (let element = page; element; element = element.parentElement) {
            const channels = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number);
            if (channels && channels.length >= 3 && (channels.length < 4 || channels[3] >= 0.5)) { background = channels; break; }
        }
        dark = background ? background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722 < 128
            : getComputedStyle(html).colorScheme === "dark" || window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    }
    if (playerControls) playerControls.root.dataset.theme = dark ? "dark" : "light";
}

function positionPlayerTools() {
    const ui = playerControls;
    const player = findVideoPlayer();
    if (!ui || !player || !ui.menu || !ui.panel) return;
    const rect = player.getBoundingClientRect();
    const control = ui.button.getBoundingClientRect();
    ui.menu.style.right = `${Math.max(8, window.innerWidth - Math.min(rect.right - 8, control.right + 16))}px`;
    ui.menu.style.bottom = `${Math.max(8, window.innerHeight - control.top + 8)}px`;
    ui.menu.style.maxHeight = `${Math.max(80, control.top - 16)}px`;
    const fullscreen = Boolean(document.fullscreenElement);
    ui.root.dataset.fullscreen = String(fullscreen);
    if (!ui.panel.style.left) {
        ui.panel.style.top = `${fullscreen ? 12 : Math.max(12, Math.min(rect.top, 80))}px`;
        ui.panel.style.height = `${Math.max(160, window.innerHeight - parseFloat(ui.panel.style.top) - 16)}px`;
    }
}

function bindPlayerPanelDrag() {
    const ui = playerControls;
    const panel = ui && ui.panel;
    const handle = panel && panel.querySelector(".ytbt-panel-handle");
    if (!handle || ui.dragBound) return;
    ui.dragBound = true;
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button") || window.innerWidth < 760) return;
        const rect = panel.getBoundingClientRect();
        drag = {x: event.clientX - rect.left, y: event.clientY - rect.top};
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
        if (!drag) return;
        panel.style.left = `${event.clientX - drag.x}px`;
        panel.style.top = `${event.clientY - drag.y}px`;
        clampPlayerPanel();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, () => { drag = null; });
}
