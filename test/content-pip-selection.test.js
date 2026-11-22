const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/content-hover.js"), "utf8");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeVideo() {
    return {
        tagName: "VIDEO", paused: false, pauseCalls: 0, playCalls: 0,
        pause() { this.pauseCalls += 1; this.paused = true; },
        play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
    };
}

function makeElement(doc, tag, created) {
    const el = {
        tagName: String(tag).toUpperCase(), className: "", hidden: true, disabled: false,
        style: {}, children: [], textContent: "", isConnected: true, attrs: {}, handlers: {},
        parentNode: null,
        _classes: new Set(),
        get classList() {
            const classes = this._classes;
            return {
                add(name) { classes.add(name); },
                remove(name) { classes.delete(name); },
                contains(name) { return classes.has(name); },
            };
        },
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
            this.textContent += child.textContent || "";
            created.push(child);
            return child;
        },
        removeChild(child) {
            const i = this.children.indexOf(child);
            if (i >= 0) this.children.splice(i, 1);
            child.parentNode = null;
        },
        remove() { if (this.parentNode) this.parentNode.removeChild(this); },
        querySelector(selector) {
            const cls = String(selector).replace(/^\./, "");
            if (this.className === cls) return this;
            for (const child of this.children) {
                const found = child.querySelector?.(selector);
                if (found) return found;
            }
            return null;
        },
        addEventListener(type, handler) { (this.handlers[type] = this.handlers[type] || []).push(handler); },
        setAttribute(name, value) { this.attrs[name] = value; },
        getBoundingClientRect() { return {top: 10, bottom: 30, left: 40, right: 200, width: 160, height: 20}; },
    };
    void doc;
    return el;
}

function makePipWindow({selection = null, caretTarget = null, created = [], listeners = [], enText = ""} = {}) {
    let activeSelection = selection;
    const doc = {
        head: {appendChild() {}},
        body: {
            appendChild(el) { created.push(el); el.parentNode = this; },
            removeChild(el) { const i = created.indexOf(el); if (i >= 0) created.splice(i, 1); el.parentNode = null; },
        },
        caretRangeFromPoint() {
            return caretTarget ? {startContainer: caretTarget.node, startOffset: caretTarget.offset} : null;
        },
        createRange() {
            return {
                startContainer: null,
                setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
                setEnd() {},
                getBoundingClientRect() { return {top: 10, bottom: 30, left: 40, right: 200, width: 160, height: 20}; },
            };
        },
        createElement(tag) { return makeElement(doc, tag, created); },
        querySelector(selector) {
            if (selector === ".ytbt-pip-en") return {textContent: enText};
            return null;
        },
        addEventListener(type, handler, capture) { listeners.push([type, handler, capture]); },
        removeEventListener(type, handler, capture) {
            const i = listeners.findIndex((item) => item[0] === type && item[1] === handler && item[2] === capture);
            if (i >= 0) listeners.splice(i, 1);
        },
    };
    const win = {
        document: doc,
        innerWidth: 960, innerHeight: 260,
        getSelection() { return activeSelection; },
        addEventListener(type, handler, capture) { listeners.push([type, handler, capture]); },
        removeEventListener(type, handler, capture) {
            const i = listeners.findIndex((item) => item[0] === type && item[1] === handler && item[2] === capture);
            if (i >= 0) listeners.splice(i, 1);
        },
    };
    return {
        document: doc, win, listeners, created,
        setSelection(value) { activeSelection = value; },
    };
}

function selectionOf(text) {
    const range = {
        getBoundingClientRect() { return {top: 40, bottom: 60, left: 30, right: 260, width: 230, height: 20}; },
    };
    return {
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt() { return range; },
        toString() { return text; },
        removeAllRanges() { this.isCollapsed = true; this.rangeCount = 0; },
    };
}

function fire(listeners, type, event = {}) {
    for (const [name, handler] of listeners.slice()) {
        if (name === type) handler(event);
    }
}

