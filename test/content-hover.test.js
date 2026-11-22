const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/content-hover.js"), "utf8");

function fakeVideo({paused = false} = {}) {
    return {
        tagName: "VIDEO",
        paused,
        pauseCalls: 0,
        playCalls: 0,
        pause() {
            this.pauseCalls += 1;
            this.paused = true;
        },
        play() {
            this.playCalls += 1;
            this.paused = false;
            return Promise.resolve();
        },
    };
}

function line(text, className = "ytbt-en") {
    const element = {
        className,
        parentElement: null,
        closest(selector) {
            if (selector === ".ytbt-en, .ytbt-cue-source") {
                return (className === "ytbt-en" || className === "ytbt-cue-source") ? element : null;
            }
            if (selector === ".ytbt-lines") return element;
            return null;
        },
    };
    const node = {nodeType: 3, textContent: text, parentElement: element};
    return {node, element};
}

function installSpeechStub(window) {
    const spoken = [];
    let current = null;
    window.SpeechSynthesisUtterance = class {
        constructor(text) {
            this.text = text;
            this.lang = "";
            this.rate = 1;
            this.voice = null;
        }
    };
    window.speechSynthesis = {
        getVoices: () => [
            {name: "Online EN", lang: "en-US", localService: false},
            {name: "Local EN", lang: "en-GB", localService: true},
        ],
        cancel() { current = null; },
        speak(utterance) {
            spoken.push({text: utterance.text, lang: utterance.lang, rate: utterance.rate,
                voice: utterance.voice?.name || ""});
            current = utterance;
        },
    };
    return {spoken, current: () => current, finish() {
        const utterance = current;
        current = null;
        utterance?.onend?.();
    }};
}

function load({video, settings = {}, caretTarget = null, lookup = null, selectionBusy = false,
               withSpeech = false, onStorageChanged = null} = {}) {
    const listeners = {document: [], window: []};
    const created = [];
    const highlights = new Map();

    const document = {
        body: {appendChild(el) { created.push(el); }},
        caretRangeFromPoint() {
            if (!caretTarget) return null;
            return {startContainer: caretTarget.node, startOffset: caretTarget.offset};
        },
        createRange() {
            return {
                startContainer: null,
                setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
                setEnd() {},
                getBoundingClientRect() {
                    return {top: 500, bottom: 520, left: 300, right: 360, width: 60, height: 20};
                },
            };
        },
        createElement(tag) {
            const el = {
                tagName: String(tag).toUpperCase(),
                className: "",
                hidden: true,
                disabled: false,
                style: {},
                children: [],
                textContent: "",
                isConnected: true,
                handlers: {},
                attrs: {},
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
                    this.textContent += child.textContent || "";
                    if (child.className === "ytbt-wordtip-save") this._save = child;
                    if (child.className === "ytbt-wordtip-speak") this._speak = child;
                    return child;
                },
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
                // 真实 DOM 一定有这两个方法：定位浮层时会用到
                getBoundingClientRect() { return {top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0}; },
                isConnected: true,
            };
            return el;
        },
        addEventListener(type, handler) { listeners.document.push([type, handler]); },
        querySelector(selector) { return selector === "video" ? video : null; },
    };

    const window = {
        innerWidth: 1200,
        innerHeight: 800,
        getSelection() { return {isCollapsed: !selectionBusy}; },
        addEventListener(type, handler) { listeners.window.push([type, handler]); },
    };
    const speech = withSpeech ? installSpeechStub(window) : null;
    const sent = [];
    const context = vm.createContext({
        console,
        document,
        window,
        CSS: {
            highlights: {
                set(name, range) { highlights.set(name, range); },
                delete(name) { highlights.delete(name); },
                has(name) { return highlights.has(name); },
            },
        },
        Highlight: class { constructor(range) { this.ranges = [range]; } },
        setTimeout,
        clearTimeout,
        Map,
        Date,
        chrome: {
            runtime: {
                async sendMessage(message) {
                    sent.push(message);
                    if (message.type === "LOOKUP_WORD") {
                        return typeof lookup === "function" ? lookup(message.word) : (lookup || {ok: false});
                    }
                    return {ok: true};
                },
            },
            storage: {
                onChanged: {
                    addListener(handler) {
                        if (onStorageChanged) onStorageChanged.handlers.push(handler);
                    },
                },
            },
        },
        state: {settings, cues: [], video},
        Core: {
            sendRuntimeMessage: async (runtime, message) => runtime.sendMessage(message),
            getCaptionDisplayCues: (cues) => cues,
            findCueAtTime: () => null,
        },
        getCurrentTimeMs: () => 0,
    });
    context.globalThis = context;
    vm.runInContext(source, context);

    return {api: context, document, listeners, created, highlights, sent, video, speech};
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("悬停字幕会暂停播放，移开后恢复", async () => {
    const video = fakeVideo();
    const {api} = load({video});

    api.hoverSuspend("subtitle");
    assert.equal(video.paused, true, "应当暂停");
    assert.equal(video.pauseCalls, 1);

    api.hoverRelease("subtitle");
    assert.equal(video.paused, true, "延迟内还没恢复");
    await wait(260);
    assert.equal(video.paused, false, "延迟结束后恢复播放");
    assert.equal(video.playCalls, 1);
});

