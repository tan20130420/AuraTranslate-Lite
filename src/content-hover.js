/*
 * AuraTranslate content script — hover interactions
 *
 * 三个悬停行为：
 *   1. 鼠标停在字幕上 → 暂停播放（移开后恢复，仅恢复自己暂停的那次）
 *   2. 鼠标停在悬浮字幕列表某一行上 → 暂停播放（移开后恢复）
 *   3. 鼠标停在右侧推荐视频列表上 → 暂停播放
 *   4. 鼠标停在字幕/字幕列表里的英文单词上 → 显示音标与中文释义，可一键收藏
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
// 右侧推荐列表：桌面版是 #secondary，Shorts 与部分新版布局用自定义元素。
var HOVER_RELATED_SELECTOR = "#secondary, ytd-watch-next-secondary-results-renderer, #related";

var hoverZones = new Set();
var hoverZoneFlags = {subtitle: false, transcript: false, related: false, tooltip: false};
var hoverPauseOwned = false;
var hoverResumeTimer = 0;
var hoverWordTimer = 0;
var hoverTipHideTimer = 0;
var hoverPendingWord = "";
var hoverTip = null;
var hoverTipWord = "";
var hoverTipBusy = false;
var hoverWordCache = new Map();
var hoverActiveZone = "";
var hoverBound = false;

function hoverVideo() {
    return state.video || document.querySelector("video");
}

// 划词进行中（左键按下或选区未清空）时不要再弹单词浮层，
// 否则浮层会挡住选区，或与划词译文卡片叠在一起。
function hoverSelectionBusy() {
    const selection = window.getSelection && window.getSelection();
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

function hoverStopSpeech() {
    if (!hoverSpeechActive && !hoverSpeakingWord) return;
    hoverSpeechActive = false;
    hoverSpeakingWord = "";
    try { hoverSpeechEngine()?.cancel?.(); } catch (_) { /* 不支持时忽略 */ }
    const button = hoverTip && hoverTip.querySelector(".ytbt-wordtip-speak");
    if (button) {
        button.classList.remove("speaking");
        button.setAttribute("aria-label", "朗读单词");
    }
    hoverRelease("hoverSpeech");
}

