const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const Shared = {};
require(path.join(root, "src/shared-frequency-data.js"))(Shared);
require(path.join(root, "src/shared-wordfreq.js"))(Shared);

function cues(...texts) {
    return texts.map((text) => ({sourceText: text}));
}

function findWord(result, word) {
    return result.words.find((entry) => entry.word === word);
}

test("frequency data is loaded and ranked", () => {
    assert.ok(Shared.FREQUENCY_EN.length > 9000);
    assert.equal(Shared.FREQUENCY_EN[0], "the");
    assert.equal(Shared.wordFreqIsKnown("the"), true);
    assert.equal(Shared.wordFreqIsKnown("the_world_is_fake_xyz"), false);
});

test("tokenize extracts lowercase words and strips apostrophes", () => {
    const tokens = Shared.wordFreqTokenize("I can't believe it's well-known, okay?");
    assert.ok(tokens.includes("cant"));
    assert.ok(tokens.includes("believe"));
    assert.ok(tokens.includes("well"));
    assert.ok(tokens.includes("known"));
    assert.ok(tokens.every((token) => token === token.toLowerCase()));
});

test("stems plural and third-person forms to a known lemma", () => {
    assert.equal(Shared.wordFreqStem("running"), "run");
    assert.equal(Shared.wordFreqStem("habits"), "habit");
    assert.equal(Shared.wordFreqStem("boxes"), "box");
    assert.equal(Shared.wordFreqStem("studies"), "study");
});

test("stems irregular forms", () => {
    assert.equal(Shared.wordFreqStem("went"), "go");
    assert.equal(Shared.wordFreqStem("children"), "child");
    assert.equal(Shared.wordFreqStem("better"), "good");
});

test("does not stem a word that is already frequent", () => {
    assert.equal(Shared.wordFreqStem("business"), "business");
    assert.equal(Shared.wordFreqStem("always"), "always");
});

test("analyze counts occurrences and groups inflections under one lemma", () => {
    const result = Shared.wordFreqAnalyze(cues(
        "He runs every morning. His running habit is strong.",
        "She ran yesterday and will run again."
    ));
    const run = findWord(result, "run");
    assert.ok(run, "expected a 'run' entry");
    assert.equal(run.count, 4);
    assert.ok(run.forms.includes("runs"));
    assert.ok(run.forms.includes("running"));
    assert.ok(run.forms.includes("ran"));
    assert.ok(run.forms.includes("run"));
});

test("analyze excludes stop words by default", () => {
    const result = Shared.wordFreqAnalyze(cues("the and but you are is it very"));
    assert.equal(findWord(result, "the"), undefined);
    assert.equal(findWord(result, "very"), undefined);
    assert.equal(findWord(result, "and"), undefined);
});

test("analyze assigns frequency levels", () => {
    const result = Shared.wordFreqAnalyze(cues("the world availability habit"), {includeStopWords: true});
    assert.equal(findWord(result, "the").level, "core");
    const world = findWord(result, "world");
    assert.ok(["core", "common", "advanced"].includes(world.level));
});

test("analyze sorts by count then frequency rank", () => {
    const result = Shared.wordFreqAnalyze(cues(
        "elephant elephant elephant banana banana"
    ));
    assert.equal(result.words[0].word, "elephant");
    assert.equal(result.words[0].count, 3);
    assert.equal(result.words[1].word, "banana");
    assert.equal(result.words[1].count, 2);
});

test("analyze returns empty result for no cues", () => {
    const result = Shared.wordFreqAnalyze([]);
    assert.deepEqual(result.words, []);
    assert.equal(result.totalTokens, 0);
    assert.equal(result.uniqueWords, 0);
});

test("analyze respects minLength option", () => {
    const result = Shared.wordFreqAnalyze(cues("a an it cat dog elephant"), {minLength: 4});
    assert.equal(findWord(result, "cat"), undefined);
    assert.equal(findWord(result, "dog"), undefined);
    assert.ok(findWord(result, "elephant"));
});

test("analyze records which cues a word appears in with matched forms", () => {
    const result = Shared.wordFreqAnalyze(cues(
        "He runs every morning.",
        "His running habit is strong.",
        "She ran yesterday."
    ));
    const run = findWord(result, "run");
    assert.ok(run);
    assert.equal(run.occurrences.length, 3, "run 应出现在 3 条字幕");
    assert.deepEqual(run.occurrences.map((item) => item.cueIndex), [0, 1, 2]);
    assert.ok(run.occurrences[0].forms.includes("runs"));
    assert.ok(run.occurrences[1].forms.includes("running"));
    assert.ok(run.occurrences[2].forms.includes("ran"));
});

test("occurrences sink stop words but keep valid lemmas for examples", () => {
    const result = Shared.wordFreqAnalyze(cues(
        "The deal was big. We deal with deals daily."
    ), {includeStopWords: false});
    const deal = findWord(result, "deal");
    assert.ok(deal);
    assert.equal(deal.occurrences.length, 1, "同一字幕内多次出现只记一条例句");
    assert.ok(deal.occurrences[0].forms.includes("deal"));
    assert.ok(deal.occurrences[0].forms.includes("deals"));
});
