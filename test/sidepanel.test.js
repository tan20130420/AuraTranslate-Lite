const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {JSDOM} = require("jsdom");

const script = fs.readFileSync(path.join(__dirname, "..", "sidepanel", "sidepanel.js"), "utf8");

function fixture(t, transcript) {
    const html = `<header>
        <strong class="sp-title">全部字幕</strong>
        <button data-action="refresh">↻</button>
        <p id="sp-video" hidden></p>
        <input type="search" id="sp-search">
        <label><input type="checkbox" id="sp-hide-translation"></label>
        <span id="sp-count"></span>
    </header>
    <main id="sp-list" tabindex="0"></main>
    <div id="sp-card" hidden></div>`;
    const dom = new JSDOM(html, {url: "https://example.com/sidepanel/sidepanel.html", runScripts: "outside-only", pretendToBeVisual: true});
    t.after(() => dom.window.close());
    const win = dom.window;
    const messages = [];
    win.chrome = {
        runtime: {
            sendMessage(message, callback) {
                messages.push(message);
                if (message.type === "SIDE_PANEL_GET") callback({ok: true, transcript});
                else if (message.type === "LOOKUP_WORD") callback({ok: true, result: {
                    word: message.word, phonetic: "/test/", entries: [{pos: "n.", variants: ["测试释义"]}]
                }});
                else if (message.type === "SELECTION_TRANSLATE") callback({ok: true, sourceText: message.sourceText, translatedText: "多选译文", contextText: "上下文"});
                else callback({ok: true});
            }
        }
    };
    // JSDOM 不支持 CSS Highlight API，mock 以便验证 hover 高亮不占用真实选区。
    win.Highlight = class Highlight { constructor(ranges) { this.ranges = ranges; } };
    win.CSS.highlights = {map: new Map(), set(k, v) { this.map.set(k, v); }, delete(k) { this.map.delete(k); }};
    win.YTBTCore = {
        sendRuntimeMessage(runtime, message, timeout) {
            return new Promise((resolve, reject) => {
                win.chrome.runtime.sendMessage(message, (res) => {
                    if (!res) reject(new Error("no response")); else resolve(res);
                });
            });
        },
        getCaptionDisplayCues(cues) { return cues; }
    };
    vm.runInContext(script, dom.getInternalVMContext(), {filename: "sidepanel.js"});
    return {win, messages, $: (q) => win.document.querySelector(q), $$: (q) => [...win.document.querySelectorAll(q)]};
}

const flush = () => new Promise((r) => setTimeout(r, 30));

test("侧边栏按时间码列出全部字幕，含原文与译文", async (t) => {
    const transcript = {
        videoTitle: "Demo", sourceLanguage: "en", targetLanguage: "zh-CN",
        cues: [
            {startMs: 0, endMs: 5000, displaySourceText: "Hello world", sourceText: "Hello world", translatedText: "你好世界"},
            {startMs: 65000, endMs: 70000, displaySourceText: "Second line", sourceText: "Second line", translatedText: "第二行"}
        ]
    };
    const f = fixture(t, transcript);
    await flush();
    assert.equal(f.$$(".sp-cue-row").length, 2, "列出全部字幕");
    assert.equal(f.$(".sp-cue-time").textContent, "00:00", "首行时间码");
    assert.equal(f.$$(".sp-cue-time")[1].textContent, "01:05", "带分钟的时间码");
    assert.equal(f.$(".sp-cue-source").textContent, "Hello world");
    assert.equal(f.$(".sp-cue-translation").textContent, "你好世界");
    assert.equal(f.$("#sp-count").textContent, "2 条字幕");
    assert.equal(f.$("#sp-video").textContent, "Demo");
});

test("搜索按原文或译文过滤字幕", async (t) => {
    const transcript = {cues: [
        {startMs: 0, displaySourceText: "Hello world", sourceText: "Hello world", translatedText: "你好"},
        {startMs: 1000, displaySourceText: "Goodbye", sourceText: "Goodbye", translatedText: "再见"}
    ]};
    const f = fixture(t, transcript);
    await flush();
    const search = f.$("#sp-search");
    search.value = "再见";
    search.dispatchEvent(new f.win.Event("input", {bubbles: true}));
    assert.equal(f.$$(".sp-cue-row").length, 1, "按译文过滤");
    assert.equal(f.$(".sp-cue-source").textContent, "Goodbye");
});

