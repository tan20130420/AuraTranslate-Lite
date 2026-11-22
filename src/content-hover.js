/*
 * AuraTranslate content script — hover interactions
 *
 * 三个悬停行为：
 *   1. 鼠标停在字幕上 → 暂停播放（移开后恢复，仅恢复自己暂停的那次）
 *   2. 鼠标停在悬浮字幕列表某一行上 → 暂停播放（移开后恢复）
 *   3. 鼠标停在右侧推荐视频列表上 → 暂停播放
 *   4. 鼠标停在字幕/字幕列表/画中画里的英文单词上 → 显示音标与中文释义，并自动英文朗读
 *
 * 取词相关状态按「上下文」隔离：主页面一个，画中画窗口一个。
 * 暂停/恢复状态全局共享，因为两个窗口操作的是同一个视频。
 *
 * 加载顺序见 content-main.js 顶部注释；本文件依赖 content-core 的 state、
 * content-player 的 getCurrentTimeMs，因此排在 content-overlay 之后。
 * 顶层一律用 var/function 声明，避免重复注入时报重复声明。
 */
"use strict";

var HOVER_WORD_DELAY_MS = 260;
var HOVER_RESUME_DELAY_MS = 180;
// 从字幕移向浮层的途中会短暂路过空白，给一段宽限再收浮层
var HOVER_TIP_GRACE_MS = 280;
var HOVER_LINE_SELECTOR = ".ytbt-lines";
var HOVER_TRANSCRIPT_SELECTOR = ".ytbt-cue-row";
// 字幕列表里的原文也能用同样的单词浮层取词；译文多为中文，不参与英文查词。
var HOVER_WORD_SELECTOR = ".ytbt-en, .ytbt-cue-source";
// 画中画字幕用的是另一套类名，另开一个上下文，不污染主页面选择器。
var HOVER_PIP_WORD_SELECTOR = ".ytbt-en, .ytbt-cue-source, .ytbt-pip-en";
var HOVER_PIP_LINE_SELECTOR = ".ytbt-lines, .ytbt-pip-lines";
// 右侧推荐列表：桌面版是 #secondary，Shorts 与部分新版布局用自定义元素。
var HOVER_RELATED_SELECTOR = "#secondary, ytd-watch-next-secondary-results-renderer, #related";

// --- 共享的暂停记账（主页面与画中画控制的是同一个视频） ---
var hoverZones = new Set();
var hoverZoneFlags = {subtitle: false, transcript: false, related: false, tooltip: false};
var hoverPauseOwned = false;
var hoverResumeTimer = 0;

// --- 按上下文隔离的取词状态 ---
var hoverMain = null;
var hoverPip = null;
var hoverWordCache = new Map();
var hoverTipBusy = false;

function hoverCreateContext(doc, win, isPip) {
    return {
        doc: doc,
        win: win,
        isPip: Boolean(isPip),
        tip: null,
        tipWord: "",
        wordTimer: 0,
        hideTimer: 0,
        pendingWord: "",
        activeZone: "",
        lastMoveAt: 0,
        moveTimer: 0,
        lastMoveEvent: null,
        bound: [],
        disposed: false,
        wordSelector: isPip ? HOVER_PIP_WORD_SELECTOR : HOVER_WORD_SELECTOR,
        lineSelector: isPip ? HOVER_PIP_LINE_SELECTOR : HOVER_LINE_SELECTOR,
        // 画中画是字幕列表视图，行本身就是 transcript 区，悬停同样暂停视频。
        transcriptSelector: HOVER_TRANSCRIPT_SELECTOR,
        relatedSelector: isPip ? "" : HOVER_RELATED_SELECTOR
    };
}

function hoverCtx(ctx) {
    return ctx || hoverMain;
}

function hoverVideo() {
    return state.video || document.querySelector("video");
}

// 划词进行中（左键按下或选区未清空）时不要再弹单词浮层，
// 否则浮层会挡住选区，或与划词译文卡片叠在一起。
function hoverSelectionBusy(ctx) {
    const c = hoverCtx(ctx);
    // 画中画的选区由本文件的划词模块（pipSel）负责：拖选期间用 pipSelDragging
    // 标志挡住取词，划词卡打开期间用 pipSelCard 挡住，关闭时主动清空选区。
    // 这里若按主页面规则检查残留选区，会在划词卡关闭前把悬停取词卡死。
    if (c.isPip) return false;
    const win = c.win || window;
    const selection = win.getSelection && win.getSelection();
    return Boolean(selection && !selection.isCollapsed);
}

function hoverPauseAllowed() {
    const settings = state.settings || {};
    return settings.hoverPauseEnabled !== false;
}

function hoverLookupAllowed() {
    const settings = state.settings || {};
    return settings.hoverLookupEnabled !== false;
}

// --- 悬停单词朗读（浏览器内置 Web Speech API，不上传文本） ---
// 朗读始终使用主窗口的 speechSynthesis；代码运行在主 content script 里，
// 即使词卡画在画中画窗口内也照常可用。

function hoverSpeakAllowed() {
    const settings = state.settings || {};
    return settings.hoverSpeakEnabled !== false;
}

function hoverSpeechEngine() {
    try { return window.speechSynthesis; } catch (_) { return null; }
}

function hoverSpeechAvailable() {
    try {
        const engine = hoverSpeechEngine();
        return Boolean(engine && typeof engine.speak === "function" &&
            typeof window.SpeechSynthesisUtterance === "function");
    } catch (_) { return false; }
}

