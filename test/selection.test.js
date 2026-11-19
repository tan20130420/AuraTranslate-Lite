const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const {source} = require("../scripts/extension-scripts.cjs");
const {vocabularyFixture} = require("../scripts/vocabulary-test-helpers.cjs");
const Core = require("../src/shared.js");
const script = fs.readFileSync(path.resolve(__dirname, "../src/selection.js"), "utf8");const waitFor = async predicate => {
    for (let count = 0; count < 150; count++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(predicate(), "expected selection state did not arrive");
};

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
            {name: "Local ZH", lang: "zh-CN", localService: true},
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

async function page(t, storage = {}) {
    const f = vocabularyFixture({storage});
    const dom = new JSDOM(`<title>Reading guide</title><main><p id="finance">The bank offers savings accounts.</p><p id="river">We sat on the river bank.</p><p id="cn">这是一段中文文字。</p><p id="html">Literal &lt;img src=x onerror=alert(1)&gt; code.</p><div contenteditable="true" id="editor">private writing</div><input type="password" value="secret"></main>`,
        {url: "https://example.org/read", pretendToBeVisual: true, runScripts: "outside-only"});
    const {window} = dom;
    window.chrome = f.chrome;
    const speech = installSpeechStub(window);
    const zones = [];
    window.YTBTHover = {suspend: zone => zones.push(`+${zone}`), release: zone => zones.push(`-${zone}`), hideTip() {}};
    window.Range.prototype.getBoundingClientRect = () => ({top: 60, bottom: 80, left: 20, right: 200, width: 180, height: 20});
    window.eval(source("shared"));
    window.eval(source("content-ui"));
    window.eval(script);
    t.after(() => window.close());
    await waitFor(() => window.YTBTSelection.state.ready);
    return {...f, window, document: window.document, speech, zones,
        shadow: () => window.document.querySelector("[data-ytbt-selection-root]")?.shadowRoot,
        select(id, text) {
            const node = window.document.getElementById(id).firstChild;
            const start = node.textContent.indexOf(text);
            assert.ok(start >= 0);
            const range = window.document.createRange();
            range.setStart(node, start); range.setEnd(node, start + text.length);
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
            window.document.dispatchEvent(new window.Event("selectionchange"));
        },
    };
}

test("selection waits for a click, translates with context, saves and opens the vocabulary book", async t => {
    const f = await page(t);
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    assert.equal(f.requests.length, 0);
    assert.equal(f.messages.length, 0);
    f.shadow().querySelector(".selection-trigger").click();
    await waitFor(() => f.shadow()?.querySelector(".translation")?.textContent === "银行");
    assert.equal(f.requests.length, 1);
    assert.equal(f.shadow().querySelector(".selection-card").getAttribute("aria-label"), "划词翻译");
    assert.equal(f.shadow().querySelector(".selection-card header").textContent, "×");
    f.shadow().querySelector(".save").click();
    f.shadow().querySelector(".save").click();
    await waitFor(() => f.shadow()?.querySelector(".save")?.textContent === "已收藏");
    const saved = (await f.send({type: "VOCABULARY", action: "list"})).entries[0];
    assert.equal(saved.sourceText, "bank");
    assert.equal(saved.translatedText, "银行");
    assert.equal(saved.contextText, "The bank offers savings accounts.");
    assert.equal(saved.sourceUrl, "https://example.org/read");
    assert.equal(f.messages.filter(message => message.type === "VOCABULARY" && message.action === "add").length, 1);
    f.shadow().querySelector(".book").click();
    await waitFor(() => f.opened.length === 1);
    assert.ok(f.opened[0].url.endsWith("options/options.html#vocabulary"));
});

function pointerEvent(window, type, extra = {}) {
    const event = new window.Event(type);
    for (const [key, value] of Object.entries({button: 0, clientX: 150, clientY: 120, ...extra})) {
        Object.defineProperty(event, key, {value, configurable: true});
    }
    return event;
}

test("releasing the left button translates the whole selected phrase automatically", async t => {
    const f = await page(t);
    const zones = [];
    f.window.YTBTHover = {suspend: zone => zones.push(`+${zone}`), release: zone => zones.push(`-${zone}`), hideTip() {}};
    f.select("finance", "bank offers");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    assert.equal(f.requests.length, 0);

    f.document.dispatchEvent(pointerEvent(f.window, "pointerdown"));
    f.document.dispatchEvent(pointerEvent(f.window, "pointerup"));
    await waitFor(() => f.shadow()?.querySelector(".translation")?.textContent === "译文 bank offers");
    assert.equal(f.requests.length, 1);
    assert.ok(zones.includes("+selection"), "译文卡片打开期间应登记暂停区域");
});

test("dragging inside the player panel translates even though the panel stops pointerup propagation", async t => {
    const f = await page(t);
    f.window.YTBTHover = {suspend() {}, release() {}, hideTip() {}};

    // 模拟内容脚本插入的悬浮字幕面板：它在根节点上拦截 pointerup 冒泡。
    const panel = f.document.createElement("div");
    panel.className = "ytbt-player-ui";
    panel.addEventListener("pointerup", event => event.stopPropagation());
    const cue = f.document.createElement("span");
    cue.className = "ytbt-cue-source";
    cue.textContent = "We sat on the river bank.";
    panel.appendChild(cue);
    f.document.body.appendChild(panel);

    const pointer = (type) => {
        const event = new f.window.Event(type, {bubbles: true, composed: true});
        for (const [key, value] of Object.entries({button: 0, clientX: 150, clientY: 120})) {
            Object.defineProperty(event, key, {value, configurable: true});
        }
        return event;
    };

    cue.dispatchEvent(pointer("pointerdown"));
    const node = cue.firstChild;
    const range = f.document.createRange();
    range.setStart(node, 20);
    range.setEnd(node, 24);
    const selection = f.window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    f.document.dispatchEvent(new f.window.Event("selectionchange"));
    assert.equal(f.requests.length, 0, "拖拽过程中不应提前翻译");

    cue.dispatchEvent(pointer("pointerup"));
    await waitFor(() => f.shadow()?.querySelector(".translation")?.textContent === "河岸");
    assert.equal(f.requests.length, 1);
});

test("turning off auto translate restores the click-to-translate toolbar", async t => {
    const f = await page(t, {selectionAutoTranslate: false});
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    f.document.dispatchEvent(pointerEvent(f.window, "pointerdown"));
    f.document.dispatchEvent(pointerEvent(f.window, "pointerup"));
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(f.requests.length, 0);
    assert.ok(f.shadow()?.querySelector(".selection-trigger"), "仍应显示手动翻译按钮");
});

test("pinned translation stays while a new selection is translated", async t => {
    const f = await page(t);
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    f.shadow().querySelector(".selection-trigger").click();
    await waitFor(() => f.shadow()?.querySelector(".translation")?.textContent === "银行");
    f.shadow().querySelector('[data-action="pin"]').click();
    const activeShadow = () => f.document.querySelector("[data-ytbt-selection-root]:not([data-ytbt-selection-pinned])")?.shadowRoot;
    await waitFor(() => !activeShadow());

    const pinnedHosts = () => [...f.document.querySelectorAll("[data-ytbt-selection-pinned]")];
    assert.equal(pinnedHosts().length, 1);
    assert.match(pinnedHosts()[0].shadowRoot.textContent, /银行/);

    f.select("river", "bank");
    await waitFor(() => activeShadow()?.querySelector(".selection-trigger"));
    assert.equal(pinnedHosts().length, 1, "新选区不应顶掉已固定的译文");
    assert.match(pinnedHosts()[0].shadowRoot.textContent, /银行/);

    pinnedHosts()[0].shadowRoot.querySelector('[data-action="unpin"]').click();
    await waitFor(() => pinnedHosts().length === 0);
});

test("a newer selection and dismissal invalidate late translation results", async t => {
    const f = await page(t);
    const pending = [];
    f.chrome.runtime.sendMessage = (message, done) => pending.push({message, done});
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    f.shadow().querySelector(".selection-trigger").click();
    f.select("river", "bank");
    await waitFor(() => f.window.YTBTSelection.state.selection.contextText.includes("river"));
    pending[0].done({ok: true, translatedText: "银行"});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(f.shadow().querySelector(".selection-trigger"));
    assert.equal(f.shadow().querySelector(".translation"), null);
    f.shadow().querySelector(".selection-trigger").click();
    f.window.YTBTSelection.dismiss();
    pending[1].done({ok: true, translatedText: "河岸"});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.shadow(), undefined);
});

