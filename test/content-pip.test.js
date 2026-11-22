const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/content-pip.js"), "utf8");

// 最小 DOM 元素 mock：支持 class 选择器、属性、子节点与事件。
function makeElement(tag, className) {
    const el = {
        tagName: String(tag || "div").toUpperCase(),
        className: className || "",
        textContent: "",
        style: {},
        children: [],
        attrs: {},
        hidden: false,
        scrollTop: 0,
        clientHeight: 0,
        offsetTop: 0,
        parentNode: null,
        _listeners: {},
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        removeChild(child) {
            const i = this.children.indexOf(child);
            if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
        },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(t, h) { (this._listeners[t] = this._listeners[t] || []).push(h); },
        removeEventListener(t, h) {
            const arr = this._listeners[t] || [];
            const i = arr.indexOf(h);
            if (i >= 0) arr.splice(i, 1);
        },
        querySelector(sel) { return queryIn(this, sel); },
        closest(sel) {
            const cls = sel.replace(/^\./, "");
            let node = this;
            while (node) {
                if ((node.className || "").split(/\s+/).includes(cls)) return node;
                node = node.parentNode;
            }
            return null;
        },
        contains(node) {
            let n = node;
            while (n) { if (n === this) return true; n = n.parentNode; }
            return false;
        }
    };
    return el;
}

function queryIn(root, sel) {
    const cls = sel.replace(/^\./, "");
    if ((root.className || "").split(/\s+/).includes(cls)) return root;
    for (const child of root.children || []) {
        const hit = queryIn(child, sel);
        if (hit) return hit;
    }
    return null;
}

function makePipWindow({closed = false} = {}) {
    const nodes = {
        ".ytbt-pip-title": makeElement("div", "ytbt-pip-title"),
        ".ytbt-pip-time": makeElement("div", "ytbt-pip-time"),
        ".ytbt-pip-cn": makeElement("div", "ytbt-pip-cn"),
        ".ytbt-pip-en": makeElement("div", "ytbt-pip-en"),
        ".ytbt-pip-progress-fill": makeElement("div", "ytbt-pip-progress-fill"),
        ".ytbt-pip-count": makeElement("span", "ytbt-pip-count"),
        ".ytbt-pip-list": makeElement("div", "ytbt-pip-list")
    };
    const listeners = {};
    let selection = {isCollapsed: true};
    return {
        closed,
        document: {
            head: makeElement("head"),
            body: makeElement("body"),
            createElement(tag) { return makeElement(tag); },
            querySelector(sel) { return nodes[sel] || null; },
            addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
            removeEventListener(name, fn) {
                const arr = listeners[name] || [];
                const i = arr.indexOf(fn);
                if (i >= 0) arr.splice(i, 1);
            }
        },
        addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
        removeEventListener(name, fn) {
            const arr = listeners[name] || [];
            const i = arr.indexOf(fn);
            if (i >= 0) arr.splice(i, 1);
        },
        getSelection() { return selection; },
        close() { this.closed = true; },
        setSelection(value) { selection = value; },
        _nodes: nodes,
        _listeners: listeners
    };
}

function loadContext(windowOverrides = {}, cueOverrides = null) {
    const timers = [];
    const context = {
        window: Object.assign({
            documentPictureInPicture: {
                requestWindow: async () => { throw new Error("not configured"); }
            },
            document: {title: "测试视频 - YouTube"}
        }, windowOverrides),
        document: {title: "测试视频 - YouTube"},
        state: {cues: cueOverrides || []},
        Core: {
            getCaptionDisplayCues: (cues) => cues,
            findCueAtTime: (cues, t) => cues.find((c) => t >= c.startMs && t < (c.endMs || c.startMs + 1000)) || null
        },
        setInterval: (fn, ms) => { timers.push(fn); return timers.length; },
        clearInterval: () => {},
        Date,
        String,
        Math,
        Number,
        console
    };
    context.window.window = context.window;
    vm.createContext(context);
    vm.runInContext(source, context, {filename: "content-pip.js"});
    return {context, timers};
}

function makeCues() {
    return [
        {startMs: 0, endMs: 4000, sourceText: "She stayed resilient.", translatedText: "她保持坚韧。"},
        {startMs: 4000, endMs: 8000, sourceText: "Tiny habits compound.", translatedText: "小习惯会累积。"},
        {startMs: 8000, endMs: 12000, sourceText: "We figured it out.", translatedText: "我们想明白了。"}
    ];
}

test("ytbtPipSupported reflects the availability of requestWindow", () => {
    const supported = loadContext();
    assert.equal(supported.context.ytbtPipSupported(), true);
    const unsupported = loadContext({documentPictureInPicture: undefined});
    assert.equal(unsupported.context.ytbtPipSupported(), false);
});

test("ytbtPipWrite copies header fields into the PiP document", () => {
    const {context} = loadContext();
    const pip = makePipWindow();
    context.ytbtPipWindow = pip;
    assert.equal(
        context.ytbtPipWrite({title: "My Video", time: "01:23 / 05:00", progress: 42}),
        true
    );
    assert.equal(pip._nodes[".ytbt-pip-title"].textContent, "My Video");
    assert.equal(pip._nodes[".ytbt-pip-time"].textContent, "01:23 / 05:00");
    assert.equal(pip._nodes[".ytbt-pip-progress-fill"].style.width, "42%");
});

