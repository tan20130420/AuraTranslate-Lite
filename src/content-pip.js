/*
 * AuraTranslate content script — Document Picture-in-Picture subtitle LIST window.
 * Load order: after shared scripts / content-controls.js, before content-main.js.
 * 顶层一律用 var/function 声明，避免重复注入时报重复声明。
 *
 * 正式版：窗口里是完整的字幕列表（搜索 / 当前行高亮跟随 / 点行跳转），
 * 数据由 syncPipSubtitle() 每帧通过 ytbtPipSyncList() 从真实字幕同步。
 * 窗口是独立 document，样式、事件、React 都跨不过来，所以这里用原生 DOM。
 */

var ytbtPipWindow = null;
var ytbtPipStyleNode = null;
var ytbtPipOnClose = null;
var ytbtPipOptions = {showHeader: true, fontScale: 1, opacity: 0.82};

// 列表状态：全量行（含 cue 下标，供点击跳转）与已渲染的 DOM 行一一对应。
var ytbtPipListRows = [];
var ytbtPipListRowEls = [];
var ytbtPipListQuery = "";
var ytbtPipListFollow = true;
var ytbtPipSeekHandler = null;
var ytbtPipListBound = [];
var ytbtPipListMaxRows = 600;

function ytbtPipSupported() {
    try {
        return !!(window.documentPictureInPicture &&
            typeof window.documentPictureInPicture.requestWindow === "function");
    } catch (_) {
        return false;
    }
}

function ytbtPipIsOpen() {
    return !!(ytbtPipWindow && !ytbtPipWindow.closed);
}

function ytbtPipVideoTitle() {
    let title = String((typeof document !== "undefined" && document.title) || "AuraTranslate 字幕")
        .replace(/\s*-\s*YouTube\s*$/i, "")
        .replace(/\s*-\s*Google Chrome\s*$/i, "")
        .trim();
    return title || "AuraTranslate 字幕";
}

function ytbtPipNormalizeOptions(options) {
    const source = options && typeof options === "object" ? options : {};
    const scale = Number(source.fontScale);
    const opacity = Number(source.opacity);
    return {
        showHeader: source.showHeader !== false,
        fontScale: Number.isFinite(scale) ? Math.min(1.8, Math.max(0.6, scale)) : 1,
        opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.3, opacity)) : 0.82
    };
}