test("disabled mode, editable fields and oversized text never show a translation control", async t => {
    const f = await page(t, {selectionTranslationEnabled: false});
    f.select("finance", "bank");
    await new Promise(resolve => setTimeout(resolve, 210));
    assert.equal(f.shadow(), undefined);
    await new Promise(resolve => f.chrome.storage.local.set({selectionTranslationEnabled: true}, resolve));
    f.select("editor", "private");
    await new Promise(resolve => setTimeout(resolve, 210));
    assert.equal(f.shadow(), undefined);
    f.document.getElementById("finance").textContent = "x".repeat(3001);
    f.select("finance", "x".repeat(3001));
    await new Promise(resolve => setTimeout(resolve, 210));
    assert.equal(f.shadow(), undefined);
    assert.equal(f.requests.length, 0);
});

test("failure is visible and explicit retry succeeds; settings disable closes the card immediately", async t => {
    const f = await page(t);
    const original = f.chrome.runtime.sendMessage;
    let failed = false;
    f.chrome.runtime.sendMessage = (message, done) => {
        if (!failed && message.type === "SELECTION_TRANSLATE") {failed = true; done({ok: false, error: "API Key is not configured"});}
        else original(message, done);
    };
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    f.shadow().querySelector(".selection-trigger").click();
    await waitFor(() => f.shadow()?.querySelector(".error"));
    assert.match(f.shadow().querySelector(".error").textContent, /API Key/);
    assert.equal(f.requests.length, 0);
    f.shadow().querySelector(".retry").click();
    await waitFor(() => f.shadow()?.querySelector(".translation")?.textContent === "银行");
    await new Promise(resolve => f.chrome.storage.local.set({selectionTranslationEnabled: false}, resolve));
    assert.equal(f.shadow(), undefined);
});