test("用户自己暂停的视频不会被自动播放", async () => {
    const video = fakeVideo({paused: true});
    const {api} = load({video});

    api.hoverSuspend("subtitle");
    assert.equal(video.pauseCalls, 0, "本来就暂停，不该重复调用");

    api.hoverRelease("subtitle");
    await wait(260);
    assert.equal(video.playCalls, 0, "不该替用户恢复播放");
});

test("多个悬停区域叠加时，全部移开才恢复", async () => {
    const video = fakeVideo();
    const {api} = load({video});

    api.hoverSuspend("subtitle");
    api.hoverSuspend("tooltip");
    api.hoverRelease("subtitle");
    await wait(260);
    assert.equal(video.paused, true, "仍在浮层里，保持暂停");

    api.hoverRelease("tooltip");
    await wait(260);
    assert.equal(video.paused, false, "全部移开后恢复");
});

test("关闭悬停暂停开关后不再暂停", () => {
    const video = fakeVideo();
    const {api} = load({video, settings: {hoverPauseEnabled: false}});

    api.hoverSuspend("subtitle");
    assert.equal(video.pauseCalls, 0);
    assert.equal(video.paused, false);
});

test("悬浮字幕列表行会暂停播放，移开后恢复", async () => {
    const video = fakeVideo();
    const {api} = load({video});
    const row = {
        closest(selector) {
            return selector === ".ytbt-cue-row" ? row : null;
        },
    };

    assert.equal(api.hoverZoneOf(row), "transcript");
    api.hoverApplyZone("transcript", {clientX: 20, clientY: 40});
    assert.equal(video.paused, true, "停在字幕行上应当暂停");
    assert.equal(video.pauseCalls, 1);

    api.hoverApplyZone("", null);
    await wait(260);
    assert.equal(video.paused, false, "移开后应当恢复");
    assert.equal(video.playCalls, 1);
});

test("在字幕里取到光标下的英文单词", () => {
    const text = "She stayed resilient after the setback.";
    const {node} = line(text);
    const offset = text.indexOf("resilient") + 3;
    const {api} = load({video: fakeVideo(), caretTarget: {node, offset}});

    const hit = api.hoverWordAtPoint(400, 510);
    assert.ok(hit, "应该取到单词");
    assert.equal(hit.word, "resilient");
    assert.equal(hit.range.startOffset, text.indexOf("resilient"));
});

test("悬浮字幕列表的原文也能取词", () => {
    const text = "She stayed resilient after the setback.";
    const {node} = line(text, "ytbt-cue-source");
    const offset = text.indexOf("resilient") + 3;
    const {api} = load({video: fakeVideo(), caretTarget: {node, offset}});

    const hit = api.hoverWordAtPoint(400, 510);
    assert.ok(hit, "字幕列表原文应当能取词");
    assert.equal(hit.word, "resilient");
});