test("点击字幕行发送跳转消息，带对应时间；点击非字幕区域不跳转", async (t) => {
    const transcript = {cues: [
        {startMs: 0, sourceText: "Line one", translatedText: "第一行"},
        {startMs: 65000, sourceText: "Line two", translatedText: "第二行"}
    ]};
    const f = fixture(t, transcript);
    await flush();
    const rows = f.$$(".sp-cue-row");
    assert.equal(rows[1].getAttribute("data-start-ms"), "65000", "行携带起始时间");
    rows[1].dispatchEvent(new f.win.MouseEvent("click", {bubbles: true}));
    await flush();
    const seek = f.messages.filter((m) => m.type === "SIDE_PANEL_SEEK");
    assert.equal(seek.length, 1, "发起一次跳转");
    assert.equal(seek[0].startMs, 65000, "跳转到该句时间");
    // 侧边栏自身不直接发播放控制消息，跳转由后台转发到视频页
    assert.equal(f.messages.filter((m) => /^(SEEK|PLAY|PAUSE)/i.test(m.type || "")).length, 0);

    // 点击 header 等非字幕区域不应跳转
    f.$("#sp-count").dispatchEvent(new f.win.MouseEvent("click", {bubbles: true}));
    await flush();
    assert.equal(f.messages.filter((m) => m.type === "SIDE_PANEL_SEEK").length, 1, "非字幕区不跳转");
});

test("划词选区存在时点击字幕行不跳转，避免清掉选区", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "a big phrase", sourceText: "a big phrase", translatedText: "短语"}]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    const range = f.win.document.createRange();
    range.setStart(source.firstChild, 2);
    range.setEnd(source.firstChild, 12);
    const sel = f.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    f.$(".sp-cue-row").dispatchEvent(new f.win.MouseEvent("click", {bubbles: true}));
    await flush();
    assert.equal(f.messages.filter((m) => m.type === "SIDE_PANEL_SEEK").length, 0, "有选区时不跳转");
});

test("划多词触发 SELECTION_TRANSLATE 且译文入卡", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "a big phrase here", sourceText: "a big phrase here", translatedText: "一个大短语"}]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    const range = f.win.document.createRange();
    range.setStart(source.firstChild, 2);
    range.setEnd(source.firstChild, 12); // "big phrase"
    const sel = f.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    f.$("#sp-list").dispatchEvent(new f.win.Event("pointerup", {bubbles: true}));
    await flush();
    const translate = f.messages.find((m) => m.type === "SELECTION_TRANSLATE");
    assert.ok(translate, "发起划词翻译");
    assert.equal(translate.sourceText, "big phrase");
    assert.equal(f.$("#sp-card").hidden, false, "译文卡显示");
    assert.match(f.$("#sp-card").textContent, /多选译文/);
});

test("收藏单词后词卡短暂显示已收藏再自动隐藏", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "democrats", sourceText: "democrats", translatedText: "民主党人"}]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    // 选中整个单词触发取词卡
    const range = f.win.document.createRange();
    range.selectNodeContents(source);
    const sel = f.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    f.$("#sp-list").dispatchEvent(new f.win.Event("pointerup", {bubbles: true}));
    await new Promise((r) => setTimeout(r, 350)); // 等查词延时
    assert.equal(f.$("#sp-card").hidden, false, "词卡已显示");
    const save = f.$("#sp-card .sp-card-save");
    assert.ok(save, "有收藏按钮");
    save.dispatchEvent(new f.win.MouseEvent("click", {bubbles: true}));
    await flush();
    assert.match(f.$("#sp-card .sp-card-save")?.textContent || "", /已收藏/, "先显示已收藏反馈");
    assert.equal(f.$("#sp-card").hidden, false, "反馈期间仍显示");
    // 等待收起延时
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(f.$("#sp-card").hidden, true, "收藏后词卡自动隐藏");
    const saved = f.messages.filter((m) => m.type === "VOCABULARY" && m.action === "add");
    assert.equal(saved.length, 1, "只收藏一次");
});

test("收藏划词译文后译文卡也会自动隐藏", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "a big phrase here", sourceText: "a big phrase here", translatedText: "一个大短语"}]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    const range = f.win.document.createRange();
    range.setStart(source.firstChild, 2);
    range.setEnd(source.firstChild, 12);
    const sel = f.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    f.$("#sp-list").dispatchEvent(new f.win.Event("pointerup", {bubbles: true}));
    await flush();
    const save = f.$("#sp-card .sp-card-save");
    assert.ok(save, "译文卡有收藏按钮");
    save.dispatchEvent(new f.win.MouseEvent("click", {bubbles: true}));
    await flush();
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(f.$("#sp-card").hidden, true, "收藏后译文卡自动隐藏");
});

