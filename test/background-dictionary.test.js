const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/background-dictionary.js"), "utf8");

// 有道网页接口的真实返回结构（节选自 approved 的响应）
const YOUDAO_SAMPLE = {
    ec: {
        word: [
            {
                usphone: "əˈpruːvd",
                trs: [
                    {tr: [{l: {i: ["adj. 被认可的，被批准的"]}}]},
                    {tr: [{l: {i: ["v. 批准，赞成（approve 的过去式）"]}}]},
                ],
            },
        ],
    },
    simple: {word: [{}]},
};

function load(handler) {
    const calls = [];
    const context = vm.createContext({
        console,
        URL,
        fetchWithTimeout: async (url) => {
            calls.push(url);
            return handler(url);
        },
        Math,
        Date,
        Map,
        JSON,
    });
    context.globalThis = context;
    vm.runInContext(source, context);
    return {api: context, calls};
}

const jsonBody = (data) => ({response: {ok: true, status: 200}, bodyText: JSON.stringify(data)});

// vm 里造出来的对象原型来自另一个 realm，深比较前先拍平成普通值
const plain = (value) => JSON.parse(JSON.stringify(value));

test("解析有道的词性与义项分组", () => {
    const {api} = load(() => jsonBody(YOUDAO_SAMPLE));
    const raw = [
        "adj. 被认可的，被批准的",
        "v. 批准，赞成",
        "没有词性前缀的一行",
    ];
    // 返回值本身就是数组，不能再解构（会拿到 Array.prototype.entries）
    const entries = api.parseYoudaoLines(raw);
    assert.equal(entries.length, 3);
    assert.deepEqual(plain(entries[0]), {pos: "adj.", variants: ["被认可的", "被批准的"]});
    assert.deepEqual(plain(entries[1]), {pos: "v.", variants: ["批准", "赞成"]});
    assert.deepEqual(plain(entries[2]), {pos: "", variants: ["没有词性前缀的一行"]});
});

test("查词返回音标与分组释义", async () => {
    const {api, calls} = load(() => jsonBody(YOUDAO_SAMPLE));
    const response = await api.handleLookupWord({word: "Approved"});

    assert.equal(response.ok, true);
    assert.equal(response.result.word, "approved", "查询词应归一化为小写");
    assert.equal(response.result.phonetic, "/əˈpruːvd/");
    assert.equal(response.result.entries.length, 2);
    assert.deepEqual(plain(response.result.entries[0].variants), ["被认可的", "被批准的"]);
    assert.match(calls[0], /dict\.youdao\.com/);
});

test("重复查同一个词走缓存，不再发请求", async () => {
    const {api, calls} = load(() => jsonBody(YOUDAO_SAMPLE));
    await api.handleLookupWord({word: "approved"});
    await api.handleLookupWord({word: "approved"});
    assert.equal(calls.length, 1, "第二次应命中缓存");
});

test("有道查不到时退到 MyMemory", async () => {
    const {api, calls} = load((url) => {
        if (String(url).includes("youdao")) return {response: {ok: true, status: 200}, bodyText: "{}"};
        return jsonBody({responseData: {translatedText: "有韧性的"}});
    });

    const response = await api.handleLookupWord({word: "resilient"});
    assert.equal(response.ok, true);
    assert.equal(response.result.source, "mymemory");
    assert.deepEqual(plain(response.result.entries[0].variants), ["有韧性的"]);
    assert.equal(calls.length, 2);
});

test("两个源都失败时返回可读的失败结果", async () => {
    const {api} = load(() => ({response: {ok: false, status: 500}, bodyText: ""}));
    const response = await api.handleLookupWord({word: "whatever"});
    assert.equal(response.ok, false);
    assert.equal(response.type, "LOOKUP_WORD_RESULT");
});

test("非单词内容直接拒绝，不打网络请求", async () => {
    const {api, calls} = load(() => jsonBody(YOUDAO_SAMPLE));
    for (const word of ["", "   ", "你好", "a b", "1234"]) {
        const response = await api.handleLookupWord({word});
        assert.equal(response.ok, false, `"${word}" 应被拒绝`);
    }
    assert.equal(calls.length, 0);
});

test("批量查词返回多个词的结果并去重", async () => {
    const {api, calls} = load(() => jsonBody(YOUDAO_SAMPLE));
    const response = await api.handleBatchLookupWord({words: ["approved", "Approved", "approve", "run"]});
    assert.equal(response.ok, true);
    assert.equal(response.type, "BATCH_LOOKUP_WORD_RESULT");
    assert.ok(response.results.approved, "应有 approved 的释义");
    assert.ok(response.results.approve, "应有 approve 的释义");
    assert.ok(response.results.run, "应有 run 的释义");
    assert.equal(calls.length, 3, "去重后只查 3 个词");
});

test("批量查词跳过非法词与超额词", async () => {
    const {api, calls} = load(() => jsonBody(YOUDAO_SAMPLE));
    const words = ["", "你好", "a b", "ok"].concat(Array.from({length: 70}, (_, i) => `w${i}`));
    const response = await api.handleBatchLookupWord({words});
    assert.equal(response.ok, true);
    assert.ok(calls.length <= 60, "最多查 60 个词");
    assert.ok(response.results.ok, "合法词 ok 应被查询");
});

test("批量查词中某个词失败不影响其他词", async () => {
    const {api} = load((url) => {
        if (decodeURIComponent(String(url)).includes("q=failme")) {
            return {response: {ok: true, status: 200}, bodyText: "{}"};
        }
        return jsonBody(YOUDAO_SAMPLE);
    });
    const response = await api.handleBatchLookupWord({words: ["failme", "approved"]});
    assert.equal(response.ok, true);
    assert.equal(response.results.failme, undefined, "失败词不占位");
    assert.ok(response.results.approved, "其他词正常返回");
});
