const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {JSDOM} = require("jsdom");
const Core = require("../src/shared.js");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function fixture(t, settings = {}) {
    const dom = new JSDOM('<div id="movie_player" class="html5-video-player"><video></video><div class="ytp-right-controls"><button>Settings</button></div></div>', {
        url: "https://www.youtube.com/watch?v=one", runScripts: "outside-only", pretendToBeVisual: true
    });
    t.after(() => dom.window.close());
    const win = dom.window;
    const stored = {...Core.DEFAULT_SETTINGS, ...settings};
    win.YTBTCore = Core;
    const sent = [];
    win.chrome = {
        runtime: {
            getURL: (file) => `https://extension.invalid/${file}`,
            getManifest: () => ({version: "0.5.1"}),
            sendMessage(message, callback) { sent.push(message); callback({ok: true, opened: true}); }
        },
        storage: {
            local: {
                get(defaults, callback) { callback({...defaults, ...stored}); },
                set(values, callback) { Object.assign(stored, values); callback(); }
            },
            onChanged: {addListener() {}}
        }
    };
    const manifest = JSON.parse(read("manifest.json"));
    for (const file of manifest.content_scripts[0].js.filter((file) => file.startsWith("src/content-") || file.startsWith("src/ui/"))) {
        const source = read(file).split("// --- Bootstrap ---")[0];
        vm.runInContext(source, dom.getInternalVMContext(), {filename: file});
    }
    win.eval("state.settings = normalizeSettings({});");
    Object.assign(win.state.settings, stored);
    win.scheduleTranslations = () => {};
    win.bindStorageChanges();
    win.updatePlayerControls();
    win.ensureOverlay();
    win.state.videoId = "one";
    win.state.video = win.document.querySelector("video");
    win.state.cues = [
        {id: "0", startMs: 0, endMs: 9000, sourceText: "Hello world", translatedText: "你好世界", status: "translated"},
        {id: "1", startMs: 10000, endMs: 19000, sourceText: "Second chapter", translatedText: "第二章节", status: "translated"}
    ];
    return {win, stored, sent, $: (q) => win.document.querySelector(q), $$: (q) => [...win.document.querySelectorAll(q)]};
}

test("查看全部字幕推送完整字幕到后台并请求打开侧边栏，不影响视频", async (t) => {
    const f = fixture(t);
    await f.win.handlePlayerControlAction("full-view");
    const open = f.sent.find((m) => m.type === "OPEN_SIDE_PANEL");
    assert.ok(open, "发送了打开侧边栏消息");
    assert.equal(open.videoId, "one");
    assert.equal(open.cues.length, 2, "完整字幕被推送");
    assert.equal(open.cues[0].sourceText, "Hello world");
    assert.equal(open.cues[0].startMs, 0);
    assert.equal(f.win.state.video.currentTime, 0, "视频进度未被改动");
    // 不再创建页面覆盖层
    assert.equal(f.$(".ytbt-full-view"), null, "视频页不再插入全屏覆盖层");
});

test("侧边栏字幕 payload 含时间与译文，且不携带 seek 行为", async (t) => {
    const f = fixture(t);
    await f.win.handlePlayerControlAction("full-view");
    const open = f.sent.find((m) => m.type === "OPEN_SIDE_PANEL");
    assert.ok(open.cues.every((c) => typeof c.startMs === "number" && typeof c.endMs === "number"), "每条含时间码");
    assert.ok(open.cues.some((c) => c.translatedText), "含译文");
    const controlsSrc = read("src/content-controls.js");
    assert.doesNotMatch(controlsSrc, /seekPlayerCue\(cue\);\s*\/\/.*full/i, "侧边栏打开逻辑不跳转");
});

test("画中画打开时按设置隐藏视频字幕，关闭后恢复", async (t) => {
    const f = fixture(t);
    f.win.ensureOverlay();
    f.win.updateOverlay();
    assert.equal(f.win.state.overlay.hidden, false, "默认显示视频字幕");

    f.win.ytbtPipIsOpen = () => true;
    f.win.updateOverlay();
    assert.equal(f.win.state.overlay.hidden, true, "画中画打开时自动隐藏");

    f.win.ytbtPipIsOpen = () => false;
    f.win.updateOverlay();
    assert.equal(f.win.state.overlay.hidden, false, "画中画关闭后恢复");
});

test("关闭隐藏开关后画中画打开也不隐藏视频字幕", async (t) => {
    const f = fixture(t, {pipHideVideoSubtitle: false});
    f.win.ensureOverlay();
    f.win.ytbtPipIsOpen = () => true;
    f.win.updateOverlay();
    assert.equal(f.win.state.overlay.hidden, false, "关掉联动后两边都显示");
});