function hoverSpeechRate() {
    const value = Number((state.settings || {}).selectionSpeakRate);
    return Number.isFinite(value) && value > 0 ? Math.min(1.2, Math.max(0.7, value)) : 1;
}

function hoverPickVoice() {
    let voices = [];
    try { voices = hoverSpeechEngine()?.getVoices?.() || []; } catch (_) { return null; }
    const normalized = (voice) => String(voice?.lang || "").toLowerCase().replace(/_/g, "-");
    const matches = voices.filter((voice) => normalized(voice).startsWith("en"));
    return matches.find((voice) => voice.localService) || matches[0] || null;
}

// 当前朗读的单词；同一个单词不重复朗读，只有换词才重新读。
var hoverSpeakingWord = "";
var hoverSpeechActive = false;

function hoverSpeechButton(ctx) {
    const c = hoverCtx(ctx);
    return c.tip && c.tip.querySelector ? c.tip.querySelector(".ytbt-wordtip-speak") : null;
}

function hoverStopSpeech(ctx) {
    if (!hoverSpeechActive && !hoverSpeakingWord) return;
    hoverSpeechActive = false;
    hoverSpeakingWord = "";
    try { hoverSpeechEngine()?.cancel?.(); } catch (_) { /* 不支持时忽略 */ }
    const button = hoverSpeechButton(ctx);
    if (button) {
        button.classList.remove("speaking");
        button.setAttribute("aria-label", "朗读单词");
    }
    hoverRelease("hoverSpeech");
}