function ytbtPipTimeLabel(ms) {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    return (hours ? `${hours}:` : "") +
        `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ytbtPipStyles(options) {
    const opt = ytbtPipNormalizeOptions(options);
    const enSize = Math.round(15 * Math.min(1.6, opt.fontScale));
    const zhSize = Math.round(12.5 * Math.min(1.5, opt.fontScale));
    const headSize = Math.round(13 * Math.min(1.2, opt.fontScale));
    const hideHeader = opt.showHeader
        ? ""
        : ".ytbt-pip-head,.ytbt-pip-progress,.ytbt-pip-foot{display:none;}";
    return [
        "html,body{margin:0;padding:0;height:100%;}",
        "body{background:rgba(10,12,18," + opt.opacity + ");color:#f3f4f6;box-sizing:border-box;overflow:hidden;",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;}",
        ".ytbt-pip{display:flex;flex-direction:column;height:100%;padding:10px 12px;}",
        ".ytbt-pip-head{display:flex;align-items:baseline;gap:12px;}",
        ".ytbt-pip-title{flex:1;font-size:" + headSize + "px;opacity:0.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
        ".ytbt-pip-time{font-size:" + Math.max(10, headSize - 1) + "px;opacity:0.62;font-variant-numeric:tabular-nums;}",
        ".ytbt-pip-progress{height:3px;background:rgba(255,255,255,0.16);border-radius:2px;margin:8px 0;overflow:hidden;}",
        ".ytbt-pip-progress-fill{height:100%;width:0;background:#4caf7d;transition:width 0.2s linear;}",
        ".ytbt-pip-tools{display:flex;align-items:center;gap:10px;margin-bottom:7px;}",
        ".ytbt-pip-search{flex:1;min-width:0;padding:5px 9px;border:1px solid rgba(255,255,255,0.16);border-radius:6px;",
        "background:rgba(255,255,255,0.08);color:#f3f4f6;font-size:12px;font-family:inherit;outline:none;}",
        ".ytbt-pip-search::placeholder{color:rgba(243,244,246,0.45);}",
        ".ytbt-pip-count{flex:none;font-size:11px;opacity:0.55;white-space:nowrap;font-variant-numeric:tabular-nums;}",
        ".ytbt-pip-follow{display:flex;align-items:center;gap:4px;flex:none;font-size:11px;opacity:0.75;white-space:nowrap;cursor:pointer;}",
        ".ytbt-pip-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;}",
        ".ytbt-cue-row{display:flex;gap:9px;width:100%;padding:6px 8px;border-radius:6px;box-sizing:border-box;cursor:pointer;}",
        ".ytbt-cue-row:hover{background:rgba(255,255,255,0.08);}",
        '.ytbt-cue-row[aria-current="true"]{background:rgba(76,175,125,0.2);box-shadow:inset 3px 0 #4caf7d;}',
        ".ytbt-cue-row[hidden]{display:none!important;}",
        ".ytbt-cue-time{flex:none;width:48px;padding-top:2px;font-size:11px;opacity:0.5;font-variant-numeric:tabular-nums;}",
        ".ytbt-cue-body{flex:1;min-width:0;}",
        ".ytbt-cue-source{display:block;font-size:" + enSize + "px;line-height:1.35;overflow-wrap:anywhere;}",
        ".ytbt-cue-translation{display:block;font-size:" + zhSize + "px;line-height:1.4;opacity:0.72;overflow-wrap:anywhere;}",
        ".ytbt-pip-empty{padding:24px 8px;text-align:center;font-size:12px;opacity:0.45;}",
        ".ytbt-pip-foot{font-size:11px;opacity:0.48;text-align:center;margin-top:5px;}",
        // 词卡 CSS 不跨 document，画中画窗口必须自带一份（与 overlay.css 的悬停词卡一致）。
        ".ytbt-wordtip{position:fixed;z-index:2147483647;min-width:140px;max-width:300px;padding:9px 11px;",
        "border-radius:10px;background:#16181c;border:1px solid rgba(8,145,178,0.45);",
        "box-shadow:0 8px 28px rgba(0,0,0,0.7);color:#f3f4f6;font-family:-apple-system,'Segoe UI','Microsoft YaHei',Arial,sans-serif;",
        "font-size:13px;line-height:1.5;text-align:left;text-shadow:none;pointer-events:auto;user-select:text;cursor:default;}",
        ".ytbt-wordtip[hidden]{display:none!important;}",
        ".ytbt-wordtip-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px;}",
        ".ytbt-wordtip-word{font-size:15px;font-weight:600;color:#67e8f9;}",
        ".ytbt-wordtip-phonetic{font-size:12px;color:#9ca3af;}",
        ".ytbt-wordtip-speak{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;",
        "padding:0;flex:none;border:1px solid rgba(255,255,255,0.14);border-radius:6px;background:rgba(255,255,255,0.06);",
        "color:#67e8f9;font-size:13px;line-height:1;cursor:pointer;}",
        ".ytbt-wordtip-speak:hover{background:rgba(103,232,249,0.16);}",
        ".ytbt-wordtip-speak.speaking{background:#0891b2;border-color:#06b6d4;color:#fff;}",
        ".ytbt-wordtip-row{display:flex;gap:6px;align-items:baseline;margin-top:2px;}",
        ".ytbt-wordtip-pos{flex:none;font-size:11px;color:#fbbf24;font-family:Consolas,Menlo,monospace;}",
        ".ytbt-wordtip-mean{flex:1;overflow-wrap:anywhere;}",
        ".ytbt-wordtip-actions{display:flex;justify-content:flex-end;margin-top:7px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);}",
        ".ytbt-wordtip-save{padding:3px 11px;border:none;border-radius:6px;background:linear-gradient(135deg,#0891b2,#06b6d4);",
        "color:#fff;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;}",
        ".ytbt-wordtip-save:hover:not(:disabled){background:linear-gradient(135deg,#0e7490,#0891b2);}",
        ".ytbt-wordtip-save:disabled{opacity:0.7;cursor:default;}",
        // 画中画划词译文卡片（原生 DOM，样式同样不跨 document）。
        ".ytbt-pipsel{position:fixed;z-index:2147483647;width:320px;max-width:calc(100vw - 16px);",
        "padding:10px 12px;border-radius:10px;background:#16181c;border:1px solid rgba(8,145,178,0.45);",
        "box-shadow:0 8px 28px rgba(0,0,0,0.7);color:#f3f4f6;font-family:-apple-system,'Segoe UI','Microsoft YaHei',Arial,sans-serif;",
        "font-size:13px;line-height:1.5;text-align:left;text-shadow:none;pointer-events:auto;user-select:text;}",
        ".ytbt-pipsel[hidden]{display:none!important;}",
        ".ytbt-pipsel-source{font-size:12px;color:#67e8f9;max-height:44px;overflow:auto;}",
        ".ytbt-pipsel-result{margin-top:5px;font-size:14px;overflow-wrap:anywhere;max-height:96px;overflow:auto;}",
        ".ytbt-pipsel-actions{display:flex;gap:8px;align-items:center;margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.1);}",
        ".ytbt-pipsel-actions button{padding:3px 10px;border:1px solid rgba(255,255,255,0.14);border-radius:6px;",
        "background:rgba(255,255,255,0.06);color:#e5e7eb;font-size:12px;font-family:inherit;cursor:pointer;}",
        ".ytbt-pipsel-actions button:hover:not(:disabled){background:rgba(103,232,249,0.16);}",
        ".ytbt-pipsel-save{border:none!important;background:linear-gradient(135deg,#0891b2,#06b6d4)!important;color:#fff!important;}",
        ".ytbt-pipsel-save:disabled{opacity:0.6;cursor:default;}",
        ".ytbt-pipsel-close{margin-left:auto;}",
        "::highlight(ytbt-word){background-color:rgba(34,211,238,0.4);color:inherit;}",
        hideHeader
    ].join("");
}

function ytbtPipBindHover(pip) {
    try {
        if (typeof globalThis !== "undefined" && globalThis.YTBTHover &&
            typeof globalThis.YTBTHover.bindPip === "function") {
            globalThis.YTBTHover.bindPip(pip);
        }
    } catch (_) { /* 取词模块未加载时静默降级 */ }
}

function ytbtPipUnbindHover() {
    try {
        if (typeof globalThis !== "undefined" && globalThis.YTBTHover &&
            typeof globalThis.YTBTHover.unbindPip === "function") {
            globalThis.YTBTHover.unbindPip();
        }
    } catch (_) { /* 取词模块未加载时静默降级 */ }
}

// 外部（content-controls.js）注入：点列表行时跳转视频。
function ytbtPipSetSeekHandler(fn) {
    ytbtPipSeekHandler = typeof fn === "function" ? fn : null;
}

// 幂等写入头部：updateOverlay() 每帧调用，文本未变化时不再赋值 DOM。
function ytbtPipWrite(payload) {
    if (!ytbtPipIsOpen() || !payload) return false;
    try {
        const doc = ytbtPipWindow.document;
        const setText = (selector, value) => {
            const el = doc.querySelector(selector);
            if (el && el.textContent !== String(value)) el.textContent = String(value);
        };
        if (payload.title != null) setText(".ytbt-pip-title", payload.title);
        if (payload.time != null) setText(".ytbt-pip-time", payload.time);
        if (payload.cn != null) setText(".ytbt-pip-cn", payload.cn);
        if (payload.en != null) setText(".ytbt-pip-en", payload.en);
        if (payload.progress != null) {
            const fill = doc.querySelector(".ytbt-pip-progress-fill");
            if (fill) fill.style.width = Math.max(0, Math.min(100, payload.progress)) + "%";
        }
        return true;
    } catch (_) {
        return false;
    }
}

function ytbtPipSetNodeText(node, value) {
    const text = String(value == null ? "" : value);
    if (node && node.textContent !== text) node.textContent = text;
}

// 从真实字幕构造列表行。state.cues 优先，避免面板未打开时列表为空。
function ytbtPipSyncList(timeMs) {
    if (!ytbtPipIsOpen()) return false;
    try {
        const core = (typeof Core !== "undefined") ? Core : null;
        if (!core || typeof core.getCaptionDisplayCues !== "function") return false;
        let cues = [];
        if (typeof state !== "undefined" && state.cues && state.cues.length) {
            cues = core.getCaptionDisplayCues(state.cues);
        } else if (typeof playerToolCues === "function") {
            cues = core.getCaptionDisplayCues(playerToolCues());
        }
        const current = core.findCueAtTime ? core.findCueAtTime(cues, timeMs) : null;
        ytbtPipListRows = cues.map((cue, index) => ({
            index,
            startMs: cue.startMs,
            start: ytbtPipTimeLabel(cue.startMs),
            original: cue.displaySourceText || cue.sourceText || "",
            translation: cue.translatedText || "",
            current: cue === current
        }));
        return ytbtPipRenderList();
    } catch (_) {
        return false;
    }
}

// 渲染列表：行 DOM 复用，文本有变化才写入；当前行高亮跟随播放。
function ytbtPipRenderList() {
    if (!ytbtPipIsOpen()) return false;
    try {
        const doc = ytbtPipWindow.document;
        const list = doc.querySelector(".ytbt-pip-list");
        if (!list) return false;
        const query = String(ytbtPipListQuery || "").trim().toLocaleLowerCase();
        const all = ytbtPipListRows || [];
        const filtered = query
            ? all.filter((row) => `${row.original} ${row.translation} ${row.start}`.toLocaleLowerCase().includes(query))
            : all;
        const shown = filtered.slice(0, ytbtPipListMaxRows);

        while (ytbtPipListRowEls.length < shown.length) {
            const row = doc.createElement("div");
            row.className = "ytbt-cue-row";
            row.setAttribute("role", "listitem");
            const time = doc.createElement("time");
            time.className = "ytbt-cue-time";
            const body = doc.createElement("div");
            body.className = "ytbt-cue-body";
            const source = doc.createElement("span");
            source.className = "ytbt-cue-source";
            const translation = doc.createElement("span");
            translation.className = "ytbt-cue-translation";
            body.appendChild(source);
            body.appendChild(translation);
            row.appendChild(time);
            row.appendChild(body);
            list.appendChild(row);
            row._ytbtPipParts = {time, source, translation};
            ytbtPipListRowEls.push(row);
        }

        let active = null;
        for (let i = 0; i < ytbtPipListRowEls.length; i++) {
            const row = ytbtPipListRowEls[i];
            const data = shown[i];
            if (!data) {
                if (!row.hidden) row.hidden = true;
                if (row.hasAttribute && row.hasAttribute("aria-current")) row.removeAttribute("aria-current");
                continue;
            }
            if (row.hidden) row.hidden = false;
            row.setAttribute("data-start-ms", String(data.startMs));
            row.setAttribute("data-index", String(data.index));
            ytbtPipSetNodeText(row._ytbtPipParts.time, data.start);
            ytbtPipSetNodeText(row._ytbtPipParts.source, data.original);
            ytbtPipSetNodeText(row._ytbtPipParts.translation, data.translation);
            if (data.current) {
                row.setAttribute("aria-current", "true");
                active = row;
            } else if (row.hasAttribute && row.hasAttribute("aria-current")) {
                row.removeAttribute("aria-current");
            }
        }

        const count = doc.querySelector(".ytbt-pip-count");
        ytbtPipSetNodeText(count, query
            ? `${shown.length}/${all.length} 匹配`
            : `${Math.min(ytbtPipListMaxRows, all.length)}/${all.length} 条`);
        if (ytbtPipListFollow && active && list.clientHeight && active.offsetTop) {
            const target = Math.max(0, active.offsetTop - (list.offsetTop || 0) - list.clientHeight / 3);
            if (Math.abs(target - (list.scrollTop || 0)) > 4) list.scrollTop = target;
        }
        return true;
    } catch (_) {
        return false;
    }
}

// 列表交互：点行跳转、搜索过滤、跟随开关。事件绑在画中画自己的 document 上。
function ytbtPipBindList(pip) {
    if (!pip || !pip.document || !pip.document.addEventListener) return;
    const doc = pip.document;
    const add = (target, type, handler) => {
        target.addEventListener(type, handler, true);
        ytbtPipListBound.push([target, type, handler]);
    };
    add(doc, "click", (event) => {
        const target = event && event.target;
        if (!target || !target.closest) return;
        const row = target.closest(".ytbt-cue-row");
        if (!row) return;
        // 拖选后产生的 click 不跳转，避免清掉选区和译文卡。
        try {
            const selection = pip.getSelection && pip.getSelection();
            if (selection && !selection.isCollapsed) return;
        } catch (_) { /* 无选区 API 时照常跳转 */ }
        const startMs = Number(row.getAttribute && row.getAttribute("data-start-ms"));
        if (!Number.isFinite(startMs)) return;
        if (typeof ytbtPipSeekHandler === "function") ytbtPipSeekHandler(startMs);
        else ytbtPipDefaultSeek(startMs);
    });
    add(doc, "input", (event) => {
        const target = event && event.target;
        if (!target || String(target.className || "").indexOf("ytbt-pip-search") < 0) return;
        ytbtPipListQuery = String(target.value || "");
        ytbtPipRenderList();
    });
    add(doc, "change", (event) => {
        const target = event && event.target;
        if (!target || String(target.className || "").indexOf("ytbt-pip-follow-input") < 0) return;
        ytbtPipListFollow = !!target.checked;
        if (ytbtPipListFollow) ytbtPipRenderList();
    });
}

// 默认跳转：直接操作共享作用域里的视频；content-controls.js 可覆盖该回调。
function ytbtPipDefaultSeek(startMs) {
    try {
        const video = (typeof state !== "undefined" && state.video) ||
            (typeof document !== "undefined" && document.querySelector && document.querySelector("video"));
        if (!video) return;
        video.currentTime = Number(startMs) / 1000;
        if (typeof handleSeek === "function") handleSeek();
    } catch (_) { /* 无视频时忽略 */ }
}

function ytbtPipUnbindList() {
    for (const [target, type, handler] of ytbtPipListBound) {
        try { target.removeEventListener(type, handler, true); } catch (_) { /* 忽略 */ }
    }
    ytbtPipListBound = [];
}

// 设置页改动后即时生效，无需重开窗口。
function ytbtPipApplyOptions(options) {
    ytbtPipOptions = ytbtPipNormalizeOptions(options);
    if (!ytbtPipIsOpen()) return false;
    try {
        const doc = ytbtPipWindow.document;
        if (ytbtPipStyleNode && ytbtPipStyleNode.parentNode && ytbtPipStyleNode.parentNode.removeChild) {
            ytbtPipStyleNode.parentNode.removeChild(ytbtPipStyleNode);
        }
        const style = doc.createElement("style");
        style.textContent = ytbtPipStyles(ytbtPipOptions);
        doc.head.appendChild(style);
        ytbtPipStyleNode = style;
        return true;
    } catch (_) {
        return false;
    }
}

function ytbtPipNotifyClosed() {
    const callback = ytbtPipOnClose;
    ytbtPipOnClose = null;
    if (typeof callback === "function") {
        try { callback(); } catch (_) { /* 回调失败不影响关闭 */ }
    }
}

function ytbtPipClose() {
    const pip = ytbtPipWindow;
    ytbtPipWindow = null;
    ytbtPipStyleNode = null;
    ytbtPipUnbindList();
    ytbtPipListRows = [];
    ytbtPipListRowEls = [];
    if (pip && !pip.closed) {
        try { pip.close(); } catch (_) { /* 忽略关闭异常 */ }
    }
    ytbtPipUnbindHover();
    ytbtPipNotifyClosed();
}

async function ytbtPipToggle(options) {
    if (!ytbtPipSupported()) {
        throw new Error("当前浏览器不支持文档画中画，请使用 Chrome / Edge 桌面版 111 及以上版本。");
    }
    if (ytbtPipIsOpen()) {
        ytbtPipClose();
        return "closed";
    }

    ytbtPipOptions = ytbtPipNormalizeOptions(options);
    ytbtPipOnClose = options && typeof options.onClose === "function" ? options.onClose : null;

    let pip;
    try {
        pip = await window.documentPictureInPicture.requestWindow({width: 900, height: 620});
    } catch (err) {
        ytbtPipOnClose = null;
        throw new Error("打开画中画窗口失败（必须由按钮点击触发）：" + ((err && err.message) || "未知错误"));
    }
    ytbtPipWindow = pip;

    try {
        pip.document.body.innerHTML =
            '<div class="ytbt-pip">' +
              '<div class="ytbt-pip-head">' +
                '<div class="ytbt-pip-title"></div>' +
                '<div class="ytbt-pip-time"></div>' +
              '</div>' +
              '<div class="ytbt-pip-progress"><div class="ytbt-pip-progress-fill"></div></div>' +
              '<div class="ytbt-pip-tools">' +
                '<input class="ytbt-pip-search" type="search" placeholder="搜索字幕…" aria-label="搜索字幕">' +
                '<span class="ytbt-pip-count"></span>' +
                '<label class="ytbt-pip-follow"><input class="ytbt-pip-follow-input" type="checkbox" checked>跟随</label>' +
              '</div>' +
              '<div class="ytbt-pip-list" role="list"></div>' +
              '<div class="ytbt-pip-foot">点行跳转 · 悬停取词 · 拖选翻译 · 可拖到第二块屏幕</div>' +
            '</div>';
        ytbtPipStyleNode = null;
        ytbtPipApplyOptions(ytbtPipOptions);
    } catch (err) {
        ytbtPipWindow = null;
        ytbtPipStyleNode = null;
        ytbtPipOnClose = null;
        ytbtPipUnbindList();
        try { pip.close(); } catch (_) { /* 忽略关闭异常 */ }
        throw new Error("画中画窗口内容初始化失败：" + ((err && err.message) || "未知错误"));
    }

    ytbtPipBindHover(pip);
    ytbtPipBindList(pip);
    ytbtPipListQuery = "";
    ytbtPipListFollow = true;
    ytbtPipWrite({title: ytbtPipVideoTitle()});
    ytbtPipSyncList(typeof getCurrentTimeMs === "function" ? getCurrentTimeMs() : 0);
    pip.addEventListener("pagehide", function () {
        // ytbtPipClose() 主动关闭时已经清理过，避免重复通知菜单刷新。
        if (ytbtPipWindow !== pip) return;
        ytbtPipWindow = null;
        ytbtPipStyleNode = null;
        ytbtPipUnbindList();
        ytbtPipListRows = [];
        ytbtPipListRowEls = [];
        ytbtPipUnbindHover();
        ytbtPipNotifyClosed();
    });
    return "opened";
}