test("拖拽选区或选区未清空时不弹单词浮层", () => {
    const text = "She stayed resilient after the setback.";
    const {node} = line(text, "ytbt-cue-source");
    const offset = text.indexOf("resilient") + 3;
    const dragging = load({video: fakeVideo(), caretTarget: {node, offset}});
    dragging.api.hoverTrackWord({clientX: 400, clientY: 510, buttons: 1});
    assert.equal(dragging.sent.length, 0, "按住左键拖动时不应查词");

    const selected = load({video: fakeVideo(), caretTarget: {node, offset}, selectionBusy: true});
    selected.api.hoverTrackWord({clientX: 400, clientY: 510, buttons: 0});
    assert.equal(selected.sent.length, 0, "选区存在时不应与译文卡片抢交互");
});

test("光标停在词尾空白时取左边的词", () => {
    const text = "Tiny habits compound over time.";
    const {node} = line(text);
    const {api} = load({video: fakeVideo(), caretTarget: {node, offset: text.indexOf(" habits") + 6}});

    const hit = api.hoverWordAtPoint(400, 510);
    assert.equal(hit && hit.word, "habits");
});

test("中文译文字幕不触发查词", () => {
    const {node} = line("微小习惯会累积。", "ytbt-cn");
    const {api} = load({video: fakeVideo(), caretTarget: {node, offset: 2}});
    assert.equal(api.hoverWordAtPoint(400, 510), null);
});

test("带连字符与首尾标点的词会被规整", () => {
    const text = "\"well-known\" stories stick.";
    const {node} = line(text);
    const {api} = load({video: fakeVideo(), caretTarget: {node, offset: 4}});
    const hit = api.hoverWordAtPoint(400, 510);
    assert.equal(hit && hit.word, "well-known");
});

test("区域判定能区分字幕、推荐列表与普通页面", () => {
    // 真实 closest() 接的是复合选择器，桩里按“任一分支命中”判断
    const make = (closestMap) => ({
        closest: (selector) => {
            for (const part of String(selector).split(",").map((item) => item.trim())) {
                if (closestMap[part]) return closestMap[part];
            }
            return null;
        },
    });
    const {api} = load({video: fakeVideo()});

    assert.equal(api.hoverZoneOf(make({".ytbt-lines": {}})), "subtitle");
    assert.equal(api.hoverZoneOf(make({"#related": {}})), "related");
    assert.equal(api.hoverZoneOf(make({})), "");
});

test("悬停查词会请求后台并把结果渲染成浮层", async () => {
    const text = "Tiny habits compound over time.";
    const {node} = line(text);
    const result = {
        word: "compound",
        phonetic: "/ˈkɒmpaʊnd/",
        entries: [{pos: "v.", variants: ["累积"]}, {pos: "n.", variants: ["化合物"]}],
        source: "youdao",
    };
    const {api, sent, created} = load({
        video: fakeVideo(),
        caretTarget: {node, offset: text.indexOf("compound") + 2},
        lookup: {ok: true, result},
    });

    api.hoverTrackWord({clientX: 400, clientY: 510});
    await wait(400);

    const lookups = sent.filter((m) => m.type === "LOOKUP_WORD");
    assert.equal(lookups.length, 1, "应当请求一次释义");
    assert.equal(lookups[0].word, "compound");

    const tip = created[0];
    assert.ok(tip, "应当创建浮层");
    assert.equal(tip.hidden, false);
    assert.match(tip.textContent, /compound/);
    assert.match(tip.textContent, /累积/);
    assert.match(tip.textContent, /化合物/);
});

test("关闭悬停查词后不再请求释义", async () => {
    const text = "Tiny habits compound over time.";
    const {node} = line(text);
    const {api, sent} = load({
        video: fakeVideo(),
        settings: {hoverLookupEnabled: false},
        caretTarget: {node, offset: 5},
        lookup: {ok: true, result: {word: "habits", entries: []}},
    });

    api.hoverTrackWord({clientX: 400, clientY: 510});
    await wait(400);
    assert.equal(sent.length, 0);
});

test("同一行里从单词滑到另一个单词会切换释义", async () => {
    const text = "Tiny habits compound over time.";
    const {node, element} = line(text);
    const caret = {node, offset: text.indexOf("Tiny") + 1};
    const {api, sent} = load({video: fakeVideo(), caretTarget: caret, lookup: {ok: true, result: null}});

    api.hoverHandleOver({target: element});
    api.hoverHandleMove({clientX: 300, clientY: 510});
    await wait(320);   // 查词有 260ms 悬停延迟
    assert.deepEqual(sent.filter((m) => m.type === "LOOKUP_WORD").map((m) => m.word), ["Tiny"]);

    // 同一个元素内的另一次位移：mouseover 不会再触发，只有 mousemove 能带动更新
    caret.offset = text.indexOf("compound") + 2;
    await wait(70);
    api.hoverHandleMove({clientX: 420, clientY: 510});
    await wait(350);

    const words = sent.filter((m) => m.type === "LOOKUP_WORD").map((m) => m.word);
    assert.deepEqual(words, ["Tiny", "compound"], "应当接着查第二个词");
});