function load({video, translate, lookup = null, sent} = {}) {
    const document = {
        title: "测试视频 - YouTube",
        body: {appendChild() {}},
        createElement() { return makeElement(null, "div", []); },
        querySelector() { return video; },
        addEventListener() {},
    };
    const window = {innerWidth: 1200, innerHeight: 800, speechSynthesis: null};
    const context = vm.createContext({
        console, setTimeout, clearTimeout, Date, Map, String, Math, Number, Set,
        document, window, location: {href: "https://www.youtube.com/watch?v=abc"},
        CSS: null, Highlight: null,
        chrome: {
            runtime: {
                sendMessage: async (message) => {
                    sent.push(message);
                    if (message.type === "SELECTION_TRANSLATE") {
                        return typeof translate === "function" ? translate(message) : (translate || {ok: false});
                    }
                    if (message.type === "LOOKUP_WORD") {
                        return typeof lookup === "function" ? lookup(message.word) : (lookup || {ok: false});
                    }
                    return {ok: true};
                },
            },
            storage: {onChanged: {addListener() {}}},
        },
        state: {settings: {}, cues: [], video},
        Core: {
            SELECTION_MAX_CHARS: 2000,
            sendRuntimeMessage: async (runtime, message) => runtime.sendMessage(message),
            getCaptionDisplayCues: (cues) => cues,
            findCueAtTime: () => null,
        },
        getCurrentTimeMs: () => 0,
    });
    context.globalThis = context;
    vm.runInContext(source, context);
    return {api: context, document, video};
}

test("画中画里拖选词组会出译文卡片，并可收藏到生词本", async () => {
    const sent = [];
    const f = load({
        video: fakeVideo(),
        sent,
        translate: {
            ok: true, type: "SELECTION_TRANSLATE_RESULT", sourceText: "stayed resilient",
            translatedText: "保持坚韧", sourceUrl: "https://www.youtube.com/watch?v=abc",
            sourceTitle: "测试视频", sourceLanguage: "en", targetLanguage: "zh-CN",
        },
    });
    const pip = makePipWindow({selection: selectionOf("stayed resilient"), enText: "She stayed resilient."});
    const ctx = f.api.YTBTHover.bindPip(pip.win);
    assert.ok(ctx.isPip);

    fire(pip.listeners, "pointerup", {button: 0});
    await wait(60);

    const card = pip.created.find((el) => el.className === "ytbt-pipsel");
    assert.ok(card, "应在画中画文档里创建划词卡片");
    assert.match(card.textContent, /stayed resilient/, "卡片显示原文");
    assert.match(card.textContent, /保持坚韧/, "卡片显示译文");
    assert.equal(f.video.paused, true, "划词卡片出现时暂停视频");
    assert.ok(sent.some((m) => m.type === "SELECTION_TRANSLATE"), "发出翻译请求");

    const save = card.children.find((c) => c.className === "ytbt-pipsel-actions")
        ?.children.find((c) => c.className === "ytbt-pipsel-save");
    assert.ok(save, "有收藏按钮");
    save.handlers.click[0]({stopPropagation() {}});
    await wait(30);
    assert.ok(sent.some((m) => m.type === "VOCABULARY" && m.action === "add"), "收藏写入生词本");
    assert.match(card.textContent, /已收藏/, "按钮变成已收藏");
});

test("画中画里选区残留不再挡住单词取词", async () => {
    const text = "She stayed resilient.";
    const {node} = {node: {nodeType: 3, textContent: text, parentElement: {
        className: "ytbt-pip-en",
        closest(s) { return String(s).includes(".ytbt-pip-en") || String(s).includes(".ytbt-pip-lines") ? this : null; },
        getBoundingClientRect() { return {top: 10, bottom: 30, left: 40, right: 200, width: 160, height: 20}; },
    }}};
    const sent = [];
    const f = load({
        video: fakeVideo(), sent,
        lookup: () => ({ok: true, result: {word: "resilient", entries: [{pos: "adj.", variants: ["有韧性的"]}]}}),
    });
    const pip = makePipWindow({
        selection: selectionOf("stayed resilient"),
        caretTarget: {node, offset: text.indexOf("resilient") + 3},
        created: [], listeners: [],
    });
    const ctx = f.api.YTBTHover.bindPip(pip.win);

    // 选区非折叠时，悬停单词仍应出词卡（修复的核心）。
    f.api.hoverApplyZone("subtitle", {clientX: 100, clientY: 20}, ctx);
    await wait(360);
    const tip = pip.created.find((el) => el.className === "ytbt-wordtip");
    assert.ok(tip, "残留选区下仍能出词卡");
    assert.match(tip.textContent, /resilient/);
});