function hoverSpeakWord(word, ctx) {
    if (!word || !hoverSpeakAllowed() || !hoverSpeechAvailable()) return false;
    if (hoverSpeakingWord === word && hoverSpeechActive) return false;
    hoverStopSpeech(ctx);
    const utterance = new window.SpeechSynthesisUtterance(word);
    const voice = hoverPickVoice();
    utterance.lang = voice?.lang || "en-US";
    if (voice) utterance.voice = voice;
    utterance.rate = hoverSpeechRate();
    hoverSpeakingWord = word;
    hoverSpeechActive = true;
    const finish = () => {
        if (!hoverSpeechActive) return;
        hoverSpeechActive = false;
        hoverSpeakingWord = "";
        const button = hoverSpeechButton(ctx);
        if (button) {
            button.classList.remove("speaking");
            button.setAttribute("aria-label", "朗读单词");
        }
        hoverRelease("hoverSpeech");
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    hoverSuspend("hoverSpeech");
    const button = hoverSpeechButton(ctx);
    if (button) {
        button.classList.add("speaking");
        button.setAttribute("aria-label", "停止朗读");
    }
    try {
        hoverSpeechEngine().speak(utterance);
    } catch (_) {
        finish();
        return false;
    }
    return true;
}

// --- 暂停 / 恢复 ---

function hoverSuspend(reason) {
    if (!hoverPauseAllowed()) return;
    hoverZones.add(reason);
    const video = hoverVideo();
    if (!video) return;
    // 从一个悬停区域切换到另一个时，要取消上一个区域排好的恢复
    if (hoverResumeTimer) {
        clearTimeout(hoverResumeTimer);
        hoverResumeTimer = 0;
    }
    if (video.paused) return;
    hoverPauseOwned = true;
    video.pause();
}

function hoverRelease(reason) {
    hoverZones.delete(reason);
    if (hoverZones.size || !hoverPauseOwned) return;
    clearTimeout(hoverResumeTimer);
    hoverResumeTimer = setTimeout(() => {
        hoverResumeTimer = 0;
        const video = hoverVideo();
        // 期间用户可能已经自己操作过，或被新的悬停接管。
        // 这种情况下不能清掉所有权，否则移开后永远不再恢复播放。
        if (!video || !video.paused || hoverZones.size) return;
        hoverPauseOwned = false;
        const started = video.play();
        if (started && typeof started.catch === "function") started.catch(() => {});
    }, HOVER_RESUME_DELAY_MS);
}

// 用户自己点了播放时，放弃“由我暂停”的记账，避免移开鼠标后又替他暂停。
function hoverBindPlayWatcher() {
    document.addEventListener("play", (event) => {
        const target = event.target;
        if (target && target.tagName === "VIDEO") hoverPauseOwned = false;
    }, true);
}

// --- 取词 ---

function hoverWordAtPoint(x, y, ctx) {
    const c = hoverCtx(ctx);
    const doc = c.doc;
    let range = null;
    try {
        if (typeof doc.caretRangeFromPoint === "function") {
            range = doc.caretRangeFromPoint(x, y);
        } else if (typeof doc.caretPositionFromPoint === "function") {
            const position = doc.caretPositionFromPoint(x, y);
            if (position && position.offsetNode) {
                range = doc.createRange();
                range.setStart(position.offsetNode, position.offset);
                range.collapse(true);
            }
        }
    } catch {
        return null;
    }
    if (!range) return null;

    const node = range.startContainer;
    if (!node || node.nodeType !== 3) return null;

    const parent = node.parentElement;
    const line = parent && parent.closest ? parent.closest(c.wordSelector) : null;
    if (!line) return null;

    const text = node.textContent || "";
    let offset = Math.min(range.startOffset, Math.max(0, text.length - 1));
    // 光标停在词与空格交界处时，优先取左边那个词
    if (!/[A-Za-z'-]/.test(text[offset] || "") && /[A-Za-z'-]/.test(text[offset - 1] || "")) {
        offset -= 1;
    }
    if (!/[A-Za-z]/.test(text[offset] || "")) return null;

    let start = offset;
    let end = offset + 1;
    while (start > 0 && /[A-Za-z'-]/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z'-]/.test(text[end])) end++;

    const raw = text.slice(start, end);
    const word = raw.replace(/^['-]+|['-]+$/g, "");
    if (word.length < 2 || !/^[A-Za-z][A-Za-z'-]*$/.test(word)) return null;

    const wordRange = doc.createRange();
    try {
        wordRange.setStart(node, start + (raw.length - raw.replace(/^['-]+/, "").length));
        wordRange.setEnd(node, start + raw.replace(/['-]+$/, "").length);
    } catch {
        return null;
    }
    return {word, range: wordRange};
}

function hoverHighlight(range, ctx) {
    const c = hoverCtx(ctx);
    // CSS Custom Highlight 按 document 注册；画中画有自己的 CSS 时用画中画的。
    const css = (c.win && c.win.CSS) || globalThis.CSS;
    const HighlightCtor = (c.win && c.win.Highlight) || globalThis.Highlight;
    if (!css || !css.highlights || typeof HighlightCtor !== "function") return;
    try {
        if (!range) {
            css.highlights.delete("ytbt-word");
            return;
        }
        css.highlights.set("ytbt-word", new HighlightCtor(range));
    } catch { /* 高亮只是装饰，失败不影响查词 */ }
}

// --- 释义浮层 ---

function hoverEnsureTip(ctx) {
    const c = hoverCtx(ctx);
    if (c.tip && c.tip.isConnected) return c.tip;
    const tip = c.doc.createElement("div");
    tip.className = "ytbt-wordtip";
    tip.hidden = true;
    tip.setAttribute("role", "tooltip");
    // 播放器会把点击解释成暂停/播放，浮层内部的操作要拦下来。
    // 必须在冒泡阶段拦截：捕获阶段就 stopPropagation 会让按钮自己的 click 收不到事件。
    for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) {
        tip.addEventListener(type, (event) => event.stopPropagation());
    }
    tip.addEventListener("mouseenter", () => hoverSuspend("tooltip"));
    tip.addEventListener("mouseleave", () => hoverRelease("tooltip"));
    c.doc.body.appendChild(tip);
    c.tip = tip;
    return tip;
}

function hoverTipText(result) {
    return (result.entries || [])
        .map((entry) => entry.variants.join("；"))
        .filter(Boolean)
        .join(" / ");
}

function hoverPositionTip(tip, range, ctx) {
    const c = hoverCtx(ctx);
    let wordRect = null;
    try {
        wordRect = range.getBoundingClientRect();
    } catch {
        wordRect = null;
    }

    // 以整块字幕为基准：浮层放在字幕块的上面（没位置时放下面），
    // 避免盖住正在读的那一句。
    let blockRect = null;
    const node = range && range.startContainer;
    const line = node && node.parentElement && node.parentElement.closest
        ? node.parentElement.closest(c.lineSelector) : null;
    if (line) {
        try {
            blockRect = line.getBoundingClientRect();
        } catch {
            blockRect = null;
        }
    }

    const margin = 8;
    const tipRect = tip.getBoundingClientRect();
    const width = tipRect.width || 220;
    const height = tipRect.height || 90;
    const anchor = wordRect && (wordRect.width || wordRect.height)
        ? wordRect
        : {top: 120, bottom: 140, left: 40, right: 120};
    const block = blockRect && blockRect.height ? blockRect : anchor;

    let top = block.top - height - margin;
    if (top < margin) top = block.bottom + margin;

    let left = anchor.left + (anchor.right - anchor.left) / 2 - width / 2;
    const viewWidth = (c.win && c.win.innerWidth) || window.innerWidth || 1200;
    const maxLeft = Math.max(margin, viewWidth - width - margin);
    left = Math.min(Math.max(left, margin), maxLeft);

    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
}

function hoverRenderTip(result, range, ctx) {
    const c = hoverCtx(ctx);
    const doc = c.doc;
    // 单词词卡与划词译文卡片互斥的拦截放在 hoverTrackWord 入口，
    // 这里不再反向关闭划词卡，否则异步查词回来会把刚弹出的译文卡挤掉。
    const tip = hoverEnsureTip(c);
    tip.textContent = "";

    const head = doc.createElement("div");
    head.className = "ytbt-wordtip-head";
    const title = doc.createElement("span");
    title.className = "ytbt-wordtip-word";
    title.textContent = result.word;
    head.appendChild(title);
    if (result.phonetic) {
        const phonetic = doc.createElement("span");
        phonetic.className = "ytbt-wordtip-phonetic";
        phonetic.textContent = result.phonetic;
        head.appendChild(phonetic);
    }
    if (hoverSpeechAvailable()) {
        const speak = doc.createElement("button");
        speak.type = "button";
        speak.className = "ytbt-wordtip-speak";
        speak.setAttribute("aria-label", "朗读单词");
        speak.textContent = "🔊";
        speak.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (hoverSpeechActive && hoverSpeakingWord === result.word) hoverStopSpeech(c);
            else hoverSpeakWord(result.word, c);
        });
        head.appendChild(speak);
        if (speak.classList) speak.classList.remove("speaking");
    }
    tip.appendChild(head);

    for (const entry of result.entries || []) {
        const row = doc.createElement("div");
        row.className = "ytbt-wordtip-row";
        if (entry.pos) {
            const pos = doc.createElement("span");
            pos.className = "ytbt-wordtip-pos";
            pos.textContent = entry.pos;
            row.appendChild(pos);
        }
        const meaning = doc.createElement("span");
        meaning.className = "ytbt-wordtip-mean";
        meaning.textContent = entry.variants.join("；");
        row.appendChild(meaning);
        tip.appendChild(row);
    }

    const actions = doc.createElement("div");
    actions.className = "ytbt-wordtip-actions";
    const save = doc.createElement("button");
    save.type = "button";
    save.className = "ytbt-wordtip-save";
    save.textContent = "收藏";
    save.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        hoverSaveWord(result, c);
    });
    actions.appendChild(save);
    tip.appendChild(actions);

    tip.hidden = false;
    hoverCancelHideTip(c);
    // 浮层一显示就接管暂停：从单词移向浮层的途中会有空隙，
    // 若只靠 pointer 进入浮层才暂停，这段空隙会把播放提前恢复。
    hoverSuspend("tooltip");
    const wordChanged = c.tipWord !== result.word;
    c.tipWord = result.word;
    // 换词时先停掉上一个单词的朗读，再自动朗读新词；同一个词不重复读
    if (wordChanged) hoverStopSpeech(c);
    hoverSpeakWord(result.word, c);
    // 定位依赖布局信息，个别时机（刚插入 DOM）拿不到尺寸时不能让浮层消失
    try {
        hoverPositionTip(tip, range, c);
    } catch { /* 保留默认位置 */ }
}

function hoverScheduleHideTip(ctx) {
    const c = hoverCtx(ctx);
    if (c.hideTimer) clearTimeout(c.hideTimer);
    c.hideTimer = setTimeout(() => {
        c.hideTimer = 0;
        // 只有真的站到浮层上才拦下收起；指针停在字幕的字间空白时
        // 这题还有宽限，过了就该收，否则浮层会一直挂在画面上。
        if (hoverZoneFlags.tooltip) return;
        hoverHideTip(c);
    }, HOVER_TIP_GRACE_MS);
}

function hoverCancelHideTip(ctx) {
    const c = hoverCtx(ctx);
    if (c.hideTimer) clearTimeout(c.hideTimer);
    c.hideTimer = 0;
}

function hoverHideTip(ctx) {
    const c = hoverCtx(ctx);
    if (c.hideTimer) clearTimeout(c.hideTimer);
    c.hideTimer = 0;
    hoverStopSpeech(c);
    c.tipWord = "";
    hoverHighlight(null, c);
    const wasVisible = Boolean(c.tip && !c.tip.hidden);
    if (c.tip) c.tip.hidden = true;
    if (wasVisible) hoverRelease("tooltip");
}

async function hoverSaveWord(result, ctx) {
    const c = hoverCtx(ctx);
    if (hoverTipBusy) return;
    hoverTipBusy = true;
    const button = c.tip && c.tip.querySelector ? c.tip.querySelector(".ytbt-wordtip-save") : null;
    if (button) button.textContent = "收藏中...";
    try {
        const cue = Core.findCueAtTime(Core.getCaptionDisplayCues(state.cues), getCurrentTimeMs());
        const settings = state.settings || {};
        await Core.sendRuntimeMessage(chrome.runtime, {
            type: "VOCABULARY",
            action: "add",
            entry: {
                sourceText: result.word,
                translatedText: hoverTipText(result),
                sourceLanguage: settings.sourceLanguage || "en",
                targetLanguage: settings.targetLanguage || "zh-CN",
                contextText: (cue && (cue.displaySourceText || cue.sourceText)) || "",
                sourceUrl: location.href,
                sourceTitle: document.title
            }
        }, 8000);
        if (button) button.textContent = "已收藏 ✓";
        if (button) button.disabled = true;
    } catch (error) {
        if (button) button.textContent = "收藏失败";
    } finally {
        hoverTipBusy = false;
    }
}

function hoverLookupWord(word, range, x, y, ctx) {
    const c = hoverCtx(ctx);
    clearTimeout(c.wordTimer);
    c.pendingWord = word;

    const cached = hoverWordCache.get(word);
    if (cached) {
        hoverRenderTip(cached, range, c);
        return;
    }

    c.wordTimer = setTimeout(async () => {
        c.wordTimer = 0;
        if (c.pendingWord !== word) return;
        try {
            const response = await Core.sendRuntimeMessage(
                chrome.runtime, {type: "LOOKUP_WORD", word}, 9000
            );
            if (c.pendingWord !== word) return;
            if (!response || !response.ok || !response.result) {
                hoverHideTip(c);
                return;
            }
            hoverWordCache.set(word, response.result);
            if (hoverWordCache.size > 300) {
                hoverWordCache.delete(hoverWordCache.keys().next().value);
            }
            hoverRenderTip(response.result, range, c);
        } catch {
            // 已经渲染出释义时不要因为后续异常把它收起来
            if (c.pendingWord === word && c.tipWord !== word) hoverHideTip(c);
        }
    }, HOVER_WORD_DELAY_MS);

    // 先高亮，给用户即时反馈（释义还没回来）。
    // 不在这里立刻销毁旧浮层：指针从某个词移向浮层时会蹭过同一行的
    // 其他词，一销毁就点不到「收藏」了。新释义回来会直接替换旧内容；
    // 查不到时由上面的失败分支收起。
    hoverHighlight(range, c);
    void x;
    void y;
}

function hoverTrackWord(event, ctx) {
    const c = hoverCtx(ctx);
    if (!hoverLookupAllowed()) return;
    // 左键按住拖动或页面已有选区时，不查词也不弹浮层。
    // 这样拖选字幕时不会被词语释义打断，松开后的译文卡片也不会被词卡盖住。
    // 画中画额外看 dragging / 划词卡标志：补帧事件没有 buttons，必须靠它们挡住。
    const pipBusy = c.isPip && (c.pipSelDragging || c.pipSelCard);
    if ((event && (event.buttons & 1)) || pipBusy || hoverSelectionBusy(c)) {
        clearTimeout(c.wordTimer);
        c.pendingWord = "";
        hoverScheduleHideTip(c);
        return;
    }
    const hit = hoverWordAtPoint(event.clientX, event.clientY, c);
    if (!hit) {
        // 指针还在字幕里、只是落在了词外（两行之间、标点、空格），
        // 不能立刻收起浮层，否则想移到「收藏」按钮时会先被关掉。
        clearTimeout(c.wordTimer);
        c.pendingWord = "";
        hoverScheduleHideTip(c);
        return;
    }
    // 指针落在单词上，不管之前是不是排了收起，都要把它取消：
    // 从单词滑向浮层时会蹭过同一行的其他单词，若不取消，横幅会在
    // 半途被先前排的计时器收起来，导致点不到「收藏」。
    hoverCancelHideTip(c);
    if (hit.word === c.tipWord || hit.word === c.pendingWord) {
        hoverHighlight(hit.range, c);
        hoverPositionTip(hoverEnsureTip(c), hit.range, c);
        return;
    }
    hoverLookupWord(hit.word, hit.range, event.clientX, event.clientY, c);
}

// --- 区域判定与事件绑定 ---

function hoverZoneOf(target, ctx) {
    const c = hoverCtx(ctx);
    if (!target || !target.closest) return "";
    if (target.closest(".ytbt-wordtip")) return "tooltip";
    if (c.transcriptSelector && target.closest(c.transcriptSelector)) return "transcript";
    if (target.closest(c.lineSelector)) return "subtitle";
    if (c.relatedSelector && target.closest(c.relatedSelector)) return "related";
    return "";
}

// 把指针所在区域换算成「哪些区域应该保持暂停」，逐项对比后生效。
// 浮层自己也算一个区域：往浮层上移动不能把浮层关掉，否则点不到收藏按钮。
function hoverApplyZone(zone, event, ctx) {
    const c = hoverCtx(ctx);
    const next = {
        subtitle: zone === "subtitle",
        transcript: zone === "transcript",
        related: zone === "related",
        tooltip: zone === "tooltip",
    };
    for (const name of Object.keys(next)) {
        if (next[name] === hoverZoneFlags[name]) continue;
        hoverZoneFlags[name] = next[name];
        if (next[name]) hoverSuspend(name);
        else hoverRelease(name);
    }

    if (zone === "subtitle" || zone === "transcript") {
        hoverCancelHideTip(c);
        hoverTrackWord(event, c);
        return;
    }
    if (zone === "tooltip") {
        hoverCancelHideTip(c);
        return;
    }

    clearTimeout(c.wordTimer);
    c.pendingWord = "";
    hoverScheduleHideTip(c);
}

function hoverHandleOver(event, ctx) {
    const c = hoverCtx(ctx);
    const zone = hoverZoneOf(event.target, c);
    if (zone !== c.activeZone) c.activeZone = zone;
    hoverApplyZone(zone, event, c);
}

function hoverHandleOut(event, ctx) {
    const c = hoverCtx(ctx);
    // relatedTarget 为空时无法判断去了哪里（跨层/离开窗口），
    // 交给后续的 mouseover 或 document 的 mouseleave 处理，
    // 否则从字幕移向浮层的过程中会误判成“离开”而把浮层收起来。
    if (!event.relatedTarget) return;
    const zone = hoverZoneOf(event.relatedTarget, c);
    if (zone === c.activeZone) return;
    c.activeZone = zone;
    hoverApplyZone(zone, event, c);
}

// mouseover 只在进入新元素时触发，而一整行字幕是同一个元素：
// 在同一行里从单词 A 滑到单词 B 不会产生 mouseover，
// 所以词与词之间的切换必须靠 mousemove 驱动（节流，避免每个像素都取一次词）。
var HOVER_MOVE_MIN_MS = 60;

function hoverHandleMove(event, ctx) {
    const c = hoverCtx(ctx);
    if (!(hoverZoneFlags.subtitle || hoverZoneFlags.transcript) || !hoverLookupAllowed()) return;
    const now = Date.now();
    const elapsed = now - c.lastMoveAt;
    if (elapsed >= HOVER_MOVE_MIN_MS) {
        clearTimeout(c.moveTimer);
        c.moveTimer = 0;
        c.lastMoveAt = now;
        hoverTrackWord(event, c);
        return;
    }
    // 节流会丢掉最后几帧，指针停下时可能停在旧词上。
    // 记下最后一次位置，间隔结束后补一次，保证停在哪里就查哪个词。
    c.lastMoveEvent = {clientX: event.clientX, clientY: event.clientY, buttons: event.buttons};
    if (c.moveTimer) return;
    c.moveTimer = setTimeout(() => {
        c.moveTimer = 0;
        c.lastMoveAt = Date.now();
        if (!(hoverZoneFlags.subtitle || hoverZoneFlags.transcript) || !c.lastMoveEvent) return;
        hoverTrackWord(c.lastMoveEvent, c);
    }, HOVER_MOVE_MIN_MS - elapsed);
}

function hoverHandleLeaveWindow(ctx) {
    const c = hoverCtx(ctx);
    c.activeZone = "";
    hoverApplyZone("", null, c);
}

function hoverBindContext(c) {
    if (!c || c.disposed || c.bound.length) return;
    const doc = c.doc;
    const win = c.win;
    if (!doc || typeof doc.addEventListener !== "function") return;
    const add = (target, type, handler, capture) => {
        target.addEventListener(type, handler, capture);
        c.bound.push([target, type, handler, capture]);
    };
    add(doc, "mouseover", (event) => hoverHandleOver(event, c), true);
    add(doc, "mouseout", (event) => hoverHandleOut(event, c), true);
    add(doc, "mousemove", (event) => hoverHandleMove(event, c), true);
    add(doc, "mouseleave", () => hoverHandleLeaveWindow(c), true);
    // 开始拖选时立刻收掉已有词卡，并取消尚未触发的查词。
    add(doc, "pointerdown", () => {
        clearTimeout(c.wordTimer);
        c.pendingWord = "";
        hoverHideTip(c);
    }, true);
    if (win && typeof win.addEventListener === "function") {
        add(win, "scroll", () => hoverHideTip(c), true);
        add(win, "resize", () => hoverHideTip(c), false);
    }
}

function hoverUnbindContext(c) {
    if (!c || !c.bound.length) return;
    hoverHideTip(c);
    clearTimeout(c.wordTimer);
    clearTimeout(c.hideTimer);
    clearTimeout(c.moveTimer);
    c.wordTimer = 0;
    c.hideTimer = 0;
    c.moveTimer = 0;
    c.pendingWord = "";
    c.lastMoveEvent = null;
    for (const [target, type, handler, capture] of c.bound) {
        try { target.removeEventListener(type, handler, capture); } catch (_) { /* 忽略 */ }
    }
    c.bound = [];
    c.disposed = true;
}

function bindHoverInteractions() {
    if (hoverMain && hoverMain.bound.length) return;
    // 任何一步绑定失败都不能抛出去：本文件排在 content-controls/content-main 之前，
    // 一旦中断，字幕、播放器按钮等后续模块会全部不加载。
    hoverMain = hoverCreateContext(document, window, false);
    hoverBindContext(hoverMain);
    // 关闭悬停朗读开关时立刻停下正在播放的朗读。
    try {
        if (globalThis.chrome?.storage?.onChanged) {
            globalThis.chrome.storage.onChanged.addListener((changes) => {
                if (changes.hoverSpeakEnabled && changes.hoverSpeakEnabled.newValue === false) {
                    hoverStopSpeech();
                }
            });
        }
    } catch (_) { /* 无 storage 权限时忽略 */ }
    hoverBindPlayWatcher();
}

// --- 画中画划词翻译 / 收藏 ---
// 画中画是独立 document，主页面的 selection.js 不会注入进来（事件都绑在主 document）。
// 这里为画中画单独实现一套最小划词流程：读画中选区 → 翻译 → 原生卡片 → 收藏/朗读。
// 卡片用原生 DOM 挂在画中画 document，不依赖跨 document 的 React root 与事件系统。
// 与 hover 取词互斥：拖选时 (event.buttons & 1) 挡住取词；卡片出现时收起词卡；
// 选区残留不再挡取词（见 hoverSelectionBusy 的 isPip 分支），二者可顺畅切换。

function pipSelSourceUrl() {
    try { return typeof location !== "undefined" ? location.href : ""; } catch (_) { return ""; }
}

function pipSelSourceTitle() {
    try { return typeof document !== "undefined" ? document.title : ""; } catch (_) { return ""; }
}

function pipSelContextText(c) {
    try {
        // 优先取选区所在字幕行；画中画现在是列表视图，不再有单条 .ytbt-pip-en。
        let node = null;
        const selection = c.win && c.win.getSelection ? c.win.getSelection() : null;
        if (selection && selection.anchorNode) {
            node = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
        }
        let row = node && node.closest ? node.closest(".ytbt-cue-row") : null;
        if (!row && c.doc.querySelector) {
            row = c.doc.querySelector('.ytbt-cue-row[aria-current="true"]') || c.doc.querySelector(".ytbt-cue-row");
        }
        if (!row) return "";
        const source = row.querySelector && row.querySelector(".ytbt-cue-source");
        const translation = row.querySelector && row.querySelector(".ytbt-cue-translation");
        const text = [source && source.textContent, translation && translation.textContent]
            .filter(Boolean).join(" ");
        return String(text || "").replace(/\s+/g, " ").trim().slice(0, 1800);
    } catch (_) { return ""; }
}

function pipSelReadSelection(c) {
    let selection = null;
    try { selection = c.win && c.win.getSelection ? c.win.getSelection() : null; } catch (_) { return null; }
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    let rect = null;
    try {
        const range = selection.getRangeAt(0);
        if (typeof range.getBoundingClientRect === "function") rect = range.getBoundingClientRect();
    } catch (_) { return null; }
    const text = String(selection.toString ? selection.toString() : "").replace(/\s+/g, " ").trim();
    const max = (Core && Core.SELECTION_MAX_CHARS) || 2000;
    if (!text || text.length > max) return null;
    return {text, rect};
}

// 清空画中画文档里的文字选区，避免残留选区干扰下一次悬停取词。
function pipSelClearSelection(c) {
    try {
        const selection = c.win && c.win.getSelection ? c.win.getSelection() : null;
        if (selection && typeof selection.removeAllRanges === "function") {
            selection.removeAllRanges();
        }
    } catch (_) { /* 忽略 */ }
}

// 清理卡片状态。release=true 时同时归还「划词」暂停区域。
function pipSelClear(c, release) {
    if (!c) return;
    c.pipSelRevision = (c.pipSelRevision || 0) + 1;
    c.pipSelText = "";
    c.pipSelRect = null;
    c.pipSelResult = null;
    c.pipSelTranslating = false;
    c.pipSelSaving = false;
    c.pipSelSaved = false;
    c.pipSelError = "";
    try { hoverSpeechEngine()?.cancel?.(); } catch (_) { /* 忽略 */ }
    c.pipSelUtterance = null;
    const card = c.pipSelCard;
    if (card) {
        if (card.parentNode && card.parentNode.removeChild) {
            try { card.parentNode.removeChild(card); } catch (_) { /* 忽略 */ }
        } else if (typeof card.remove === "function") {
            try { card.remove(); } catch (_) { /* 忽略 */ }
        }
    }
    c.pipSelCard = null;
    if (release) hoverRelease("selection");
}

function pipSelDismiss(c) {
    pipSelClearSelection(c);
    pipSelClear(c, true);
}

function pipSelPosition(c, rect) {
    const card = c.pipSelCard;
    if (!card || !rect) return;
    const margin = 8;
    const box = card.getBoundingClientRect && card.getBoundingClientRect();
    const width = (box && box.width) || 320;
    const height = (box && box.height) || 120;
    const viewWidth = (c.win && c.win.innerWidth) || 960;
    const viewHeight = (c.win && c.win.innerHeight) || 260;
    let left = (rect.left + rect.right) / 2 - width / 2;
    left = Math.max(margin, Math.min(left, viewWidth - width - margin));
    let top = rect.bottom + 6;
    if (top + height > viewHeight - margin) top = rect.top - height - 6;
    top = Math.max(margin, Math.min(top, viewHeight - height - margin));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
}

function pipSelStopSpeak(c) {
    if (!c.pipSelUtterance) return;
    c.pipSelUtterance = null;
    try { hoverSpeechEngine()?.cancel?.(); } catch (_) { /* 忽略 */ }
    hoverRelease("selectionSpeech");
    pipSelRender(c);
}

function pipSelSpeak(c) {
    if (!c.pipSelText || !hoverSpeechAvailable()) return;
    if (c.pipSelUtterance) { pipSelStopSpeak(c); return; }
    const utterance = new window.SpeechSynthesisUtterance(c.pipSelText);
    const voice = hoverPickVoice();
    const lang = /[\u3400-\u9fff]/.test(c.pipSelText) ? "zh-CN" : "en-US";
    utterance.lang = voice?.lang || lang;
    if (voice) utterance.voice = voice;
    utterance.rate = hoverSpeechRate();
    c.pipSelUtterance = utterance;
    const finish = () => {
        if (c.pipSelUtterance !== utterance) return;
        c.pipSelUtterance = null;
        hoverRelease("selectionSpeech");
        pipSelRender(c);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    hoverSuspend("selectionSpeech");
    pipSelRender(c);
    try {
        hoverSpeechEngine().speak(utterance);
    } catch (_) { finish(); }
}

function pipSelRender(c) {
    const card = c.pipSelCard;
    if (!card) return;
    const doc = c.doc;
    card.textContent = "";
    if (Array.isArray(card.children)) card.children.length = 0;
    if (Array.isArray(card.handlers)) card.handlers = {};

    const source = doc.createElement("div");
    source.className = "ytbt-pipsel-source";
    source.textContent = c.pipSelText || "";
    card.appendChild(source);

    const result = doc.createElement("div");
    result.className = "ytbt-pipsel-result";
    result.textContent = c.pipSelError ||
        (c.pipSelTranslating ? "正在翻译…" : (c.pipSelResult && c.pipSelResult.translatedText) || "");
    card.appendChild(result);

    const actions = doc.createElement("div");
    actions.className = "ytbt-pipsel-actions";

    const speak = doc.createElement("button");
    speak.className = "ytbt-pipsel-speak";
    speak.textContent = c.pipSelUtterance ? "停止朗读" : "朗读";
    speak.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        pipSelSpeak(c);
    });
    actions.appendChild(speak);

    const save = doc.createElement("button");
    save.className = "ytbt-pipsel-save";
    save.textContent = c.pipSelSaving ? "收藏中…" : (c.pipSelSaved ? "已收藏 ✓" : "收藏到生词本");
    save.disabled = Boolean(c.pipSelSaved) || !c.pipSelResult;
    save.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        pipSelSave(c);
    });
    actions.appendChild(save);

    const close = doc.createElement("button");
    close.className = "ytbt-pipsel-close";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        pipSelDismiss(c);
    });
    actions.appendChild(close);
    card.appendChild(actions);
    card.hidden = false;
}