test("节流会补发最后一次位置，指针停下就查停下的那个词", async () => {
    const text = "Tiny habits compound over time.";
    const {node, element} = line(text);
    const caret = {node, offset: text.indexOf("habits") + 2};
    const {api, sent} = load({video: fakeVideo(), caretTarget: caret, lookup: {ok: true, result: null}});

    api.hoverHandleOver({target: element});
    api.hoverHandleMove({clientX: 300, clientY: 510});
    // 紧接着的一次位移落在节流窗口内，应该被记下来而不是丢掉
    caret.offset = text.indexOf("compound") + 2;
    api.hoverHandleMove({clientX: 420, clientY: 510});
    await wait(500);

    const words = sent.filter((m) => m.type === "LOOKUP_WORD").map((m) => m.word);
    assert.equal(words.at(-1), "compound", "最后一次位置必须被处理");
});

test("浮层显示期间离开字幕不会立刻恢复播放", async () => {
    const text = "Tiny habits compound over time.";
    const {node, element} = line(text);
    const video = fakeVideo();
    const result = {word: "Tiny", phonetic: "", entries: [{pos: "adj.", variants: ["微小的"]}], source: "youdao"};
    const {api} = load({
        video,
        caretTarget: {node, offset: 1},
        lookup: {ok: true, result},
    });

    api.hoverHandleOver({target: element});
    api.hoverTrackWord({clientX: 300, clientY: 510});
    await wait(400);
    assert.equal(video.paused, true);

    // 从字幕移向浮层，中途判定成“离开字幕”
    api.hoverApplyZone("", null);
    await wait(260);
    assert.equal(video.paused, true, "浮层还在显示，不能恢复播放");

    api.hoverHideTip();
    await wait(260);
    assert.equal(video.paused, false, "浮层收起后才恢复");
});

test("鼠标落在字幕内的空隙时不立刻收起浮层", async () => {
    const text = "Tiny habits compound over time.";
    const {node, element} = line(text);
    const caret = {node, offset: 1};
    const result = {word: "Tiny", phonetic: "", entries: [{pos: "adj.", variants: ["微小的"]}], source: "youdao"};
    const {api, created} = load({
        video: fakeVideo(),
        caretTarget: caret,
        lookup: {ok: true, result},
    });

    api.hoverHandleOver({target: element});
    api.hoverTrackWord({clientX: 300, clientY: 510});
    await wait(400);
    const tip = created[0];
    assert.equal(tip.hidden, false);

    // 指到中文行：仍在字幕块内，但没有英文单词
    caret.node = {nodeType: 3, textContent: "微小习惯", parentElement: line("微小习惯", "ytbt-cn").element};
    api.hoverHandleMove({clientX: 300, clientY: 480});
    assert.equal(tip.hidden, false, "应当有宽限，不能立刻消失");

    await wait(400);
    assert.equal(tip.hidden, true, "宽限过后再收起");
});

test("换到同一行的另一个词时，旧浮层要留到新释义返回，否则点不到收藏", async () => {
    const text = "Tiny habits compound over time.";
    const {node, element} = line(text);
    const caret = {node, offset: text.indexOf("compound") + 2};
    let currentWord = "compound";

    const {api, created} = load({
        video: fakeVideo(),
        caretTarget: caret,
        lookup: {
            ok: true,
            get result() {
                return {
                    word: currentWord,
                    phonetic: "",
                    entries: [{pos: "n.", variants: [`${currentWord}的释义`]}],
                    source: "youdao",
                };
            },
        },
    });

    api.hoverHandleOver({target: element});
    api.hoverTrackWord({clientX: 320, clientY: 510});
    await wait(400);
    const tip = created[0];
    assert.equal(tip.hidden, false);
    assert.match(tip.textContent, /compound/);

    // 指针移向浮层时蹭到同一行的另一个词
    currentWord = "Tiny";
    caret.offset = text.indexOf("Tiny") + 2;
    api.hoverTrackWord({clientX: 306, clientY: 510});

    assert.equal(tip.hidden, false, "换词途中不能把浮层关掉，否则收藏按钮点不到");
    assert.match(tip.textContent, /compound/, "新释义回来之前保留旧内容");
});