test("隐藏译文开关：勾选后只显示原文，取消后恢复译文", async (t) => {
    const transcript = {cues: [
        {startMs: 0, displaySourceText: "Hello world", sourceText: "Hello world", translatedText: "你好世界"},
        {startMs: 1000, displaySourceText: "Second line", sourceText: "Second line", translatedText: "第二行"}
    ]};
    const f = fixture(t, transcript);
    await flush();
    assert.equal(f.$$(".sp-cue-translation").length, 2, "默认显示译文");

    const toggle = f.$("#sp-hide-translation");
    toggle.checked = true;
    toggle.dispatchEvent(new f.win.Event("change", {bubbles: true}));
    assert.equal(f.$$(".sp-cue-translation").length, 0, "勾选后不显示译文");
    assert.equal(f.$$(".sp-cue-source").length, 2, "原文仍完整保留");
    assert.equal(f.$$(".sp-cue-time").length, 2, "时间码仍保留");

    toggle.checked = false;
    toggle.dispatchEvent(new f.win.Event("change", {bubbles: true}));
    assert.equal(f.$$(".sp-cue-translation").length, 2, "取消后恢复译文");
});

test("隐藏译文后仍可划词取词，且偏好写入 localStorage", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "democrats", sourceText: "democrats", translatedText: "民主党人"}]};
    const f = fixture(t, transcript);
    await flush();
    const toggle = f.$("#sp-hide-translation");
    toggle.checked = true;
    toggle.dispatchEvent(new f.win.Event("change", {bubbles: true}));
    assert.equal(f.win.localStorage.getItem("auratranslate:sidepanelHideTranslation"), "1", "偏好已保存");

    // 隐藏译文仍能取词
    const source = f.$(".sp-cue-source");
    const range = f.win.document.createRange();
    range.selectNodeContents(source);
    const sel = f.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    f.$("#sp-list").dispatchEvent(new f.win.Event("pointerup", {bubbles: true}));
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(f.$("#sp-card").hidden, false, "隐藏译文时仍可取词");
});

test("hover 词卡显示后不影响真实选区，移到新单词能显示新卡片", async (t) => {
    const transcript = {cues: [
        {startMs: 0, displaySourceText: "alpha beta", sourceText: "alpha beta", translatedText: "甲乙"}
    ]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    // JSDOM 无 caretRangeFromPoint：把 x 当作文本 offset，返回折叠 range。
    f.win.document.caretRangeFromPoint = (x) => {
        const range = f.win.document.createRange();
        range.setStart(source.firstChild, Math.max(0, Math.min(x, source.firstChild.length)));
        range.collapse(true);
        return range;
    };
    const list = f.$("#sp-list");
    const move = (x) => list.dispatchEvent(new f.win.MouseEvent("pointermove", {
        bubbles: true, clientX: x, clientY: 1, buttons: 0
    }));

    // 悬停在 alpha（offset 2）
    move(2);
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(f.$("#sp-card").hidden, false, "alpha 词卡显示");
    assert.match(f.$("#sp-card").textContent, /alpha/, "卡片为 alpha");
    assert.equal(f.win.getSelection().isCollapsed, true, "取词后真实选区保持折叠");
    assert.equal(f.win.CSS.highlights.map.has("aura-sidepanel-hover"), true, "高亮走 CSS Highlight");

    // 移到 beta（offset 7）—— 这是本 bug 的关键回归点
    move(7);
    await new Promise((r) => setTimeout(r, 350));
    assert.match(f.$("#sp-card").textContent, /beta/, "移到新词后卡片更新为 beta");
    const lookups = f.messages.filter((m) => m.type === "LOOKUP_WORD");
    assert.deepEqual(lookups.map((m) => m.word), ["alpha", "beta"], "对新词发起了查词");
    assert.equal(f.win.getSelection().isCollapsed, true, "切换后选区仍折叠");
});

test("click 选中单词触发词卡后，真实选区被清空，仍可继续 hover 新词", async (t) => {
    const transcript = {cues: [
        {startMs: 0, displaySourceText: "gamma delta", sourceText: "gamma delta", translatedText: "丙丁"}
    ]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    // 先真实选中 gamma 并 pointerup 触发词卡
    const range = f.win.document.createRange();
    range.setStart(source.firstChild, 0);
    range.setEnd(source.firstChild, 5);
    const sel = f.win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    f.$("#sp-list").dispatchEvent(new f.win.Event("pointerup", {bubbles: true}));
    await new Promise((r) => setTimeout(r, 350));
    assert.match(f.$("#sp-card").textContent, /gamma/, "gamma 词卡显示");
    assert.equal(sel.isCollapsed, true, "词卡显示后真实选区被清空");
});

test("光标离开单词后词卡延时自动收起", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "alpha", sourceText: "alpha", translatedText: "甲"}]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    f.win.document.caretRangeFromPoint = (x) => {
        const range = f.win.document.createRange();
        range.setStart(source.firstChild, Math.max(0, Math.min(x, source.firstChild.length)));
        range.collapse(true);
        return range;
    };
    const list = f.$("#sp-list");
    list.dispatchEvent(new f.win.MouseEvent("pointermove", {bubbles: true, clientX: 2, clientY: 1, buttons: 0}));
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(f.$("#sp-card").hidden, false, "词卡已显示");

    // 光标从词上离开到空白处（caretRangeFromPoint 返回 null）
    f.win.document.caretRangeFromPoint = () => null;
    list.dispatchEvent(new f.win.MouseEvent("pointermove", {bubbles: true, clientX: 500, clientY: 500, buttons: 0}));
    assert.equal(f.$("#sp-card").hidden, false, "离开瞬间仍在（延时中）");
    await new Promise((r) => setTimeout(r, 1350));
    assert.equal(f.$("#sp-card").hidden, true, "离开约 1.2 秒后自动收起");
});