function pipSelEnsureCard(c) {
    if (c.pipSelCard && (c.pipSelCard.isConnected || c.pipSelCard.parentNode)) return c.pipSelCard;
    const card = c.doc.createElement("div");
    card.className = "ytbt-pipsel";
    // 卡片内部操作不能被画中画窗口当成关闭/定位手势。
    for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) {
        card.addEventListener(type, (event) => {
            if (event && event.stopPropagation) event.stopPropagation();
        });
    }
    c.doc.body.appendChild(card);
    c.pipSelCard = card;
    return card;
}

async function pipSelTranslate(c, text, contextText, rect) {
    const revision = c.pipSelRevision;
    c.pipSelTranslating = true;
    c.pipSelError = "";
    pipSelRender(c);
    try {
        const response = await Core.sendRuntimeMessage(chrome.runtime, {
            type: "SELECTION_TRANSLATE",
            sourceText: text,
            contextText,
            sourceUrl: pipSelSourceUrl(),
            sourceTitle: pipSelSourceTitle()
        }, 130000);
        if (revision !== c.pipSelRevision) return;
        if (!response || !response.ok) throw new Error((response && response.error) || "翻译失败");
        c.pipSelResult = response;
    } catch (error) {
        if (revision !== c.pipSelRevision) return;
        c.pipSelError = "翻译失败：" + ((error && error.message) || "请重试");
    } finally {
        if (revision === c.pipSelRevision) {
            c.pipSelTranslating = false;
            pipSelRender(c);
            pipSelPosition(c, rect);
        }
    }
}