test("literal source text is displayed as text and repeated injection installs one controller", async t => {
    const f = await page(t);
    const controller = f.window.YTBTSelection;
    f.window.eval(script);
    assert.equal(f.window.YTBTSelection, controller);
    f.select("html", "<img src=x onerror=alert(1)>");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    f.shadow().querySelector(".selection-trigger").click();
    await waitFor(() => f.shadow()?.querySelector(".save"));
    assert.equal(f.shadow().querySelector(".source").textContent, "<img src=x onerror=alert(1)>");
    assert.equal(f.shadow().querySelector("img"), null);
    assert.equal(f.document.querySelectorAll("[data-ytbt-selection-root]").length, 1);
});

test("toolbar settings reject unknown actions and keep a translation entry without mutating defaults", () => {
    assert.deepEqual(Core.normalizeSelectionToolbar({actions: ["copy", "copy", "unknown"], size: "huge", showLabels: "yes", position: "left"}),
        {actions: ["translate", "copy"], size: "compact", showLabels: false, position: "below"});
    const value = Core.normalizeSelectionToolbar();
    value.actions.push("copy");
    assert.deepEqual(Core.normalizeSelectionToolbar().actions, ["translate"]);
    assert.deepEqual(Core.normalizeSelectionToolbar(null), Core.DEFAULT_SETTINGS.selectionToolbar);
});

test("toolbar actions, order and labels update on an already selected word without a provider call", async t => {
    const f = await page(t);
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    assert.equal(f.shadow().querySelectorAll(".selection-tool").length, 1);
    assert.equal(f.shadow().querySelector(".selection-trigger").textContent, "");
    assert.ok(f.shadow().querySelector(".selection-trigger svg"));
    await new Promise(resolve => f.chrome.storage.local.set({selectionToolbar: {
        actions: ["copy", "translate", "vocabulary", "dismiss"], size: "regular", showLabels: true, position: "above",
    }}, resolve));
    const toolbar = f.shadow().querySelector('[role="toolbar"]');
    assert.equal(toolbar.dataset.size, "regular");
    assert.deepEqual([...toolbar.querySelectorAll("button")].map(button => button.textContent), ["复制", "翻译", "生词本", "关闭"]);
    assert.ok(parseFloat(f.window.YTBTSelection.state.host.style.top) < 60, "toolbar prefers the space above the selection");
    const buttons = [...toolbar.querySelectorAll("button")];
    buttons[0].focus();
    buttons[0].dispatchEvent(new f.window.KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
    assert.equal(f.shadow().activeElement, buttons[1]);
    assert.equal(f.requests.length, 0);
    assert.equal(f.messages.length, 0);
    buttons[2].click();
    await waitFor(() => f.opened.length === 1);
    assert.equal(f.requests.length, 0, "opening the notebook does not translate the selection");
    buttons[3].click();
    assert.equal(f.shadow(), undefined);
});

test("copy succeeds locally, reports permission failure and ignores stale completions", async t => {
    const f = await page(t, {selectionToolbar: {actions: ["translate", "copy"]}});
    const copied = [];
    Object.defineProperty(f.window.navigator, "clipboard", {value: {writeText: async text => copied.push(text)}, configurable: true});
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector('[data-action="copy"]'));
    f.shadow().querySelector('[data-action="copy"]').click();
    await waitFor(() => f.shadow()?.querySelector('[data-copied="true"]'));
    assert.deepEqual(copied, ["bank"]);
    assert.equal(f.window.getSelection().toString(), "bank");
    f.window.navigator.clipboard.writeText = async () => {throw new Error("NotAllowedError");};
    f.shadow().querySelector('[data-action="copy"]').click();
    await waitFor(() => f.shadow()?.querySelector(".toolbar-feedback"));
    assert.match(f.shadow().querySelector(".toolbar-feedback").textContent, /无法复制/);
    assert.equal(f.shadow().querySelector(".selection-card"), null);
    let finish;
    f.window.navigator.clipboard.writeText = () => new Promise(resolve => {finish = resolve;});
    f.shadow().querySelector('[data-action="copy"]').click();
    f.select("river", "bank");
    await waitFor(() => f.window.YTBTSelection.state.selection.contextText.includes("river"));
    finish();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.shadow().querySelector('[data-copied="true"]'), null);
    assert.equal(f.requests.length, 0);
    assert.equal(f.messages.length, 0);
});

