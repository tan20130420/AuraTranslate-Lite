const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/shared.js");
const {vocabularyFixture, word} = require("../scripts/vocabulary-test-helpers.cjs");
const call = (fixture, action, extra = {}) => fixture.send({type: "VOCABULARY", action, ...extra});

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

test("scheduleReview 升档、降档与间隔，连续答对后标记为已掌握", () => {
    const base = {step: 0, reviewCount: 0};
    const again = Core.scheduleReview(base, "again", 0);
    assert.equal(again.step, 0);
    assert.equal(again.nextReviewAt, 10 * 60 * 1000, "忘记后 10 分钟再来");
    assert.equal(again.reviewCount, 1);

    const good = Core.scheduleReview(base, "good", 0);
    assert.equal(good.step, 1);
    assert.equal(good.nextReviewAt, DAY, "一般升一档，隔一天");

    const easy = Core.scheduleReview(base, "easy", 0);
    assert.equal(easy.step, 2);
    assert.equal(easy.nextReviewAt, 3 * DAY, "很熟升两档，隔三天");

    // 从高檔位继续答对时封顶，并自动标记已掌握
    const mastered = Core.scheduleReview({step: 2, reviewCount: 5}, "good", 0);
    assert.equal(mastered.step, Core.REVIEW_STEPS_MAX);
    assert.equal(mastered.learned, true);
    // 封顶后答错要退回最低档并取消“已掌握”
    const back = Core.scheduleReview({step: 3, learned: true, reviewCount: 8}, "again", 0);
    assert.equal(back.step, 0);
    assert.equal(back.learned, false);
});

test("isReviewDue 只把未掌握且到期（或从未复习）的词条排入队列", () => {
    const now = Date.now();
    assert.equal(Core.isReviewDue({step: 0, nextReviewAt: 0}, now), true, "从未复习");
    assert.equal(Core.isReviewDue({step: 1, nextReviewAt: now - 1}, now), true, "已到期");
    assert.equal(Core.isReviewDue({step: 1, nextReviewAt: now + DAY}, now), false, "未到期");
    assert.equal(Core.isReviewDue({step: 3, learned: true, nextReviewAt: now - DAY}, now), false, "已掌握不再复习");
    assert.equal(Core.isReviewDue(null, now), false);
});

test("older entries without review fields normalize to step 0 and count as due", () => {
    const entry = Core.normalizeVocabularyEntry({
        sourceText: "legacy", translatedText: "旧词", sourceLanguage: "en", targetLanguage: "zh-CN",
        createdAt: Date.now(),
    });
    assert.equal(entry.step, 0);
    assert.equal(entry.reviewCount, 0);
    assert.equal(entry.nextReviewAt, 0);
    assert.equal(Core.isReviewDue(entry), true);
});

for (const mode of ["worker", "event-page"]) test(`${mode}: review 动作写入档位、时间与已掌握状态`, async () => {
    const f = vocabularyFixture({mode});
    const {entry} = await call(f, "add", {entry: word()});

    const first = await call(f, "review", {id: entry.id, rating: "good"});
    assert.equal(first.ok, true);
    assert.equal(first.entry.step, 1);
    assert.equal(first.entry.reviewCount, 1);
    assert.ok(first.entry.nextReviewAt > Date.now(), "应该排到将来");

    // 未知评分按“一般”处理，不会把数据写成脏值
    const fallback = await call(f, "review", {id: entry.id, rating: "whatever"});
    assert.equal(fallback.entry.step, 2);

    const third = await call(f, "review", {id: entry.id, rating: "easy"});
    assert.equal(third.entry.step, Core.REVIEW_STEPS_MAX);
    assert.equal(third.entry.learned, true);

    f.restart();
    const saved = (await call(f, "list")).entries[0];
    assert.equal(saved.step, Core.REVIEW_STEPS_MAX);
    assert.equal(saved.learned, true);
    assert.equal(saved.reviewCount, 3);
    assert.equal(f.requests.length, 0, "复习不触发任何翻译请求");
});

test("reviewing a deleted entry reports an error instead of throwing silently", async () => {
    const f = vocabularyFixture();
    const {entry} = await call(f, "add", {entry: word()});
    await call(f, "remove", {id: entry.id});
    const result = await call(f, "review", {id: entry.id, rating: "good"});
    assert.equal(result.ok, false);
    assert.match(result.error, /已被删除/);
});
