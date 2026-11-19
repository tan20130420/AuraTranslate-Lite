// Selection UI lives in a shadow root so webpage styles cannot alter its controls.
// React renders the toolbar and card; this controller owns selection capture,
// translation, copy fallbacks and the shadow host.
(function () {
    "use strict";
    const Core = globalThis.YTBTCore;
    if (!Core || !globalThis.chrome?.runtime || globalThis.YTBTSelection) return;
    const state = {ready: false, enabled: true, autoTranslate: true, selecting: false, revision: 0,
        selection: null, host: null, shadow: null, container: null, view: null, result: null,
        translating: false, saving: false, saved: false, error: "",
        toolbar: Core.normalizeSelectionToolbar(), copied: false, toolbarError: "", pinned: []};
    globalThis.YTBTSelection = {state, dismiss};
    let timer;
    const EDITABLE = "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']";
    const OWN_UI = "[data-ytbt-selection-root],[data-ytbt-immersive-root],script,style,noscript";
    const elementOf = (node) => node?.nodeType === 1 ? node : node?.parentElement;
    const send = (message) => Core.sendRuntimeMessage(chrome.runtime, message, 130000).then((result) => {
        if (!result?.ok) throw new Error(result?.error || "扩展未返回结果，请重试。");
        return result;
    });
    const hover = () => globalThis.YTBTHover;
    const suspendVideo = () => hover()?.suspend("selection");
    const releaseVideo = () => hover()?.release("selection");

    async function copyInto(shadow, text) {
        if (!text) return false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {
            // fall through to the synchronous fallback below
        }
        const area = document.createElement("textarea");
        area.value = text;
        area.readOnly = true;
        area.style.cssText = "position:fixed!important;left:0!important;top:0!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important";
        const parent = shadow || document.body;
        parent.appendChild(area);
        try {
            area.select();
            return Boolean(document.execCommand && document.execCommand("copy"));
        } finally {
            area.remove();
        }
    }

    function dismiss() {
        clearTimeout(timer);
        state.revision++;
        const hadHost = Boolean(state.host);
        state.host?.remove();
        const view = state.view;
        state.view = null;
        Object.assign(state, {host: null, shadow: null, container: null, selection: null, result: null,
            translating: false, saving: false, saved: false, error: "", copied: false, toolbarError: ""});
        if (hadHost) releaseVideo();
        if (view) view.unmount();
    }

    function readSelection(anchor) {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed || elementOf(document.activeElement)?.closest(EDITABLE)) return null;
        const range = selection.getRangeAt(0);
        const start = elementOf(range.startContainer), end = elementOf(range.endContainer);
        if (!start || !end || start.closest(`${EDITABLE},${OWN_UI}`) || end.closest(`${EDITABLE},${OWN_UI}`)) return null;
        const originalText = selection.toString();
        const sourceText = originalText.replace(/\s+/g, " ").trim();
        if (!sourceText || sourceText.length > Core.SELECTION_MAX_CHARS) return null;
        const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
        if (!rect || (!rect.width && !rect.height)) return null;
        const block = start.closest("p,li,blockquote,figcaption,td,dd,h1,h2,h3,h4,h5,h6,article,main") || start;
        const clone = block.cloneNode(true);
        for (const node of clone.querySelectorAll("[data-ytbt-immersive-translation],script,style,[data-ytbt-selection-root]")) node.remove();
        const context = (clone.textContent || "").replace(/\s+/g, " ").trim();
        const index = context.toLowerCase().indexOf(sourceText.toLowerCase());
        const offset = Math.max(0, index - 600);
        return {sourceText, originalText, contextText: context.slice(offset, offset + 1800),
            sourceUrl: location.href, sourceTitle: document.title, rect, anchor: anchor || null};
    }

    function capture(anchor) {
        if (!state.ready || !state.enabled) return false;
        // Selecting/copying the result or focusing its buttons keeps the card open.
        if (document.activeElement === state.host || window.getSelection()?.anchorNode?.getRootNode() === state.shadow ||
            state.host?.contains(window.getSelection()?.anchorNode)) return false;
        const selection = readSelection(anchor);
        if (!selection) { if (state.host && !state.translating) dismiss(); return false; }
        if (state.selection?.originalText === selection.originalText && state.selection?.contextText === selection.contextText &&
            state.selection?.sourceUrl === selection.sourceUrl) {
            state.selection.rect = selection.rect;
            if (anchor) state.selection.anchor = anchor;
            position();
            return false;
        }
        dismiss();
        state.selection = selection;
        mount();
        render();
        return true;
    }

    function schedule(anchor) {
        clearTimeout(timer);
        if (state.selecting) return;
        timer = setTimeout(() => capture(anchor), 160);
    }

    function mount() {
        const host = document.createElement("div");
        host.dataset.ytbtSelectionRoot = "";
        host.dataset.ytbtImmersiveRoot = "";
        host.style.cssText = "all:initial!important;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;";
        state.host = host;
        state.shadow = host.attachShadow({mode: "open"});
        state.container = document.createElement("div");
        state.shadow.append(state.container);
        document.documentElement.append(host);
        suspendVideo();
        if (globalThis.AuraContentUI) {
            state.view = globalThis.AuraContentUI.mountSelection(state.container, selectionProps());
        }
    }

    function selectionProps() {
        const mode = !state.translating && !state.result && !state.error ? "toolbar" : "card";
        return {
            mode,
            toolbar: state.toolbar,
            selection: state.selection,
            result: state.result,
            translating: state.translating,
            saving: state.saving,
            saved: state.saved,
            error: state.error,
            copied: state.copied,
            copiedText: "",
            pinned: false,
            toolbarError: state.toolbarError,
            onAction: handleSelectionAction
        };
    }

    function handleSelectionAction(action) {
        if (action === "translate" || action === "retry") translate();
        else if (action === "copy") copySelection();
        else if (action === "vocabulary" || action === "book") openBook();
        else if (action === "save") saveWord();
        else if (action === "pin") pinCurrent();
        else if (action === "dismiss") dismiss();
    }

    function pinnedProps(entry) {
        return {
            mode: "card",
            toolbar: state.toolbar,
            selection: entry.selection,
            result: entry.result,
            translating: false,
            saving: entry.saving,
            saved: entry.saved,
            error: entry.error,
            copied: false,
            copiedText: entry.copiedText,
            pinned: true,
            toolbarError: "",
            onAction: (action) => handlePinnedAction(entry, action)
        };
    }

    function renderPinned(entry) {
        if (!entry || !entry.shadow || !entry.view) return;
        entry.view.update(pinnedProps(entry));
    }

    function mountPinned(entry) {
        const host = document.createElement("div");
        host.dataset.ytbtSelectionRoot = "";
        host.dataset.ytbtSelectionPinned = "";
        host.style.cssText = "all:initial!important;position:fixed!important;top:12px!important;right:12px!important;z-index:2147483646!important;pointer-events:none!important;max-width:calc(100vw - 24px)!important;";
        entry.host = host;
        entry.shadow = host.attachShadow({mode: "open"});
        entry.container = document.createElement("div");
        entry.shadow.append(entry.container);
        document.documentElement.append(host);
        if (globalThis.AuraContentUI) {
            entry.view = globalThis.AuraContentUI.mountSelection(entry.container, pinnedProps(entry));
        }
    }

    function unpin(entry) {
        const index = state.pinned.indexOf(entry);
        if (index < 0) return;
        state.pinned.splice(index, 1);
        entry.host?.remove();
        entry.view?.unmount();
    }

    function pinCurrent() {
        if (!state.selection || !state.result) return;
        const entry = {
            selection: {...state.selection, anchor: null, rect: null},
            result: {...state.result},
            saving: false, saved: state.saved, error: "", copiedText: ""
        };
        mountPinned(entry);
        state.pinned.push(entry);
        dismiss();
    }

    function handlePinnedAction(entry, action) {
        if (action === "dismiss" || action === "unpin") unpin(entry);
        else if (action === "book") openBook();
        else if (action === "save") savePinnedWord(entry);
        else if (action === "copy-source") copyPinned(entry, "source");
        else if (action === "copy-translation") copyPinned(entry, "translation");
    }

    async function savePinnedWord(entry) {
        if (!entry || !entry.result || entry.saving || entry.saved) return;
        entry.saving = true;
        entry.error = "";
        renderPinned(entry);
        try {
            await send({type: "VOCABULARY", action: "add", entry: entry.result});
            entry.saved = true;
        } catch (error) {
            entry.error = `收藏失败：${error.message}`;
        } finally {
            entry.saving = false;
            renderPinned(entry);
        }
    }

    async function copyPinned(entry, kind) {
        if (!entry) return;
        const text = kind === "source" ? entry.selection?.originalText : entry.result?.translatedText;
        try {
            const ok = await copyInto(entry.shadow, text);
            entry.copiedText = ok ? kind : "";
            entry.error = ok ? "" : "无法复制，请使用系统复制菜单或 Ctrl/Cmd+C。";
        } catch (_) {
            entry.copiedText = "";
            entry.error = "无法复制，请使用系统复制菜单或 Ctrl/Cmd+C。";
        }
        renderPinned(entry);
    }

    function render() {
        if (!state.shadow || !state.selection || !state.view) return;
        const focusedAction = state.shadow.activeElement?.dataset.action;
        state.view.update(selectionProps());
        if (focusedAction) state.shadow.querySelector(`[data-action="${focusedAction}"]`)?.focus();
        position();
    }

    function position() {
        if (!state.host || !state.selection) return;
        const selected = window.getSelection();
        if (selected?.rangeCount && selected.anchorNode?.getRootNode() !== state.shadow &&
            selected.toString().replace(/\s+/g, " ").trim() === state.selection.sourceText) {
            const range = selected.getRangeAt(0);
            if (typeof range.getBoundingClientRect === "function") {
                const rect = range.getBoundingClientRect();
                if (rect.width || rect.height) state.selection.rect = rect;
            }
        }
        const rect = state.selection.rect;
        const viewport = window.visualViewport;
        const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
        const rightEdge = leftEdge + (viewport?.width || innerWidth);
        const bottomEdge = topEdge + (viewport?.height || innerHeight);
        const surface = state.shadow.querySelector(".surface");
        const isToolbar = surface.classList.contains("selection-toolbar");
        const width = surface.offsetWidth || (isToolbar ? 28 : 360), height = surface.offsetHeight || (isToolbar ? 28 : 44);
        // 译文卡片跟随松开左键的位置，跨行长句不会跑到选区末尾；
        // 工具栏仍按选区矩形定位，保持原有手动模式体验。
        const anchor = !isToolbar && state.selection.anchor;
        const leftRef = anchor ? anchor.x : rect.right;
        const below = anchor ? anchor.y + 14 : rect.bottom + 6;
        const above = anchor ? anchor.y - height - 14 : rect.top - height - 6;
        state.host.style.setProperty("left", `${Math.max(leftEdge + 8, Math.min(leftRef, rightEdge - width - 8))}px`, "important");
        const preferAbove = isToolbar && state.toolbar.position === "above";
        const top = preferAbove ? (above >= topEdge + 8 ? above : below) :
            (below + height <= bottomEdge - 8 ? below : above);
        state.host.style.setProperty("top", `${Math.max(topEdge + 8, Math.min(top, bottomEdge - height - 8))}px`, "important");
    }

    async function copySelection() {
        if (!state.selection) return;
        const revision = state.revision;
        const text = state.selection.originalText;
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else {
                // HTTP pages may not expose Clipboard API. Keep a synchronous fallback in the user gesture.
                const selection = window.getSelection();
                const ranges = Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange());
                const focused = state.shadow.activeElement || document.activeElement;
                const input = document.createElement("textarea");
                input.value = text;
                input.readOnly = true;
                input.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
                state.shadow.append(input);
                try {
                    input.select();
                    if (!document.execCommand?.("copy")) throw new Error("clipboard unavailable");
                } finally {
                    input.remove();
                    selection.removeAllRanges();
                    ranges.forEach(range => selection.addRange(range));
                    focused?.focus({preventScroll: true});
                }
            }
            if (revision === state.revision) { state.copied = true; state.toolbarError = ""; }
        } catch (_) {
            if (revision === state.revision) { state.copied = false; state.toolbarError = "无法复制，请使用系统复制菜单或 Ctrl/Cmd+C。"; }
        }
        if (revision === state.revision) render();
    }

    async function translate() {
        if (!state.selection || state.translating) return;
        const revision = state.revision, selection = state.selection;
        state.translating = true;
        state.error = "";
        render();
        try {
            const {rect, originalText, ...payload} = selection;
            const result = await send({type: "SELECTION_TRANSLATE", ...payload});
            if (revision !== state.revision) return;
            if (location.href !== selection.sourceUrl) { dismiss(); return; }
            state.result = result;
        } catch (error) {
            if (revision !== state.revision) return;
            state.error = `翻译失败：${error.message}`;
        } finally {
            if (revision === state.revision) { state.translating = false; render(); }
        }
    }

    async function saveWord() {
        if (!state.result || state.saving || state.saved) return;
        const revision = state.revision;
        state.saving = true;
        state.error = "";
        render();
        try {
            await send({type: "VOCABULARY", action: "add", entry: state.result});
            if (revision === state.revision) state.saved = true;
        } catch (error) {
            if (revision === state.revision) state.error = `收藏失败：${error.message}`;
        } finally {
            if (revision === state.revision) { state.saving = false; render(); }
        }
    }

    async function openBook() {
        const revision = state.revision;
        try { await send({type: "OPEN_VOCABULARY"}); }
        catch (error) {
            if (revision === state.revision) { state.error = `无法打开生词本：${error.message}`; render(); }
        }
    }

    const inOwnUI = (event) => {
        const path = event.composedPath ? event.composedPath() : [];
        return path.some(node => node === state.host || (node && node.dataset && node.dataset.ytbtSelectionPinned !== undefined));
    };

    function handlePointerUp(event) {
        if (event.button !== undefined && event.button !== 0) { schedule(); return; }
        const wasSelecting = state.selecting;
        state.selecting = false;
        if (!wasSelecting) { schedule(); return; }
        const anchor = {x: event.clientX || 0, y: event.clientY || 0};
        if (state.autoTranslate && state.enabled) {
            // 松开左键即把这次选区作为一整段翻译，不拆词。
            clearTimeout(timer);
            const previous = state.selection?.originalText;
            capture(anchor);
            if (state.selection && state.selection.originalText !== previous) translate();
        } else {
            schedule(anchor);
        }
    }

    document.addEventListener("selectionchange", schedule);
    // 悬浮字幕面板在自己的根节点上 stopPropagation()，冒泡阶段的 pointerup 到不了 document，
    // 会导致在字幕列表里拖选后 state.selecting 一直为 true、永远不触发即译。
    // 捕获阶段先于目标节点执行，不受面板拦截影响。
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("keyup", (event) => {
        if (event.key === "Escape") dismiss();
        else if (event.key.startsWith("Arrow") || event.key === "Shift") {
            if (state.autoTranslate && state.enabled) {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const previous = state.selection?.originalText;
                    if (capture(null) && state.selection && state.selection.originalText !== previous) translate();
                }, 200);
            } else schedule();
        }
    }, true);
    document.addEventListener("pointerdown", (event) => {
        if (event.button === 0 && !inOwnUI(event)) state.selecting = true;
        if (state.host && !event.composedPath().includes(state.host)) dismiss();
    }, true);
    document.addEventListener("scroll", (event) => {
        if (state.host && !event.composedPath().includes(state.host)) dismiss();
    }, true);
    window.addEventListener("resize", position);
    window.addEventListener("blur", () => {
        state.selecting = false;
        if (document.activeElement?.tagName === "IFRAME") dismiss();
    });
    window.visualViewport?.addEventListener("resize", position);
    window.addEventListener("popstate", dismiss);
    window.addEventListener("hashchange", dismiss);
    chrome.storage.onChanged?.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.selectionTranslationEnabled) state.enabled = changes.selectionTranslationEnabled.newValue !== false;
        if (changes.selectionAutoTranslate) state.autoTranslate = changes.selectionAutoTranslate.newValue !== false;
        if (changes.selectionToolbar) state.toolbar = Core.normalizeSelectionToolbar(changes.selectionToolbar.newValue);
        if (!state.enabled) dismiss();
        else if (changes.selectionToolbar) render();
    });
    chrome.storage.local.get({selectionTranslationEnabled: true, selectionAutoTranslate: true,
        selectionToolbar: Core.DEFAULT_SETTINGS.selectionToolbar}, (settings) => {
        const error = chrome.runtime.lastError;
        if (error) return;
        state.enabled = settings.selectionTranslationEnabled !== false;
        state.autoTranslate = settings.selectionAutoTranslate !== false;
        state.toolbar = Core.normalizeSelectionToolbar(settings.selectionToolbar);
        state.ready = true;
        capture();
    });
})();