test("ytbtPipWrite skips unchanged text and ignores missing fields", () => {
    const {context} = loadContext();
    const pip = makePipWindow();
    context.ytbtPipWindow = pip;
    context.ytbtPipWrite({title: "保持"});
    let writes = 0;
    const node = pip._nodes[".ytbt-pip-title"];
    let value = node.textContent;
    Object.defineProperty(node, "textContent", {
        get() { return value; },
        set(v) { value = v; writes++; }
    });
    context.ytbtPipWrite({title: "保持"});
    assert.equal(writes, 0, "unchanged text is not rewritten");
    context.ytbtPipWrite({title: "改变"});
    assert.equal(writes, 1, "changed text is rewritten once");
    assert.equal(pip._nodes[".ytbt-pip-time"].textContent, "", "absent field is left alone");
});

test("ytbtPipWrite is a no-op when no PiP window is open", () => {
    const {context} = loadContext();
    assert.equal(context.ytbtPipWrite({title: "x"}), false);
    context.ytbtPipWindow = makePipWindow({closed: true});
    assert.equal(context.ytbtPipWrite({title: "x"}), false);
});

test("ytbtPipToggle opens a styled list window and toggles it closed", async () => {
    const pip = makePipWindow();
    const {context} = loadContext({
        documentPictureInPicture: {requestWindow: async () => pip}
    });
    assert.equal(context.ytbtPipIsOpen(), false);
    const opened = await context.ytbtPipToggle();
    assert.equal(opened, "opened");
    assert.equal(context.ytbtPipIsOpen(), true);
    assert.equal(pip._nodes[".ytbt-pip-title"].textContent, "测试视频", "YouTube suffix stripped");
    assert.match(pip.document.body.innerHTML || context.ytbtPipStyles(), /ytbt-pip-list/);
    const closed = await context.ytbtPipToggle();
    assert.equal(closed, "closed");
    assert.equal(context.ytbtPipIsOpen(), false);
    assert.equal(pip.closed, true);
});

test("ytbtPipToggle renders the list shell with search, count, follow and list nodes", async () => {
    const pip = makePipWindow();
    const {context} = loadContext({
        documentPictureInPicture: {requestWindow: async () => pip}
    });
    // 捕获写入 body 的 HTML，验证窗口结构是列表视图。
    let html = "";
    Object.defineProperty(pip.document.body, "innerHTML", {
        get() { return html; },
        set(v) { html = v; }
    });
    await context.ytbtPipToggle();
    assert.match(html, /ytbt-pip-search/, "search box present");
    assert.match(html, /ytbt-pip-count/, "result count present");
    assert.match(html, /ytbt-pip-follow-input/, "follow toggle present");
    assert.match(html, /ytbt-pip-list/, "list container present");
    assert.doesNotMatch(html, /ytbt-pip-cn/, "no single-subtitle mirror");
});

test("ytbtPipToggle throws a friendly error when the API is unavailable", async () => {
    const {context} = loadContext({documentPictureInPicture: undefined});
    await assert.rejects(() => context.ytbtPipToggle(), /不支持文档画中画/);
});

test("ytbtPipToggle passes options and notifies onClose exactly once", async () => {
    const pip = makePipWindow();
    const {context} = loadContext({
        documentPictureInPicture: {requestWindow: async () => pip}
    });
    let closed = 0;
    await context.ytbtPipToggle({
        showHeader: false,
        fontScale: 1.2,
        opacity: 0.6,
        onClose: () => { closed += 1; }
    });
    const hiddenHeader = ".ytbt-pip-head,.ytbt-pip-progress,.ytbt-pip-foot{display:none;}";
    assert.ok(context.ytbtPipStyles({showHeader: false}).includes(hiddenHeader));
    assert.ok(!context.ytbtPipStyles({showHeader: true}).includes(hiddenHeader));
    assert.match(context.ytbtPipStyles(), /\.ytbt-cue-row\[aria-current="true"\]/, "list styles present");
    assert.ok(pip._listeners.pagehide.length === 1);

    pip._listeners.pagehide[0]();
    assert.equal(closed, 1);
    assert.equal(context.ytbtPipIsOpen(), false);
    pip._listeners.pagehide[0]();
    assert.equal(closed, 1);
});

test("ytbtPipSyncList renders real cues with time and current-row highlight", async () => {
    const pip = makePipWindow();
    const {context} = loadContext(
        {documentPictureInPicture: {requestWindow: async () => pip}},
        makeCues()
    );
    await context.ytbtPipToggle();
    assert.equal(context.ytbtPipSyncList(5000), true);
    const rows = pip._nodes[".ytbt-pip-list"].children.filter((c) => c.className === "ytbt-cue-row");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].querySelector(".ytbt-cue-source").textContent, "She stayed resilient.");
    assert.equal(rows[0].querySelector(".ytbt-cue-translation").textContent, "她保持坚韧。");
    assert.equal(rows[0].querySelector(".ytbt-cue-time").textContent, "00:00");
    assert.equal(rows[1].getAttribute("aria-current"), "true", "current cue highlighted");
    assert.equal(rows[0].getAttribute("aria-current"), null);
    assert.equal(pip._nodes[".ytbt-pip-count"].textContent, "3/3 条");
});