test("光标移到词卡上时取消收起，能点到收藏按钮", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "alpha", sourceText: "alpha", translatedText: "甲"}]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    f.win.document.caretRangeFromPoint = (x) => {
        const range = f.win.document.createRange();
        range.setStart(source.firstChild, Math.max(0, Math.min(x, source.firstChild.length)));
        range.collapse(true);
        return range;
    };
    const list = f.$("#sp-list");
    list.dispatchEvent(new f.win.MouseEvent("pointermove", {bubbles: true, clientX: 2, clientY: 1, buttons: 0}));
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(f.$("#sp-card").hidden, false, "词卡已显示");

    // 离开单词到空白，随后移入卡片（模拟去点收藏）
    f.win.document.caretRangeFromPoint = () => null;
    list.dispatchEvent(new f.win.MouseEvent("pointermove", {bubbles: true, clientX: 500, clientY: 500, buttons: 0}));
    f.$("#sp-card").dispatchEvent(new f.win.MouseEvent("pointerenter", {bubbles: false}));
    await new Promise((r) => setTimeout(r, 1350));
    assert.equal(f.$("#sp-card").hidden, false, "光标在卡片上时不会被收起");
    const save = f.$("#sp-card .sp-card-save");
    assert.ok(save, "收藏按钮仍可点击");
    save.dispatchEvent(new f.win.MouseEvent("click", {bubbles: true}));
    await flush();
    assert.match(f.$("#sp-card .sp-card-save")?.textContent || "", /已收藏/, "收藏成功");
});

test("光标离开词卡后较快收起", async (t) => {
    const transcript = {cues: [{startMs: 0, displaySourceText: "alpha", sourceText: "alpha", translatedText: "甲"}]};
    const f = fixture(t, transcript);
    await flush();
    const source = f.$(".sp-cue-source");
    f.win.document.caretRangeFromPoint = (x) => {
        const range = f.win.document.createRange();
        range.setStart(source.firstChild, Math.max(0, Math.min(x, source.firstChild.length)));
        range.collapse(true);
        return range;
    };
    const list = f.$("#sp-list");
    list.dispatchEvent(new f.win.MouseEvent("pointermove", {bubbles: true, clientX: 2, clientY: 1, buttons: 0}));
    await new Promise((r) => setTimeout(r, 350));
    const cardEl = f.$("#sp-card");
    cardEl.dispatchEvent(new f.win.MouseEvent("pointerenter", {bubbles: false}));
    cardEl.dispatchEvent(new f.win.MouseEvent("pointerleave", {bubbles: false}));
    assert.equal(cardEl.hidden, false, "刚离开卡片仍在");
    await new Promise((r) => setTimeout(r, 550));
    assert.equal(cardEl.hidden, true, "离开卡片后较快收起");
});