async function pipSelSave(c) {
    if (!c.pipSelResult || c.pipSelSaving || c.pipSelSaved) return;
    const revision = c.pipSelRevision;
    c.pipSelSaving = true;
    c.pipSelError = "";
    pipSelRender(c);
    try {
        await Core.sendRuntimeMessage(chrome.runtime, {
            type: "VOCABULARY", action: "add", entry: c.pipSelResult
        }, 8000);
        if (revision === c.pipSelRevision) c.pipSelSaved = true;
    } catch (error) {
        if (revision === c.pipSelRevision) c.pipSelError = "收藏失败：" + ((error && error.message) || "请重试");
    } finally {
        if (revision === c.pipSelRevision) { c.pipSelSaving = false; pipSelRender(c); }
    }
}

function pipSelHandlePointerUp(c) {
    // 拖选结束：先解除 dragging 保护，但先别急着放行取词——
    // 若这次是有效选区，马上会弹划词卡，中间的空档不能让补帧取词钻进来。
    c.pipSelDragging = false;
    if (!hoverLookupAllowed()) return;
    // 等浏览器把选区敲定后再读，pointerup 这一刻 toString() 可能还是空的。
    setTimeout(() => {
        const hit = pipSelReadSelection(c);
        if (!hit) {
            // 没有有效选区（纯点击/单词）：清空残留选区，恢复悬停取词。
            pipSelClearSelection(c);
            return;
        }
        // 先掐掉可能在拖选期间排队的异步单词查词，避免它事后弹词卡。
        clearTimeout(c.wordTimer);
        c.wordTimer = 0;
        c.pendingWord = "";
        clearTimeout(c.moveTimer);
        c.moveTimer = 0;
        hoverHideTip(c);
        pipSelClear(c, false);
        c.pipSelText = hit.text;
        c.pipSelRect = hit.rect;
        hoverSuspend("selection");
        pipSelEnsureCard(c);
        pipSelRender(c);
        pipSelPosition(c, hit.rect);
        pipSelTranslate(c, hit.text, pipSelContextText(c), hit.rect);
    }, 0);
}