function speechLookup(word) {
    return {ok: true, result: {word, phonetic: "/test/", entries: [{pos: "adj.", variants: ["测试释义"]}]}};
}

test("悬停词卡弹出时自动朗读英文单词，用本地语音并沿用语速", async () => {
    const text = "She stayed resilient after the setback.";
    const {node} = line(text);
    const video = fakeVideo();
    const f = load({
        video,
        settings: {selectionSpeakRate: 0.8},
        caretTarget: {node, offset: text.indexOf("resilient") + 2},
        lookup: speechLookup("resilient"),
        withSpeech: true,
    });

    f.api.hoverTrackWord({clientX: 400, clientY: 510});
    await wait(400);

    assert.equal(f.speech.spoken.length, 1);
    assert.equal(f.speech.spoken[0].text, "resilient", "只读单词本身，不读释义");
    assert.equal(f.speech.spoken[0].voice, "Local EN", "优先本地语音");
    assert.equal(f.speech.spoken[0].rate, 0.8, "沿用划词朗读的语速设置");
    assert.equal(video.paused, true, "朗读期间视频保持暂停");
    const tip = f.created[0];
    const speak = tip.querySelector(".ytbt-wordtip-speak");
    assert.ok(speak, "词卡应有喇叭按钮");
    assert.equal(speak.classList.contains("speaking"), true, "朗读中按钮为播放状态");
});

test("点喇叭停止朗读，再点重播同一个单词", async () => {
    const text = "Tiny habits compound over time.";
    const {node} = line(text);
    const f = load({
        video: fakeVideo(),
        caretTarget: {node, offset: text.indexOf("compound") + 2},
        lookup: speechLookup("compound"),
        withSpeech: true,
    });

    f.api.hoverTrackWord({clientX: 400, clientY: 510});
    await wait(400);
    const speak = f.created[0].querySelector(".ytbt-wordtip-speak");
    assert.ok(speak);
    const click = () => speak.handlers.click[0]({preventDefault() {}, stopPropagation() {}});

    click();
    assert.equal(f.speech.current(), null, "点击后停止播放");
    assert.equal(speak.classList.contains("speaking"), false);
    click();
    assert.equal(f.speech.spoken.length, 2, "再次点击重播");
    assert.equal(f.speech.spoken[1].text, "compound");
    assert.equal(speak.classList.contains("speaking"), true);
});

test("换词时停掉旧单词的朗读并朗读新单词，同一词不重复朗读", async () => {
    const text = "Tiny habits compound over time.";
    const {node} = line(text);
    // caretTarget 可变：取词位置改变时命中不同单词
    const caret = {node, offset: text.indexOf("Tiny") + 1};
    const f = load({
        video: fakeVideo(),
        caretTarget: caret,
        lookup: (word) => speechLookup(word),
        withSpeech: true,
    });

    f.api.hoverTrackWord({clientX: 300, clientY: 510});
    await wait(400);
    assert.deepEqual(f.speech.spoken.map(s => s.text), ["Tiny"]);

    // 同一单词重复渲染不应重复朗读
    f.api.hoverTrackWord({clientX: 305, clientY: 510});
    await wait(120);
    assert.equal(f.speech.spoken.length, 1, "同一单词不重复朗读");

    // 换到另一个词：停止旧的，朗读新的
    caret.offset = text.indexOf("compound") + 2;
    f.api.hoverTrackWord({clientX: 420, clientY: 510});
    await wait(400);
    assert.deepEqual(f.speech.spoken.map(s => s.text), ["Tiny", "compound"]);
    assert.equal(f.speech.current().text, "compound");
});