test("copy fallback preserves the selected text and reports unavailable copy without translating", async t => {
    const f = await page(t, {selectionToolbar: {actions: ["translate", "copy"]}});
    let copied = "";
    f.document.execCommand = command => {
        assert.equal(command, "copy");
        copied = f.shadow().querySelector("textarea").value;
        return true;
    };
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector('[data-action="copy"]'));
    f.shadow().querySelector('[data-action="copy"]').click();
    await waitFor(() => f.shadow()?.querySelector('[data-copied="true"]'));
    assert.equal(copied, "bank");
    assert.equal(f.window.getSelection().toString(), "bank");
    assert.equal(f.shadow().querySelector("textarea"), null);
    f.document.execCommand = () => false;
    f.shadow().querySelector('[data-action="copy"]').click();
    assert.match(f.shadow().querySelector(".toolbar-feedback").textContent, /无法复制/);
    assert.equal(f.window.getSelection().toString(), "bank");
    assert.equal(f.requests.length, 0);
});

test("copy keeps the original whitespace while translation receives normalized text", async t => {
    const f = await page(t, {selectionToolbar: {actions: ["translate", "copy"]}});
    f.document.getElementById("finance").textContent = "The bank\n  offers savings accounts.";
    let copied;
    Object.defineProperty(f.window.navigator, "clipboard", {value: {writeText: async text => {copied = text;}}});
    f.select("finance", "bank\n  offers");
    await waitFor(() => f.shadow()?.querySelector('[data-action="copy"]'));
    f.shadow().querySelector('[data-action="copy"]').click();
    await waitFor(() => f.shadow()?.querySelector('[data-copied="true"]'));
    assert.equal(copied, "bank\n  offers");
    f.shadow().querySelector(".selection-trigger").click();
    await waitFor(() => f.shadow()?.querySelector(".save"));
    const message = f.messages.find(message => message.type === "SELECTION_TRANSLATE");
    assert.equal(message.sourceText, "bank offers");
    assert.equal(message.originalText, undefined);
});

