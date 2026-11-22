/*
 * AuraTranslate 全部字幕侧边栏
 *
 * 独立 Document：从后台读取当前视频字幕，按时间码列出全部内容。
 * 支持悬停取词、划多词翻译、朗读、收藏到生词本。
 * 关键点：这里不读取、不跳转、不暂停视频，播放完全不受影响。
 */
(function () {
    "use strict";

    const Core = globalThis.YTBTCore;
    const list = document.getElementById("sp-list");
    const search = document.getElementById("sp-search");
    const count = document.getElementById("sp-count");
    const videoLabel = document.getElementById("sp-video");
    const card = document.getElementById("sp-card");
    const refresh = document.querySelector('[data-action="refresh"]');
    const hideToggle = document.getElementById("sp-hide-translation");
    const HIDE_TRANSLATION_KEY = "auratranslate:sidepanelHideTranslation";

    const HOVER_DELAY_MS = 260;
    const SAVED_HIDE_MS = 900; // 收藏成功后保留"已收藏 ✓"反馈，再自动收起卡片
    const CARD_LEAVE_MS = 1200; // 光标离开单词后延时收起，留出移到卡片点收藏的时间
    const CARD_OUT_MS = 400;    // 光标离开卡片后较快收起
    const WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;
    const wordCache = new Map();

    // hover 取词的高亮必须用 CSS Highlight API，而不是 window.getSelection()。
    // 否则高亮产生的真实选区会让 pointermove 里的"有选区就交给划词卡"判断
    // 一直成立，导致词卡卡在第一个词、移到新词不再更新。
    const HOVER_HIGHLIGHT_NAME = "aura-sidepanel-hover";
    let hoverHighlightSupported = false;
    try {
        hoverHighlightSupported = !!(globalThis.CSS && CSS.highlights && typeof globalThis.Highlight === "function");
    } catch (_) { hoverHighlightSupported = false; }

    function clearHoverHighlight() {
        if (!hoverHighlightSupported) return;
        try { CSS.highlights.delete(HOVER_HIGHLIGHT_NAME); } catch (_) { /* 忽略 */ }
    }

    const state = {
        cues: [],          // 原始字幕（Core.getCaptionDisplayCues 之后）
        query: "",
        hoverTimer: 0,
        hideTimer: 0,      // 光标离开后的延时收起定时器
        overCard: false,   // 光标是否在词条卡片上（在卡片上时不能被收起，否则点不到收藏按钮）
        pendingWord: "",
        tipWord: "",
        tipResult: null,   // 单词卡数据
        tipRevision: 0,
        dragging: false,
        selBusy: false,
        selResult: null,   // 划词译文卡数据
        selRevision: 0,
        selSaving: false,
        selSaved: false,
        savingWord: false,
        speakingText: "",
        sourceLanguage: "en",
        targetLanguage: "zh-CN",
        sourceUrl: "",
        sourceTitle: "",
        hideTranslation: false
    };

    // 偏好持久化（localStorage 与扩展其他页面共享 origin）。
    function loadHidePreference() {
        try {
            state.hideTranslation = localStorage.getItem(HIDE_TRANSLATION_KEY) === "1";
        } catch (_) { state.hideTranslation = false; }
        if (hideToggle) hideToggle.checked = state.hideTranslation;
    }
    function saveHidePreference() {
        try { localStorage.setItem(HIDE_TRANSLATION_KEY, state.hideTranslation ? "1" : "0"); } catch (_) { /* 忽略 */ }
    }

    function runtimeSend(message, timeout) {
        if (!Core || typeof Core.sendRuntimeMessage !== "function") return Promise.resolve(null);
        return Core.sendRuntimeMessage(chrome.runtime, message, timeout || 120000);
    }

    function timestamp(ms) {
        const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = (n) => String(n).padStart(2, "0");
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    // --- 读取字幕 ---
    async function loadTranscript() {
        count.textContent = "正在读取字幕…";
        try {
            const response = await runtimeSend({type: "SIDE_PANEL_GET"}, 8000);
            const data = response && response.transcript;
            if (!data || !Array.isArray(data.cues) || !data.cues.length) {
                state.cues = [];
                render();
                count.textContent = "暂无字幕：请先在视频页打开「查看全部字幕」";
                return;
            }
            state.sourceLanguage = data.sourceLanguage || "en";
            state.targetLanguage = data.targetLanguage || "zh-CN";
            state.sourceUrl = data.pageUrl || "";
            state.sourceTitle = data.videoTitle || "";
            videoLabel.textContent = data.videoTitle || "";
            videoLabel.hidden = !data.videoTitle;
            state.cues = typeof Core.getCaptionDisplayCues === "function"
                ? Core.getCaptionDisplayCues(data.cues) : data.cues;
            render();
        } catch (error) {
            state.cues = [];
            render();
            count.textContent = "读取失败：" + ((error && error.message) || "请重试");
        }
    }

    // --- 渲染字幕列表 ---
    function render() {
        const query = state.query;
        const rows = query
            ? state.cues.filter((cue) =>
                `${cue.sourceText} ${cue.displaySourceText || ""} ${cue.translatedText || ""}`
                    .toLocaleLowerCase().includes(query))
            : state.cues;
        count.textContent = `${rows.length} 条字幕` + (query ? `（共 ${state.cues.length} 条）` : "");
        const frag = document.createDocumentFragment();
        if (!rows.length) {
            const empty = document.createElement("p");
            empty.className = "sp-empty";
            empty.textContent = query ? "没有匹配的字幕" : (state.cues.length ? "" : "暂无字幕");
            frag.appendChild(empty);
        }
        rows.forEach((cue) => {
            const row = document.createElement("div");
            row.className = "sp-cue-row";
            row.setAttribute("data-start-ms", String(cue.startMs));
            row.title = "点击跳转到这一句播放";

            const time = document.createElement("span");
            time.className = "sp-cue-time";
            time.textContent = timestamp(cue.startMs);

            const body = document.createElement("div");
            body.className = "sp-cue-body";
            const source = document.createElement("div");
            source.className = "sp-cue-source";
            source.textContent = cue.displaySourceText || cue.sourceText || "";
            body.appendChild(source);
            if (cue.translatedText && !state.hideTranslation) {
                const translation = document.createElement("div");
                translation.className = "sp-cue-translation";
                translation.textContent = cue.translatedText;
                body.appendChild(translation);
            }
            row.appendChild(time);
            row.appendChild(body);
            frag.appendChild(row);
        });
        list.replaceChildren(frag);
        hideCard();
    }

    // --- 选区与单词定位 ---
    function readSelection() {
        const sel = window.getSelection && window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
        const text = String(sel.toString() || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 200) return null;
        let node = sel.anchorNode;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        if (!node || !node.closest || !node.closest(".sp-cue-source")) return null;
        let rect = null;
        try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (_) { rect = null; }
        return {text, rect};
    }

    function wordAtPoint(x, y) {
        let node;
        if (document.caretRangeFromPoint) node = document.caretRangeFromPoint(x, y);
        if (!node && document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos) {
                const range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
                node = range;
            }
        }
        if (!node) return null;
        const wordNode = node.startContainer && node.startContainer.nodeType === Node.TEXT_NODE
            ? node.startContainer.parentElement : null;
        if (!wordNode || !wordNode.closest || !wordNode.closest(".sp-cue-source")) return null;
        const text = wordNode.textContent || "";
        const offset = node.startOffset;
        // 光标落在词间时向两侧找最近边界
        let start = Math.min(offset, text.length);
        let end = start;
        while (start > 0 && /[A-Za-z'-]/.test(text[start - 1])) start--;
        while (end < text.length && /[A-Za-z'-]/.test(text[end])) end++;
        const word = text.slice(start, end).replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "");
        if (!word || !WORD_RE.test(word)) return null;
        const range = document.createRange();
        range.setStart(wordNode.firstChild, start);
        range.setEnd(wordNode.firstChild, end);
        let rect = null;
        try { rect = range.getBoundingClientRect(); } catch (_) { rect = null; }
        return {word: word.toLowerCase(), range, rect};
    }

    function highlight(range) {
        // 用 CSS Highlight API 高亮，绝不动真实选区：
        // 真实选区要留给划词翻译，且一旦被占用，pointermove 会误判为划词而
        // 屏蔽后续 hover 取词（词卡卡在第一个词）。
        if (!hoverHighlightSupported) return;
        clearHoverHighlight();
        if (!range) return;
        try { CSS.highlights.set(HOVER_HIGHLIGHT_NAME, new Highlight(range)); } catch (_) { /* 高亮不可用时静默降级 */ }
    }

    // --- 离开单词/卡片后的延时收起 ---
    function cancelCardHide() {
        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = 0;
        }
    }

    // 光标离开词条后延时收起。delay 给足时间让用户把光标移到卡片上点按钮；
    // 定时检查 overCard，若光标已移到卡片（或又回到词上）则不收起。
    function scheduleCardHide(delay) {
        cancelCardHide();
        if (card.hidden) return;
        state.hideTimer = setTimeout(() => {
            state.hideTimer = 0;
            // 光标在卡片上或正在拖选：不收起。光标若回到词上，pointermove
            // 已经 cancelCardHide() 取消了本定时器，不会走到这里。
            if (state.overCard || state.dragging) return;
            hideCard();
        }, delay || CARD_LEAVE_MS);
    }

    // --- 卡片定位与渲染 ---
    function hideCard() {
        cancelCardHide();
        card.hidden = true;
        state.overCard = false;
        state.tipWord = "";
        state.tipResult = null;
        state.selResult = null;
        state.selSaved = false;
        state.tipRevision++;
        state.selRevision++;
        stopSpeech();
        clearHoverHighlight();
        // 划词卡关闭时清空选区，避免与单词卡冲突
        const sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
    }

    function positionCard(rect) {
        const cw = card.offsetWidth || 260;
        const ch = card.offsetHeight || 120;
        const vw = window.innerWidth || 360;
        const vh = window.innerHeight || 600;
        let left = rect ? rect.left + rect.width / 2 - cw / 2 : 12;
        left = Math.min(Math.max(8, left), Math.max(8, vw - cw - 8));
        let top = rect ? rect.bottom + 8 : 60;
        if (rect && top + ch > vh - 8 && rect.top - ch - 8 >= 0) top = rect.top - ch - 8;
        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(Math.min(top, Math.max(8, vh - ch - 8)))}px`;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function renderWordCard(result, rect) {
        cancelCardHide();
        card.textContent = "";
        const revision = state.tipRevision;
        const head = el("div", "sp-card-head");
        head.appendChild(el("span", "sp-card-word", result.word));
        if (result.phonetic) head.appendChild(el("span", "sp-card-phonetic", result.phonetic));
        const speak = el("button", "sp-card-speak", "🔊");
        speak.type = "button";
        speak.setAttribute("aria-label", "朗读单词");
        speak.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleSpeech(result.word, speak);
        });
        head.appendChild(speak);
        card.appendChild(head);

        for (const entry of result.entries || []) {
            const row = el("div", "sp-card-row");
            if (entry.pos) row.appendChild(el("span", "sp-card-pos", entry.pos));
            row.appendChild(el("span", "sp-card-mean", (entry.variants || []).join("；")));
            card.appendChild(row);
        }

        const actions = el("div", "sp-card-actions");
        const save = el("button", "sp-card-save", "收藏");
        save.type = "button";
        save.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            saveWord(result, save);
        });
        actions.appendChild(save);
        card.appendChild(actions);

        card.hidden = false;
        positionCard(rect);
        // 自动朗读新词
        if (revision === state.tipRevision && speechAvailable()) speakText(result.word);
    }

    function renderSelectionCard(rect) {
        cancelCardHide();
        card.textContent = "";
        const result = state.selResult;
        const head = el("div", "sp-card-head");
        head.appendChild(el("span", "sp-card-word", result ? result.sourceText : state.pendingSelection || "翻译中"));
        card.appendChild(head);
        if (state.selError) card.appendChild(el("div", "sp-card-error", state.selError));
        if (result) {
            card.appendChild(el("div", "sp-card-translation", result.translatedText || ""));
            if (result.contextText) card.appendChild(el("div", "sp-card-context", result.contextText));
        } else if (!state.selError) {
            card.appendChild(el("div", "sp-card-status", "翻译中…"));
        }
        const actions = el("div", "sp-card-actions");
        const save = el("button", "sp-card-save", state.selSaved ? "已收藏 ✓" : "收藏");
        save.type = "button";
        save.disabled = !result || state.selSaving || state.selSaved;
        save.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            saveSelection();
        });
        actions.appendChild(save);
        if (result && speechAvailable()) {
            const speak = el("button", "sp-card-speak", "🔊");
            speak.type = "button";
            speak.setAttribute("aria-label", "朗读");
            speak.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleSpeech(result.sourceText, speak);
            });
            actions.appendChild(speak);
        }
        card.appendChild(actions);
        card.hidden = false;
        positionCard(rect);
    }

    // --- 单词查词 ---
    function scheduleWord(word, range, rect) {
        clearTimeout(state.hoverTimer);
        state.pendingWord = word;
        const cached = wordCache.get(word);
        if (cached) {
            showWord(cached, range, rect);
            return;
        }
        state.hoverTimer = setTimeout(async () => {
            state.hoverTimer = 0;
            if (state.pendingWord !== word || state.dragging || state.selBusy) return;
            try {
                const response = await runtimeSend({type: "LOOKUP_WORD", word}, 9000);
                if (state.pendingWord !== word) return;
                if (!response || !response.ok || !response.result) {
                    if (state.tipWord === word) hideCard();
                    return;
                }
                if (wordCache.size > 300) wordCache.delete(wordCache.keys().next().value);
                wordCache.set(word, response.result);
                showWord(response.result, range, rect);
            } catch (_) {
                if (state.pendingWord === word && state.tipWord !== word) hideCard();
            }
        }, HOVER_DELAY_MS);
    }

    function showWord(result, range, rect) {
        state.tipResult = result;
        state.tipWord = result.word;
        state.tipRevision++;
        state.selResult = null;
        // 单词高亮走 CSS Highlight，真实选区必须清空，否则 pointermove 会
        // 把残留选区当成划词而屏蔽后续 hover 取词。
        const sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
        highlight(range);
        renderWordCard(result, rect);
    }

    // --- 划词翻译 ---
    async function translateSelection(text, rect, contextText) {
        const revision = ++state.selRevision;
        state.selBusy = true;
        state.selError = "";
        state.selResult = null;
        state.pendingSelection = text;
        state.tipWord = "";
        state.tipResult = null;
        clearHoverHighlight();
        renderSelectionCard(rect);
        try {
            const response = await runtimeSend({
                type: "SELECTION_TRANSLATE",
                sourceText: text,
                contextText: contextText || "",
                sourceUrl: state.sourceUrl,
                sourceTitle: state.sourceTitle
            }, 130000);
            if (revision !== state.selRevision) return;
            if (!response || !response.ok) throw new Error((response && response.error) || "翻译失败");
            state.selResult = response;
        } catch (error) {
            if (revision !== state.selRevision) return;
            state.selError = "翻译失败：" + ((error && error.message) || "请重试");
        } finally {
            if (revision === state.selRevision) {
                state.selBusy = false;
                renderSelectionCard(rect);
            }
        }
    }

    // 收藏成功后延时收起卡片，revision 守卫防止误关之后新开的卡片。
    function hideCardAfterSave(kind, revision) {
        setTimeout(() => {
            const current = kind === "word" ? state.tipRevision : state.selRevision;
            if (revision === current) hideCard();
        }, SAVED_HIDE_MS);
    }

    async function saveSelection() {
        if (!state.selResult || state.selSaving || state.selSaved) return;
        state.selSaving = true;
        const revision = state.selRevision;
        renderSelectionCard(state.selRect);
        try {
            await runtimeSend({type: "VOCABULARY", action: "add", entry: state.selResult}, 8000);
            if (revision !== state.selRevision) return;
            state.selSaved = true;
            hideCardAfterSave("selection", revision);
        } catch (error) {
            if (revision !== state.selRevision) return;
            state.selError = "收藏失败：" + ((error && error.message) || "请重试");
            renderSelectionCard(state.selRect);
        } finally {
            if (revision === state.selRevision) state.selSaving = false;
        }
    }

    async function saveWord(result, button) {
        if (state.savingWord) return;
        state.savingWord = true;
        const revision = state.tipRevision;
        if (button) button.textContent = "收藏中…";
        try {
            const entry = {
                sourceText: result.word,
                translatedText: (result.entries || []).map((e) => (e.variants || []).join("；")).filter(Boolean).join(" / "),
                sourceLanguage: state.sourceLanguage,
                targetLanguage: state.targetLanguage,
                contextText: "",
                sourceUrl: state.sourceUrl,
                sourceTitle: state.sourceTitle
            };
            await runtimeSend({type: "VOCABULARY", action: "add", entry}, 8000);
            if (revision !== state.tipRevision) return;
            if (button) { button.textContent = "已收藏 ✓"; button.disabled = true; }
            hideCardAfterSave("word", revision);
        } catch (_) {
            if (revision === state.tipRevision && button) button.textContent = "收藏失败";
        } finally {
            if (revision === state.tipRevision) state.savingWord = false;
        }
    }

    // --- 朗读 ---
    function speechAvailable() {
        return typeof window !== "undefined" && "speechSynthesis" in window;
    }
    function stopSpeech() {
        if (speechAvailable()) window.speechSynthesis.cancel();
        state.speakingText = "";
    }
    function speakText(text) {
        if (!speechAvailable() || !text) return;
        try {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = "en-US";
            utter.rate = 0.92;
            window.speechSynthesis.speak(utter);
            state.speakingText = text;
        } catch (_) { /* 朗读不可用时静默 */ }
    }
    function toggleSpeech(text, button) {
        if (state.speakingText === text) {
            stopSpeech();
            if (button) button.classList.remove("speaking");
        } else {
            speakText(text);
            if (button) button.classList.add("speaking");
        }
    }

    // --- 点击字幕行跳转到视频对应时间播放 ---
    async function seekToRow(row) {
        const raw = row && row.getAttribute && row.getAttribute("data-start-ms");
        const startMs = Number(raw);
        if (!row || !Number.isFinite(startMs) || startMs < 0) return;
        try {
            const response = await runtimeSend({type: "SIDE_PANEL_SEEK", startMs}, 8000);
            if (response && response.ok === false) {
                count.textContent = (response.error || "跳转失败") + "（共 " + state.cues.length + " 条）";
            }
        } catch (_) { /* 跳转失败静默，不影响阅读 */ }
    }

    // --- 事件绑定（捕获阶段，兼容拖选多词） ---
    list.addEventListener("click", (event) => {
        // 有选区（划词/取词）时不跳转，避免清掉选区和词卡。
        const sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed) return;
        const row = event.target.closest && event.target.closest(".sp-cue-row");
        if (row) seekToRow(row);
    });

    list.addEventListener("pointerdown", () => {
        state.dragging = true;
        clearTimeout(state.hoverTimer);
    }, true);
    list.addEventListener("pointerup", (event) => {
        state.dragging = false;
        setTimeout(() => {
            const hit = readSelection();
            if (hit) {
                // 有选区：单词则补查词卡，多词则翻译卡。不触发任何跳转。
                if (WORD_RE.test(hit.text)) {
                    const word = hit.text.toLowerCase();
                    const cached = wordCache.get(word);
                    if (cached) showWord(cached, window.getSelection().getRangeAt(0), hit.rect);
                    else scheduleWord(word, window.getSelection().getRangeAt(0), hit.rect);
                } else {
                    state.selRect = hit.rect;
                    translateSelection(hit.text, hit.rect, hit.text);
                }
            } else {
                // 纯点击：单词悬停取词交给 pointermove，这里只收起残留卡片
                if (!state.tipWord && !state.selResult) hideCard();
            }
        }, 0);
    }, true);

    list.addEventListener("pointermove", (event) => {
        if (state.dragging || (event.buttons & 1)) return;
        const sel = window.getSelection && window.getSelection();
        const hasSelection = sel && !sel.isCollapsed;
        const hit = hasSelection ? null : wordAtPoint(event.clientX, event.clientY);
        if (hit) {
            // 光标停在某个词上：取消收起（无论是当前词卡还是准备取新词）
            cancelCardHide();
            if (state.selBusy || state.selResult) return; // 划词卡打开时不弹单词卡
            if (hit.word !== state.tipWord && hit.word !== state.pendingWord) {
                scheduleWord(hit.word, hit.range, hit.rect);
            }
        } else if (!hasSelection && !state.selBusy && !state.selResult && !card.hidden && !state.overCard) {
            // 光标移到字幕空白处：延时收起单词卡（划词卡交给 pointerleave/card 处理）
            scheduleCardHide(CARD_LEAVE_MS);
        }
    }, true);

    list.addEventListener("pointerleave", () => {
        clearTimeout(state.hoverTimer);
        state.pendingWord = "";
        // 离开字幕列表后延时收起：给足时间让用户把光标移到浮层卡片上点按钮
        if (!card.hidden && !state.overCard) scheduleCardHide(CARD_LEAVE_MS);
    });

    // 光标进出卡片：进入时取消收起（保证能点收藏/朗读），离开后较快收起
    card.addEventListener("pointerenter", () => {
        state.overCard = true;
        cancelCardHide();
    });
    card.addEventListener("pointerleave", () => {
        state.overCard = false;
        scheduleCardHide(CARD_OUT_MS);
    });

    search.addEventListener("input", () => {
        state.query = String(search.value || "").trim().toLocaleLowerCase();
        render();
    });
    refresh.addEventListener("click", () => loadTranscript());
    if (hideToggle) hideToggle.addEventListener("change", () => {
        state.hideTranslation = Boolean(hideToggle.checked);
        saveHidePreference();
        render();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !card.hidden) hideCard();
    });

    loadHidePreference();
    loadTranscript();
})();