test("关闭悬停朗读开关后不朗读，运行中关闭会立刻停止", async () => {
    const text = "Tiny habits compound over time.";
    const {node} = line(text);
    const off = load({
        video: fakeVideo(),
        settings: {hoverSpeakEnabled: false},
        caretTarget: {node, offset: text.indexOf("Tiny") + 1},
        lookup: speechLookup("Tiny"),
        withSpeech: true,
    });
    off.api.hoverTrackWord({clientX: 400, clientY: 510});
    await wait(400);
    assert.equal(off.speech.spoken.length, 0, "开关关闭时不朗读");

    const onStorageChanged = {handlers: []};
    const f = load({
        video: fakeVideo(),
        caretTarget: {node, offset: text.indexOf("Tiny") + 1},
        lookup: speechLookup("Tiny"),
        withSpeech: true,
        onStorageChanged,
    });
    f.api.hoverTrackWord({clientX: 400, clientY: 510});
    await wait(400);
    assert.equal(f.speech.spoken.length, 1, "默认开启时自动朗读");
    assert.ok(onStorageChanged.handlers.length > 0, "应监听设置变更");
    onStorageChanged.handlers.forEach(handler => handler({hoverSpeakEnabled: {newValue: false}}));
    assert.equal(f.speech.current(), null, "关闭设置后立刻停止朗读");
});

test("浏览器不支持语音时词卡无喇叭按钮但不影响释义", async () => {
    const text = "Tiny habits compound over time.";
    const {node} = line(text);
    const f = load({
        video: fakeVideo(),
        caretTarget: {node, offset: text.indexOf("Tiny") + 1},
        lookup: speechLookup("Tiny"),
        withSpeech: false,
    });
    f.api.hoverTrackWord({clientX: 400, clientY: 510});
    await wait(400);
    const tip = f.created[0];
    assert.equal(tip.querySelector(".ytbt-wordtip-speak"), null, "不支持语音时不显示喇叭");
    assert.match(tip.textContent, /测试释义/, "释义仍正常显示");
});

// --- 画中画窗口里的悬停取词 ---

function pipLine(text) {
    const element = {
        className: "ytbt-pip-en",
        closest(selector) {
            if (String(selector).includes(".ytbt-pip-en")) return element;
            if (String(selector).includes(".ytbt-pip-lines")) return element;
            return null;
        },
        getBoundingClientRect() {
            return {top: 20, bottom: 42, left: 30, right: 200, width: 170, height: 22};
        },
    };
    const node = {nodeType: 3, textContent: text, parentElement: element};
    return {node, element};
}

function makePipWindow(caretTarget, created, listeners) {
    const doc = {
        body: {appendChild(el) { created.push(el); }},
        caretRangeFromPoint() {
            return {startContainer: caretTarget.node, startOffset: caretTarget.offset};
        },
        createRange() {
            return {
                startContainer: null,
                setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
                setEnd() {},
                getBoundingClientRect() {
                    return {top: 20, bottom: 42, left: 80, right: 130, width: 50, height: 22};
                },
            };
        },
        createElement(tag) {
            const el = {
                tagName: String(tag).toUpperCase(),
                className: "",
                hidden: true,
                disabled: false,
                style: {},
                children: [],
                textContent: "",
                isConnected: true,
                attrs: {},
                handlers: {},
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
                    this.textContent += child.textContent || "";
                    return child;
                },
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
                getBoundingClientRect() { return {top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0}; },
            };
            return el;
        },
        addEventListener(type, handler, capture) { listeners.push([type, handler, capture]); },
        removeEventListener(type, handler, capture) {
            const index = listeners.findIndex((item) => item[0] === type && item[1] === handler && item[2] === capture);
            if (index >= 0) listeners.splice(index, 1);
        },
    };
    return {
        document: doc,
        innerWidth: 960,
        innerHeight: 260,
        addEventListener(type, handler, capture) { listeners.push([type, handler, capture]); },
        removeEventListener(type, handler, capture) {
            const index = listeners.findIndex((item) => item[0] === type && item[1] === handler && item[2] === capture);
            if (index >= 0) listeners.splice(index, 1);
        },
    };
}