test("toolbar settings preserve pending and completed translations and reset immediately on removal", async t => {
    const f = await page(t);
    let finish;
    f.chrome.runtime.sendMessage = (_, done) => {finish = done;};
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    f.shadow().querySelector(".selection-trigger").click();
    await new Promise(resolve => f.chrome.storage.local.set({selectionToolbar: {actions: ["copy", "translate"], position: "above"}}, resolve));
    assert.equal(f.shadow().querySelector(".translation").textContent, "正在翻译…");
    assert.equal(f.shadow().querySelector(".selection-toolbar"), null);
    finish({ok: true, translatedText: "银行"});
    await waitFor(() => f.shadow()?.querySelector(".translation").textContent === "银行");
    await new Promise(resolve => f.chrome.storage.local.set({selectionToolbar: null}, resolve));
    assert.equal(f.shadow().querySelector(".translation").textContent, "银行");
    f.window.YTBTSelection.dismiss();
    f.select("river", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    assert.equal(f.shadow().querySelectorAll(".selection-tool").length, 1);
});

test("releasing a selection reads the chosen text aloud with a local voice", async t => {
    const f = await page(t);
    f.document.dispatchEvent(pointerEvent(f.window, "pointerdown"));
    f.select("finance", "bank offers");
    assert.equal(f.speech.spoken.length, 0, "拖拽过程中不应提前朗读");

    f.document.dispatchEvent(pointerEvent(f.window, "pointerup"));
    await waitFor(() => f.shadow()?.querySelector(".speak.speaking"));
    assert.equal(f.speech.spoken.length, 1);
    assert.equal(f.speech.spoken[0].text, "bank offers");
    assert.equal(f.speech.spoken[0].lang, "en-GB", "本地语音应优先于在线语音");
    assert.equal(f.speech.spoken[0].rate, 1);
    assert.ok(f.zones.includes("+speech"), "朗读期间应暂停视频");
});

test("speaker toggles stop and replay, and Chinese text picks a Chinese voice", async t => {
    const f = await page(t);
    f.document.dispatchEvent(pointerEvent(f.window, "pointerdown"));
    f.select("finance", "bank");
    f.document.dispatchEvent(pointerEvent(f.window, "pointerup"));
    await waitFor(() => f.shadow()?.querySelector(".speak.speaking"));
    assert.equal(f.speech.spoken[0].text, "bank");

    f.shadow().querySelector('[data-action="speak"]').click();
    assert.equal(f.shadow().querySelector(".speak.speaking"), null);
    assert.equal(f.speech.current(), null);
    assert.ok(f.zones.includes("-speech"));

    f.shadow().querySelector('[data-action="speak"]').click();
    assert.ok(f.shadow().querySelector(".speak.speaking"));
    assert.equal(f.speech.spoken.length, 2, "再次点击应重播");

    f.document.dispatchEvent(pointerEvent(f.window, "pointerdown"));
    f.select("cn", "中文");
    f.document.dispatchEvent(pointerEvent(f.window, "pointerup"));
    await waitFor(() => f.shadow()?.querySelector(".source")?.textContent === "中文");
    assert.equal(f.speech.spoken.at(-1).text, "中文");
    assert.equal(f.speech.spoken.at(-1).lang, "zh-CN");
});

test("turning off auto speak keeps manual replay and applies the rate setting", async t => {
    const f = await page(t, {selectionSpeakEnabled: false, selectionSpeakRate: 0.8});
    f.document.dispatchEvent(pointerEvent(f.window, "pointerdown"));
    f.select("finance", "bank");
    f.document.dispatchEvent(pointerEvent(f.window, "pointerup"));
    await waitFor(() => f.shadow()?.querySelector(".selection-card"));
    assert.equal(f.speech.spoken.length, 0, "关闭后不应自动朗读");

    f.shadow().querySelector('[data-action="speak"]').click();
    await waitFor(() => f.shadow()?.querySelector(".speak.speaking"));
    assert.equal(f.speech.spoken[0].rate, 0.8);
});

test("pinned card can read its own text and dismiss stops playback", async t => {
    const f = await page(t);
    f.select("finance", "bank");
    await waitFor(() => f.shadow()?.querySelector(".selection-trigger"));
    f.shadow().querySelector(".selection-trigger").click();
    await waitFor(() => f.shadow()?.querySelector(".save"));
    f.shadow().querySelector('[data-action="pin"]').click();
    const pinned = f.document.querySelector("[data-ytbt-selection-pinned]")?.shadowRoot;
    await waitFor(() => pinned?.querySelector('[data-action="speak"]'));
    pinned.querySelector('[data-action="speak"]').click();
    await waitFor(() => pinned.querySelector(".speak.speaking"));
    assert.equal(f.speech.spoken.at(-1).text, "bank");
    pinned.querySelector('[data-action="unpin"]').click();
    assert.equal(f.speech.current(), null);
});

test("missing speech support disables the speaker but keeps translation working", async t => {
    const f = await page(t);
    f.window.speechSynthesis = undefined;
    f.document.dispatchEvent(pointerEvent(f.window, "pointerdown"));
    f.select("finance", "bank");
    f.document.dispatchEvent(pointerEvent(f.window, "pointerup"));
    await waitFor(() => f.shadow()?.querySelector(".selection-card"));
    assert.equal(f.shadow().querySelector('[data-action="speak"]').disabled, true);
    await waitFor(() => f.shadow()?.querySelector(".translation")?.textContent === "银行");
});