test("拖选多词全序列：只弹划词译文卡，不被单词词卡抢占", async () => {
    // 复现用户实测 bug：拖选 "legs of the stool" 时，mousemove 节流补帧
    // 丢了 buttons，松手后命中末尾单词 "stool" 弹单词卡，还把译文卡挤掉。
    const text = "We need a couple legs of the stool.";
    const {node} = {node: {nodeType: 3, textContent: text, parentElement: {
        className: "ytbt-pip-en",
        closest(s) { return String(s).includes(".ytbt-pip-en") ? this : null; },
        getBoundingClientRect() { return {top: 10, bottom: 30, left: 40, right: 260, width: 220, height: 20}; },
    }}};
    const sent = [];
    const f = load({
        video: fakeVideo(),
        sent,
        translate: {
            ok: true, type: "SELECTION_TRANSLATE_RESULT", sourceText: "legs of the stool",
            translatedText: "凳子的腿", sourceUrl: "https://www.youtube.com/watch?v=abc",
            sourceTitle: "测试视频", sourceLanguage: "en", targetLanguage: "zh-CN",
        },
        lookup: () => ({ok: true, result: {word: "stool", entries: [{pos: "n.", variants: ["凳子"]}]}}),
    });
    const pip = makePipWindow({
        selection: selectionOf("legs of the stool"),
        caretTarget: {node, offset: text.indexOf("stool") + 2},
        enText: text,
    });
    const ctx = f.api.YTBTHover.bindPip(pip.win);

    // 1) 左键按下 → 进入拖选保护期
    fire(pip.listeners, "pointerdown", {button: 0, target: null});
    // 2) 拖选过程中的 mousemove（buttons=1）
    fire(pip.listeners, "mousemove", {clientX: 200, clientY: 20, buttons: 1});
    // 3) 紧接着的补帧（仍在拖选），走 lastMoveEvent 节流路径
    fire(pip.listeners, "mousemove", {clientX: 210, clientY: 20, buttons: 1});
    // 4) 松手 → 弹划词卡
    fire(pip.listeners, "pointerup", {button: 0});
    await wait(120);

    const card = pip.created.find((el) => el.className === "ytbt-pipsel");
    assert.ok(card, "应弹划词译文卡");
    assert.match(card.textContent, /legs of the stool/, "译文卡是多词原文");
    // 关键：单词词卡不能出现，且不应发出单词查词请求。
    const tip = pip.created.find((el) => el.className === "ytbt-wordtip");
    assert.ok(!tip || tip.hidden, "拖选多词时不应弹单词词卡");
    assert.ok(!sent.some((m) => m.type === "LOOKUP_WORD"), "不应触发单词查词");

    // 5) 关闭划词卡后，悬停单词应能恢复取词。
    fire(pip.listeners, "keyup", {key: "Escape"});
    await wait(20);
    assert.ok(!pip.created.some((el) => el.className === "ytbt-pipsel" && !el.hidden), "划词卡已关闭");
    f.api.hoverApplyZone("subtitle", {clientX: 100, clientY: 20, buttons: 0}, ctx);
    await wait(360);
    const tipAfter = pip.created.find((el) => el.className === "ytbt-wordtip");
    assert.ok(tipAfter && !tipAfter.hidden, "关闭划词卡后悬停取词恢复");
});

test("关闭画中画会清理划词卡片状态与监听", async () => {
    const sent = [];
    const f = load({
        video: fakeVideo(), sent,
        translate: {ok: true, translatedText: "保持坚韧"},
    });
    const pip = makePipWindow({selection: selectionOf("stayed resilient"), enText: "She stayed resilient."});
    f.api.YTBTHover.bindPip(pip.win);
    fire(pip.listeners, "pointerup", {button: 0});
    await wait(60);
    assert.ok(pip.created.some((el) => el.className === "ytbt-pipsel"));

    const before = pip.listeners.length;
    assert.ok(before > 0);
    f.api.YTBTHover.unbindPip();
    assert.equal(pip.listeners.length, 0, "所有事件监听解绑");
});