test("画中画字幕里能取词、出词卡并自动英文朗读", async () => {
    const text = "She stayed resilient after the setback.";
    const {node} = pipLine(text);
    const f = load({
        video: fakeVideo(),
        lookup: speechLookup("resilient"),
        withSpeech: true,
    });
    const created = [];
    const listeners = [];
    const pipWindow = makePipWindow({node, offset: text.indexOf("resilient") + 3}, created, listeners);
    const ctx = f.api.YTBTHover.bindPip(pipWindow);
    assert.ok(ctx, "应为画中画创建独立取词上下文");
    assert.ok(ctx.isPip);

    f.api.hoverApplyZone("subtitle", {clientX: 100, clientY: 30}, ctx);
    await wait(360);

    const tip = created.find((el) => el.className === "ytbt-wordtip");
    assert.ok(tip, "词卡应挂到画中画文档，而不是主页面");
    assert.match(tip.textContent, /resilient/);
    assert.match(tip.textContent, /测试释义/);
    assert.ok(f.speech.spoken.some((item) => item.text === "resilient"), "画中画取词也应自动英文朗读");
    assert.equal(f.video.paused, true, "停在画中画字幕上同样暂停视频");
});

test("关闭画中画会解绑取词事件并收起词卡，不影响主页面", async () => {
    const text = "She stayed resilient after the setback.";
    const {node} = pipLine(text);
    const f = load({video: fakeVideo(), lookup: speechLookup("resilient"), withSpeech: true});
    const created = [];
    const listeners = [];
    const pipWindow = makePipWindow({node, offset: text.indexOf("resilient") + 3}, created, listeners);
    const ctx = f.api.YTBTHover.bindPip(pipWindow);
    f.api.hoverApplyZone("subtitle", {clientX: 100, clientY: 30}, ctx);
    await wait(360);
    const tip = created.find((el) => el.className === "ytbt-wordtip");
    assert.ok(tip && !tip.hidden);
    assert.ok(listeners.length > 0, "画中画应有自己的事件监听");

    // 主页面词卡不受画中画影响。
    f.api.hoverHideTip();
    assert.equal(tip.hidden, false, "主页面收起词卡不应收起画中画的词卡");

    f.api.YTBTHover.unbindPip();
    assert.equal(tip.hidden, true, "关闭画中画应收起词卡");
    assert.equal(listeners.length, 0, "事件监听应全部解绑");
});

// --- 画中画字幕列表行：悬停暂停 + 取词 ---

function pipCueRow(text) {
    const source = {
        className: "ytbt-cue-source",
        closest(selector) {
            if (String(selector).includes(".ytbt-cue-source")) return source;
            if (String(selector).includes(".ytbt-cue-row")) return row;
            if (String(selector).includes(".ytbt-pip-lines") || String(selector).includes(".ytbt-lines")) return row;
            return null;
        },
        getBoundingClientRect() {
            return {top: 20, bottom: 42, left: 30, right: 200, width: 170, height: 22};
        },
    };
    const row = {
        className: "ytbt-cue-row",
        closest(selector) { return String(selector).includes(".ytbt-cue-row") ? row : null; },
        getBoundingClientRect() {
            return {top: 12, bottom: 52, left: 20, right: 220, width: 200, height: 40};
        },
    };
    const node = {nodeType: 3, textContent: text, parentElement: source};
    return {node, source, row};
}

test("画中画列表行悬停进入 transcript 区，暂停视频并取词出卡", async () => {
    const text = "We figured it out together.";
    const {node, source} = pipCueRow(text);
    const f = load({video: fakeVideo(), lookup: speechLookup("figured"), withSpeech: true});
    const created = [];
    const listeners = [];
    const pipWindow = makePipWindow({node, offset: text.indexOf("figured") + 3}, created, listeners);
    const ctx = f.api.YTBTHover.bindPip(pipWindow);
    assert.equal(ctx.transcriptSelector, ".ytbt-cue-row", "画中画上下文启用列表行暂停区");
    assert.equal(f.api.hoverZoneOf(source, ctx), "transcript", "列表行判定为 transcript 区");

    f.api.hoverApplyZone("transcript", {clientX: 100, clientY: 30, target: source}, ctx);
    await wait(360);
    const tip = created.find((el) => el.className === "ytbt-wordtip");
    assert.ok(tip, "列表行里的英文也能出词卡");
    assert.match(tip.textContent, /figured/);
    assert.equal(f.video.paused, true, "悬停列表行同样暂停视频");
});