function pipSelHandlePointerDown(c, event) {
    const card = c.pipSelCard;
    if (!card) return;
    // 点卡片内部交给按钮自己处理，不要因为选区折叠而误关卡片。
    const target = event && event.target;
    if (target && card.contains && typeof card.contains === "function") {
        try { if (card.contains(target)) return; } catch (_) { /* 忽略 */ }
    }
    setTimeout(() => {
        let selection = null;
        try { selection = c.win && c.win.getSelection ? c.win.getSelection() : null; } catch (_) { return; }
        if (!selection || selection.isCollapsed) pipSelDismiss(c);
    }, 0);
}

function hoverBindPipSelection(c) {
    if (!c || c.pipSelBound) return;
    const add = (target, type, handler, capture) => {
        target.addEventListener(type, handler, capture);
        c.bound.push([target, type, handler, capture]);
    };
    add(c.doc, "pointerup", (event) => {
        if (event && event.button !== undefined && event.button !== 0) return;
        pipSelHandlePointerUp(c);
    }, true);
    add(c.doc, "pointerdown", (event) => {
        if (event && event.button !== undefined && event.button !== 0) return;
        // 左键按下即进入拖选保护期：挡住取词，并掐掉排队的异步查词。
        // 这样拖选过程中/松手后的补帧都不会弹出单词卡去抢划词卡。
        c.pipSelDragging = true;
        clearTimeout(c.wordTimer);
        c.wordTimer = 0;
        c.pendingWord = "";
        pipSelHandlePointerDown(c, event);
    }, true);
    add(c.win, "keyup", (event) => {
        if (!event || !event.key) return;
        if (event.key === "Escape") pipSelDismiss(c);
        else if (event.key === "Shift" || event.key.startsWith("Arrow")) pipSelHandlePointerUp(c);
    }, true);
    c.pipSelBound = true;
}

// 画中画窗口由 content-pip.js 创建后调用；关闭前调用 hoverUnbindPip 清理。
function hoverBindPip(pipWindow) {
    if (!pipWindow || !pipWindow.document) return false;
    hoverUnbindPip();
    hoverPip = hoverCreateContext(pipWindow.document, pipWindow, true);
    hoverBindContext(hoverPip);
    hoverBindPipSelection(hoverPip);
    return hoverPip;
}

function hoverUnbindPip() {
    if (!hoverPip) return;
    pipSelClear(hoverPip, true);
    hoverUnbindContext(hoverPip);
    hoverPip = null;
    // 两个窗口共用 tooltip 暂停记账，画中画收起时同步释放。
    hoverRelease("tooltip");
}

// 供划词模块在译文卡片打开/关闭时登记同一个暂停区域。
globalThis.YTBTHover = {
    suspend: hoverSuspend,
    release: hoverRelease,
    hideTip: (ctx) => hoverHideTip(ctx),
    bindPip: hoverBindPip,
    unbindPip: hoverUnbindPip,
};

try {
    bindHoverInteractions();
} catch (error) {
    // 悬停只是辅助功能，不可用时静默降级，不要影响字幕与翻译
}
