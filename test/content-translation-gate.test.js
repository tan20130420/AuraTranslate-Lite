const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const Core = require("../src/shared.js");

function contentScriptSource() {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
    const entry = manifest.content_scripts.find((candidate) => (candidate.js || []).includes("src/content-core.js"));
    return entry.js
        .filter((file) => file.startsWith("src/content-"))
        .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
        .join("\n");
}

function loadContent(settings) {
    const document = {
        documentElement: {classList: {toggle() {}, add() {}, remove() {}}},
        visibilityState: "visible",
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        addEventListener() {},
        createElement() {
            return {style: {}, setAttribute() {}, appendChild() {}, classList: {add() {}, remove() {}}};
        },
        body: {appendChild() {}},
        head: {appendChild() {}},
    };
    const sent = [];
    const window = {
        location: {
            hostname: "www.youtube.com",
            origin: "https://www.youtube.com",
            pathname: "/watch",
            href: "https://www.youtube.com/watch?v=video-1",
        },
        postMessage() {},
        addEventListener() {},
    };
    const context = vm.createContext({
        AbortController,
        Node: {ELEMENT_NODE: 1, TEXT_NODE: 3},
        URL,
        URLSearchParams,
        YTBTCore: Core,
        btoa,
        atob,
        clearTimeout,
        setTimeout,
        setInterval,
        clearInterval,
        chrome: {
            runtime: {
                sendMessage(message, callback) {
                    sent.push(message);
                    if (callback) callback({ok: true, items: message.type === "SEGMENT_SUBTITLES" ? {ok: true, groups: []} : {ok: true, items: []}});
                },
                onMessage: {addListener() {}},
            },
            storage: {
                local: {
                    get(defaults, callback) { callback(defaults || {}); },
                    set(values, callback) { if (callback) callback(); },
                    remove(keys, callback) { if (callback) callback(); },
                },
                onChanged: {addListener() {}},
            },
        },
        document,
        fetch: async () => ({ok: false, status: 500, text: async () => ""}),
        requestAnimationFrame() {},
        window,
        performance: {now: () => Date.now()},
        console,
    });
    context.globalThis = context;

    let source = contentScriptSource();
    source = source.replace(/\/\/ --- Bootstrap ---[\s\S]*$/, "// Bootstrap omitted in tests.\n");
    source += `
globalThis.__gate = {
  state,
  subtitleBuiltInProvider,
  canTranslateCues,
  missingApiConfigText,
  scheduleTranslations,
};
`;
    vm.runInContext(source, context);
    const api = context.__gate;
    api.sent = sent;
    if (settings) api.state.settings = Object.assign({}, api.state.settings, settings);
    return api;
}

test("没有 AI 配置时字幕自动走内置免费源，不再要求填 Key", () => {
    const api = loadContent();
    assert.equal(api.subtitleBuiltInProvider(api.state.settings), "google-free");
    assert.equal(api.canTranslateCues(), true, "默认设置下应当允许翻译");
});

test("显式选择 Bing 内置源时走 Bing", () => {
    const api = loadContent({subtitleTranslationProvider: "bing-free"});
    assert.equal(api.subtitleBuiltInProvider(api.state.settings), "bing-free");
    assert.equal(api.canTranslateCues(), true);
});

test("配置了 AI 时不降级，沿用原行为", () => {
    const api = loadContent({
        subtitleTranslationProvider: "",
        translationProvider: "deepseek",
        translationApiKey: "sk-test",
    });
    assert.equal(api.subtitleBuiltInProvider(api.state.settings), "", "有 Key 不应降级");
    assert.equal(api.canTranslateCues(), true);
});

test("提示文案不再重复 API 字样", () => {
    const api = loadContent();
    const text = api.missingApiConfigText();
    assert.doesNotMatch(text, /API API/);
    assert.match(text, /请在扩展选项页填写/);
});

test("默认设置下调度字幕会真的发出翻译请求，而不是提示配置", () => {
    const api = loadContent();
    api.state.videoId = "video-1";
    api.state.trackFingerprint = "track-1";
    api.state.settings.subtitleEnabled = true;
    api.state.settings.subtitleTranslationMode = "nearby";
    api.state.cues = [{
        id: "c1",
        sourceText: "The committee finally approved the proposal.",
        startMs: 0,
        endMs: 3000,
        status: "pending",
    }];

    api.scheduleTranslations(0, true);

    const batches = api.sent.filter((message) => message.type === "TRANSLATE_BATCH");
    assert.equal(batches.length, 1, "应当发出一个翻译批次");
    assert.equal(batches[0].cues[0].sourceText, "The committee finally approved the proposal.");
    assert.doesNotMatch(api.state.statusText || "", /扩展选项页/);
});