test("ytbtPipSyncList is idempotent when cues are unchanged", async () => {
    const pip = makePipWindow();
    const {context} = loadContext(
        {documentPictureInPicture: {requestWindow: async () => pip}},
        makeCues()
    );
    await context.ytbtPipToggle();
    context.ytbtPipSyncList(5000);
    const rows = pip._nodes[".ytbt-pip-list"].children.filter((c) => c.className === "ytbt-cue-row");
    const source = rows[0].querySelector(".ytbt-cue-source");
    let writes = 0;
    let value = source.textContent;
    Object.defineProperty(source, "textContent", {
        get() { return value; },
        set(v) { value = v; writes++; }
    });
    context.ytbtPipSyncList(5000);
    assert.equal(writes, 0, "unchanged row text is not rewritten");
    assert.equal(pip._nodes[".ytbt-pip-list"].children.length, 3, "no duplicate rows");
});

test("the PiP search box filters rows locally", async () => {
    const pip = makePipWindow();
    const {context} = loadContext(
        {documentPictureInPicture: {requestWindow: async () => pip}},
        makeCues()
    );
    await context.ytbtPipToggle();
    context.ytbtPipSyncList(5000);
    const inputHandler = (pip._listeners.input || [])[0];
    assert.ok(inputHandler, "input listener bound in PiP document");
    inputHandler({target: {className: "ytbt-pip-search", value: "resilient"}});
    const rows = pip._nodes[".ytbt-pip-list"].children.filter((c) => c.className === "ytbt-cue-row");
    assert.equal(rows[0].hidden, false);
    assert.equal(rows[1].hidden, true, "non-matching rows are hidden");
    assert.equal(rows[2].hidden, true);
    assert.equal(pip._nodes[".ytbt-pip-count"].textContent, "1/3 匹配");
});

test("clicking a PiP row seeks, but a dragged selection does not", async () => {
    const pip = makePipWindow();
    const {context} = loadContext(
        {documentPictureInPicture: {requestWindow: async () => pip}},
        makeCues()
    );
    const seeks = [];
    context.ytbtPipSetSeekHandler((ms) => seeks.push(ms));
    await context.ytbtPipToggle();
    context.ytbtPipSyncList(5000);
    const clickHandler = (pip._listeners.click || [])[0];
    assert.ok(clickHandler, "click listener bound in PiP document");
    const rows = pip._nodes[".ytbt-pip-list"].children.filter((c) => c.className === "ytbt-cue-row");

    clickHandler({target: rows[2].querySelector(".ytbt-cue-source")});
    assert.deepEqual(seeks, [8000], "clicking row seeks to its start time");

    pip.setSelection({isCollapsed: false});
    clickHandler({target: rows[0].querySelector(".ytbt-cue-source")});
    assert.deepEqual(seeks, [8000], "selection drag does not trigger seek");
});

test("follow toggle scrolls the current row into view", async () => {
    const pip = makePipWindow();
    const {context} = loadContext(
        {documentPictureInPicture: {requestWindow: async () => pip}},
        makeCues()
    );
    await context.ytbtPipToggle();
    const list = pip._nodes[".ytbt-pip-list"];
    list.clientHeight = 200;
    context.ytbtPipSyncList(5000);
    const rows = list.children.filter((c) => c.className === "ytbt-cue-row");
    rows[1].offsetTop = 400;
    context.ytbtPipSyncList(5000);
    assert.ok(list.scrollTop > 0, "current row scrolled into view");
});

test("closing PiP unbinds list listeners and stops syncing", async () => {
    const pip = makePipWindow();
    const {context} = loadContext(
        {documentPictureInPicture: {requestWindow: async () => pip}},
        makeCues()
    );
    await context.ytbtPipToggle();
    context.ytbtPipSyncList(5000);
    assert.ok((pip._listeners.click || []).length > 0);
    await context.ytbtPipToggle();
    assert.equal((pip._listeners.click || []).length, 0, "list listeners removed");
    assert.equal(context.ytbtPipSyncList(5000), false, "sync is a no-op after close");
});

test("ytbtPipApplyOptions restyles the window without losing the list", async () => {
    const pip = makePipWindow();
    const {context} = loadContext(
        {documentPictureInPicture: {requestWindow: async () => pip}},
        makeCues()
    );
    await context.ytbtPipToggle();
    context.ytbtPipSyncList(5000);
    const before = pip._nodes[".ytbt-pip-list"].children.length;
    assert.equal(context.ytbtPipApplyOptions({fontScale: 1.4, opacity: 0.5}), true);
    assert.equal(pip._nodes[".ytbt-pip-list"].children.length, before, "list DOM untouched by restyle");
    await context.ytbtPipToggle();
    assert.equal(context.ytbtPipApplyOptions({}), false, "no-op after the window is closed");
});
