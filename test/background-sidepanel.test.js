const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "background-sidepanel.js"), "utf8");

function fixture({sidePanel = true} = {}) {
    const session = {};
    const opened = [];
    const created = [];
    const sent = [];
    const chrome = {
        storage: {
            session: {
                get(key) { return Promise.resolve(key ? {[key]: session[key]} : {...session}); },
                set(values) { Object.assign(session, values); return Promise.resolve(); }
            }
        },
        runtime: {getURL: (p) => `chrome-extension://x/${p}`, lastError: null},
        tabs: {
            create(opts, cb) { created.push(opts); if (cb) cb(); },
            sendMessage(tabId, message) {
                sent.push({tabId, message});
                if (chrome.tabs.sendMessageError) return Promise.reject(new Error(chrome.tabs.sendMessageError));
                return Promise.resolve({ok: true});
            }
        },
        sidePanel: sidePanel ? {open(opts) { opened.push(opts); return Promise.resolve(); }} : undefined
    };
    const context = vm.createContext({chrome, console});
    vm.runInContext(src, context);
    return {context, session, opened, created, sent, chrome};
}

test("存储字幕后侧边栏可读取到规范化内容", async (t) => {
    const f = fixture();
    const res = await f.context.handleSidePanelStore({
        type: "SIDE_PANEL_STORE",
        videoTitle: "My Video", pageUrl: "https://www.youtube.com/watch?v=x",
        sourceLanguage: "en", targetLanguage: "zh-CN",
        cues: [
            {startMs: 0, endMs: 5000, sourceText: "Hello", translatedText: "你好"},
            {startMs: -1, sourceText: "bad"}, // 被丢弃
            null
        ]
    });
    assert.equal(res.ok, true);
    assert.equal(res.transcript.cues.length, 1, "过滤无效字幕");
    assert.equal(res.transcript.cues[0].sourceText, "Hello");
    assert.equal(res.transcript.videoTitle, "My Video");

    const got = await f.context.handleSidePanelGet();
    assert.equal(got.transcript.cues.length, 1, "可从会话存储读回");
    assert.equal(got.transcript.targetLanguage, "zh-CN");
});

test("打开侧边栏时优先用 sidePanel.open，并带当前标签页", async (t) => {
    const f = fixture();
    const res = await f.context.handleOpenSidePanel(
        {type: "OPEN_SIDE_PANEL", videoId: "v1", cues: [{startMs: 0, sourceText: "A"}]},
        {tab: {id: 42}}
    );
    assert.equal(res.ok, true);
    assert.equal(res.opened, true);
    assert.equal(f.opened.length, 1);
    assert.equal(f.opened[0].tabId, 42);
    assert.equal(f.created.length, 0, "未降级到新标签页");
});

test("无 sidePanel API 或调用失败时降级为新标签页", async (t) => {
    const f1 = fixture({sidePanel: false});
    const res1 = await f1.context.handleOpenSidePanel({type: "OPEN_SIDE_PANEL", cues: []}, {tab: {id: 1}});
    assert.equal(res1.opened, false);
    assert.equal(f1.created.length, 1);
    assert.match(f1.created[0].url, /sidepanel\/sidepanel\.html$/);

    const f2 = fixture();
    f2.chrome.sidePanel.open = () => Promise.reject(new Error("no gesture"));
    const res2 = await f2.context.handleOpenSidePanel({type: "OPEN_SIDE_PANEL", cues: []}, {tab: {id: 2}});
    assert.equal(res2.opened, false);
    assert.equal(f2.created.length, 1, "失败后降级");
});

test("manifest 注册了 side_panel 与权限", async (t) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
    assert.ok(manifest.permissions.includes("sidePanel"), "含 sidePanel 权限");
    assert.equal(manifest.side_panel.default_path, "sidepanel/sidepanel.html");
    assert.ok(manifest.background.scripts.includes("src/background-sidepanel.js"), "后台加载桥接模块");
});

test("打开侧边栏会记住来源标签页，点击字幕时转发跳转消息到该标签页", async () => {
    const f = fixture();
    await f.context.handleOpenSidePanel(
        {type: "OPEN_SIDE_PANEL", cues: [{startMs: 0, sourceText: "A"}]},
        {tab: {id: 77}}
    );
    // 侧边栏发来的 seek（sender 无 tab），应转发到记住的 77 标签页
    const res = await f.context.handleSidePanelSeek({type: "SIDE_PANEL_SEEK", startMs: 65000}, {});
    assert.equal(res.ok, true);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].tabId, 77);
    assert.equal(f.sent[0].message.type, "SIDE_PANEL_SEEK_VIDEO");
    assert.equal(f.sent[0].message.startMs, 65000);
});

test("STORE 也会记住标签页；service worker 重启后可从会话存储恢复", async () => {
    const f = fixture();
    await f.context.handleSidePanelStore(
        {type: "SIDE_PANEL_STORE", cues: [{startMs: 0, sourceText: "A"}]},
        {tab: {id: 88}}
    );
    assert.equal(f.session.auraSidePanelTabId, 88, "标签页写入会话存储");
    // 新建上下文模拟 service worker 重启（内存变量丢失，仅剩 session 存储）
    const context2 = vm.createContext({chrome: f.chrome, console});
    vm.runInContext(src, context2);
    const res = await context2.handleSidePanelSeek({type: "SIDE_PANEL_SEEK", startMs: 12000}, {});
    assert.equal(res.ok, true);
    assert.equal(f.sent[0].tabId, 88, "从会话存储恢复标签页");
});

test("无来源标签页时用 sender.tab.id 兜底；无效时间拒绝", async () => {
    const f = fixture();
    const res = await f.context.handleSidePanelSeek({type: "SIDE_PANEL_SEEK", startMs: 5000}, {tab: {id: 9}});
    assert.equal(res.ok, true);
    assert.equal(f.sent[0].tabId, 9, "用发送方标签页兜底");

    const bad = await f.context.handleSidePanelSeek({type: "SIDE_PANEL_SEEK", startMs: -1}, {});
    assert.equal(bad.ok, false);
    assert.equal(f.sent.length, 1, "无效时间不转发");
});

test("跳转消息发送到标签页失败时返回错误", async () => {
    const f = fixture();
    await f.context.handleOpenSidePanel({type: "OPEN_SIDE_PANEL", cues: []}, {tab: {id: 3}});
    f.chrome.tabs.sendMessageError = "Receiving end does not exist";
    const res = await f.context.handleSidePanelSeek({type: "SIDE_PANEL_SEEK", startMs: 1000}, {});
    assert.equal(res.ok, false);
    assert.match(res.error, /重新打开|失败|Receiving/);
});