function hoverSpeakWord(word) {
    if (!word || !hoverSpeakAllowed() || !hoverSpeechAvailable()) return false;
    if (hoverSpeakingWord === word && hoverSpeechActive) return false;
    hoverStopSpeech();
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
        const button = hoverTip && hoverTip.querySelector(".ytbt-wordtip-speak");
        if (button) {
            button.classList.remove("speaking");
            button.setAttribute("aria-label", "朗读单词");
        }
        hoverRelease("hoverSpeech");
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    hoverSuspend("hoverSpeech");
    const button = hoverTip && hoverTip.querySelector(".ytbt-wordtip-speak");
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

function hoverWordAtPoint(x, y) {
    let range = null;
    try {
        if (typeof document.caretRangeFromPoint === "function") {
            range = document.caretRangeFromPoint(x, y);
        } else if (typeof document.caretPositionFromPoint === "function") {
            const position = document.caretPositionFromPoint(x, y);
            if (position && position.offsetNode) {
                range = document.createRange();
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
    const line = parent && parent.closest ? parent.closest(HOVER_WORD_SELECTOR) : null;
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

    const wordRange = document.createRange();
    try {
        wordRange.setStart(node, start + (raw.length - raw.replace(/^['-]+/, "").length));
        wordRange.setEnd(node, start + raw.replace(/['-]+$/, "").length);
    } catch {
        return null;
    }
    return {word, range: wordRange};
}

function hoverHighlight(range) {
    if (!globalThis.CSS || !CSS.highlights || typeof globalThis.Highlight !== "function") return;
    try {
        if (!range) {
            CSS.highlights.delete("ytbt-word");
            return;
        }
        CSS.highlights.set("ytbt-word", new Highlight(range));
    } catch { /* 高亮只是装饰，失败不影响查词 */ }
}

// --- 释义浮层 ---

function hoverEnsureTip() {
    if (hoverTip && hoverTip.isConnected) return hoverTip;
    const tip = document.createElement("div");
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
    document.body.appendChild(tip);
    hoverTip = tip;
    return tip;
}

function hoverTipText(result) {
    return (result.entries || [])
        .map((entry) => entry.variants.join("；"))
        .filter(Boolean)
        .join(" / ");
}

function hoverPositionTip(tip, range) {
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
        ? node.parentElement.closest(HOVER_LINE_SELECTOR) : null;
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
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    left = Math.min(Math.max(left, margin), maxLeft);

    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
}

function hoverRenderTip(result, range) {
    const tip = hoverEnsureTip();
    tip.textContent = "";

    const head = document.createElement("div");
    head.className = "ytbt-wordtip-head";
    const title = document.createElement("span");
    title.className = "ytbt-wordtip-word";
    title.textContent = result.word;
    head.appendChild(title);
    if (result.phonetic) {
        const phonetic = document.createElement("span");
        phonetic.className = "ytbt-wordtip-phonetic";
        phonetic.textContent = result.phonetic;
        head.appendChild(phonetic);
    }
    if (hoverSpeechAvailable()) {
        const speak = document.createElement("button");
        speak.type = "button";
        speak.className = "ytbt-wordtip-speak";
        speak.setAttribute("aria-label", "朗读单词");
        speak.textContent = "🔊";
        speak.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (hoverSpeechActive && hoverSpeakingWord === result.word) hoverStopSpeech();
            else hoverSpeakWord(result.word);
        });
        head.appendChild(speak);
        if (speak.classList) speak.classList.remove("speaking");
    }
    tip.appendChild(head);

    for (const entry of result.entries || []) {
        const row = document.createElement("div");
        row.className = "ytbt-wordtip-row";
        if (entry.pos) {
            const pos = document.createElement("span");
            pos.className = "ytbt-wordtip-pos";
            pos.textContent = entry.pos;
            row.appendChild(pos);
        }
        const meaning = document.createElement("span");
        meaning.className = "ytbt-wordtip-mean";
        meaning.textContent = entry.variants.join("；");
        row.appendChild(meaning);
        tip.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "ytbt-wordtip-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "ytbt-wordtip-save";
    save.textContent = "收藏";
    save.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        hoverSaveWord(result);
    });
    actions.appendChild(save);
    tip.appendChild(actions);

    tip.hidden = false;
    hoverCancelHideTip();
    // 浮层一显示就接管暂停：从单词移向浮层的途中会有空隙，
    // 若只靠 pointer 进入浮层才暂停，这段空隙会把播放提前恢复。
    hoverSuspend("tooltip");
    const wordChanged = hoverTipWord !== result.word;
    hoverTipWord = result.word;
    // 换词时先停掉上一个单词的朗读，再自动朗读新词；同一个词不重复读
    if (wordChanged) hoverStopSpeech();
    hoverSpeakWord(result.word);
    // 定位依赖布局信息，个别时机（刚插入 DOM）拿不到尺寸时不能让浮层消失
    try {
        hoverPositionTip(tip, range);
    } catch { /* 保留默认位置 */ }
}

function hoverScheduleHideTip() {
    if (hoverTipHideTimer) clearTimeout(hoverTipHideTimer);
    hoverTipHideTimer = setTimeout(() => {
        hoverTipHideTimer = 0;
        // 只有真的站到浮层上才拦下收起；指针停在字幕的字间空白时
        // 这题还有宽限，过了就该收，否则浮层会一直挂在画面上。
        if (hoverZoneFlags.tooltip) return;
        hoverHideTip();
    }, HOVER_TIP_GRACE_MS);
}

function hoverCancelHideTip() {
    if (hoverTipHideTimer) clearTimeout(hoverTipHideTimer);
    hoverTipHideTimer = 0;
}

function hoverHideTip() {
    if (hoverTipHideTimer) clearTimeout(hoverTipHideTimer);
    hoverTipHideTimer = 0;
    hoverStopSpeech();
    hoverTipWord = "";
    hoverHighlight(null);
    const wasVisible = Boolean(hoverTip && !hoverTip.hidden);
    if (hoverTip) hoverTip.hidden = true;
    if (wasVisible) hoverRelease("tooltip");
}

async function hoverSaveWord(result) {
    if (hoverTipBusy) return;
    hoverTipBusy = true;
    const button = hoverTip && hoverTip.querySelector(".ytbt-wordtip-save");
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

function hoverLookupWord(word, range, x, y) {
    clearTimeout(hoverWordTimer);
    hoverPendingWord = word;

    const cached = hoverWordCache.get(word);
    if (cached) {
        hoverRenderTip(cached, range);
        return;
    }

    hoverWordTimer = setTimeout(async () => {
        hoverWordTimer = 0;
        if (hoverPendingWord !== word) return;
        try {
            const response = await Core.sendRuntimeMessage(
                chrome.runtime, {type: "LOOKUP_WORD", word}, 9000
            );
            if (hoverPendingWord !== word) return;
            if (!response || !response.ok || !response.result) {
                hoverHideTip();
                return;
            }
            hoverWordCache.set(word, response.result);
            if (hoverWordCache.size > 300) {
                hoverWordCache.delete(hoverWordCache.keys().next().value);
            }
            hoverRenderTip(response.result, range);
        } catch {
            // 已经渲染出释义时不要因为后续异常把它收起来
            if (hoverPendingWord === word && hoverTipWord !== word) hoverHideTip();
        }
    }, HOVER_WORD_DELAY_MS);

    // 先高亮，给用户即时反馈（释义还没回来）。
    // 不在这里立刻销毁旧浮层：指针从某个词移向浮层时会蹭过同一行的
    // 其他词，一销毁就点不到「收藏」了。新释义回来会直接替换旧内容；
    // 查不到时由上面的失败分支收起。
    hoverHighlight(range);
    void x;
    void y;
}

function hoverTrackWord(event) {
    if (!hoverLookupAllowed()) return;
    // 左键按住拖动或页面已有选区时，不查词也不弹浮层。
    // 这样拖选字幕时不会被词语释义打断，松开后的译文卡片也不会被词卡盖住。
    if ((event && (event.buttons & 1)) || hoverSelectionBusy()) {
        clearTimeout(hoverWordTimer);
        hoverPendingWord = "";
        hoverScheduleHideTip();
        return;
    }
    const hit = hoverWordAtPoint(event.clientX, event.clientY);
    if (!hit) {
        // 指针还在字幕里、只是落在了词外（两行之间、标点、空格），
        // 不能立刻收起浮层，否则想移到「收藏」按钮时会先被关掉。
        clearTimeout(hoverWordTimer);
        hoverPendingWord = "";
        hoverScheduleHideTip();
        return;
    }
    // 指针落在单词上，不管之前是不是排了收起，都要把它取消：
    // 从单词滑向浮层时会蹭过同一行的其他单词，若不取消，横幅会在
    // 半途被先前排的计时器收起来，导致点不到「收藏」。
    hoverCancelHideTip();
    if (hit.word === hoverTipWord || hit.word === hoverPendingWord) {
        hoverHighlight(hit.range);
        hoverPositionTip(hoverEnsureTip(), hit.range);
        return;
    }
    hoverLookupWord(hit.word, hit.range, event.clientX, event.clientY);
}

// --- 区域判定与事件绑定 ---

function hoverZoneOf(target) {
    if (!target || !target.closest) return "";
    if (target.closest(".ytbt-wordtip")) return "tooltip";
    if (target.closest(HOVER_TRANSCRIPT_SELECTOR)) return "transcript";
    if (target.closest(HOVER_LINE_SELECTOR)) return "subtitle";
    if (target.closest(HOVER_RELATED_SELECTOR)) return "related";
    return "";
}

// 把指针所在区域换算成「哪些区域应该保持暂停」，逐项对比后生效。
// 浮层自己也算一个区域：往浮层上移动不能把浮层关掉，否则点不到收藏按钮。
function hoverApplyZone(zone, event) {
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
        hoverCancelHideTip();
        hoverTrackWord(event);
        return;
    }
    if (zone === "tooltip") {
        hoverCancelHideTip();
        return;
    }

    clearTimeout(hoverWordTimer);
    hoverPendingWord = "";
    hoverScheduleHideTip();
}

function hoverHandleOver(event) {
    const zone = hoverZoneOf(event.target);
    if (zone !== hoverActiveZone) hoverActiveZone = zone;
    hoverApplyZone(zone, event);
}

function hoverHandleOut(event) {
    // relatedTarget 为空时无法判断去了哪里（跨层/离开窗口），
    // 交给后续的 mouseover 或 document 的 mouseleave 处理，
    // 否则从字幕移向浮层的过程中会误判成“离开”而把浮层收起来。
    if (!event.relatedTarget) return;
    const zone = hoverZoneOf(event.relatedTarget);
    if (zone === hoverActiveZone) return;
    hoverActiveZone = zone;
    hoverApplyZone(zone, event);
}

// mouseover 只在进入新元素时触发，而一整行字幕是同一个元素：
// 在同一行里从单词 A 滑到单词 B 不会产生 mouseover，
// 所以词与词之间的切换必须靠 mousemove 驱动（节流，避免每个像素都取一次词）。
var HOVER_MOVE_MIN_MS = 60;
var hoverLastMoveAt = 0;
var hoverMoveTimer = 0;
var hoverLastMoveEvent = null;

function hoverHandleMove(event) {
    if (!(hoverZoneFlags.subtitle || hoverZoneFlags.transcript) || !hoverLookupAllowed()) return;
    const now = Date.now();
    const elapsed = now - hoverLastMoveAt;
    if (elapsed >= HOVER_MOVE_MIN_MS) {
        clearTimeout(hoverMoveTimer);
        hoverMoveTimer = 0;
        hoverLastMoveAt = now;
        hoverTrackWord(event);
        return;
    }
    // 节流会丢掉最后几帧，指针停下时可能停在旧词上。
    // 记下最后一次位置，间隔结束后补一次，保证停在哪里就查哪个词。
    hoverLastMoveEvent = {clientX: event.clientX, clientY: event.clientY};
    if (hoverMoveTimer) return;
    hoverMoveTimer = setTimeout(() => {
        hoverMoveTimer = 0;
        hoverLastMoveAt = Date.now();
        if (!(hoverZoneFlags.subtitle || hoverZoneFlags.transcript) || !hoverLastMoveEvent) return;
        hoverTrackWord(hoverLastMoveEvent);
    }, HOVER_MOVE_MIN_MS - elapsed);
}

function hoverHandleLeaveWindow() {
    hoverActiveZone = "";
    hoverApplyZone("", null);
}

function bindHoverInteractions() {
    if (hoverBound) return;
    // 任何一步绑定失败都不能抛出去：本文件排在 content-controls/content-main 之前，
    // 一旦中断，字幕、播放器按钮等后续模块会全部不加载。
    if (!document || typeof document.addEventListener !== "function") return;
    hoverBound = true;
    document.addEventListener("mouseover", hoverHandleOver, true);
    document.addEventListener("mouseout", hoverHandleOut, true);
    document.addEventListener("mousemove", hoverHandleMove, true);
    document.addEventListener("mouseleave", hoverHandleLeaveWindow, true);
    // 开始拖选时立刻收掉已有词卡，并取消尚未触发的查词。
    document.addEventListener("pointerdown", () => {
        clearTimeout(hoverWordTimer);
        hoverPendingWord = "";
        hoverHideTip();
    }, true);
    if (window && typeof window.addEventListener === "function") {
        window.addEventListener("scroll", hoverHideTip, true);
        window.addEventListener("resize", hoverHideTip);
    }
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

// 供划词模块在译文卡片打开/关闭时登记同一个暂停区域。
globalThis.YTBTHover = {
    suspend: hoverSuspend,
    release: hoverRelease,
    hideTip: hoverHideTip,
};

try {
    bindHoverInteractions();
} catch (error) {
    // 悬停只是辅助功能，不可用时静默降级，不要影响字幕与翻译
}
