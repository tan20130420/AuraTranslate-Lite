const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const Shared = {};
require(path.join(root, "src/shared-phrase-library.js"))(Shared);

function cues(...texts) {
    return texts.map((text) => ({sourceText: text}));
}

function find(result, phrase) {
    return result.phrases.find((item) => item.phrase === phrase);
}

test("built-in library is loaded with four types", () => {
    assert.ok(Shared.PHRASE_LIBRARY_EN.length > 500);
    assert.deepEqual(Shared.PHRASE_LIBRARY_TYPES, ["phrasal", "idiom", "collocation", "slang"]);
    assert.ok(Shared.phraseLibraryByType("phrasal").length > 100);
    assert.ok(Shared.phraseLibraryByType("slang").length > 50);
});

test("tokenize lowercases and strips apostrophes", () => {
    const tokens = Shared.phraseLibraryTokenize("I can't figure it out, okay?");
    assert.ok(tokens.includes("cant"));
    assert.ok(tokens.includes("figure"));
    assert.ok(tokens.every((t) => t === t.toLowerCase()));
});

test("formsFor generates regular inflections", () => {
    const forms = Shared.phraseLibraryFormsFor("figure");
    assert.ok(forms.has("figure"));
    assert.ok(forms.has("figures"));
    assert.ok(forms.has("figured"));
    assert.ok(forms.has("figuring"));
});

test("formsFor generates irregular inflections", () => {
    const forms = Shared.phraseLibraryFormsFor("get");
    assert.ok(forms.has("got"));
    assert.ok(forms.has("gotten"));
    assert.ok(forms.has("getting"));
});

test("analyze finds a phrasal verb in subtitle", () => {
    const result = Shared.phraseLibraryAnalyze(cues("Let me figure out this problem."));
    const hit = find(result, "figure out");
    assert.ok(hit, "expected figure out to be detected");
    assert.equal(hit.count, 1);
    assert.equal(hit.cueCount, 1);
});

test("analyze matches inflected forms to the base phrase", () => {
    const result = Shared.phraseLibraryAnalyze(cues(
        "I figured out the problem yesterday.",
        "She figures out the answer.",
        "We are figuring out the plan."
    ));
    const hit = find(result, "figure out");
    assert.ok(hit, "expected figure out from inflected forms");
    assert.ok(hit.count >= 3, "all three inflections should match");
    assert.ok(hit.forms.some((form) => form.includes("figured")));
    assert.ok(hit.forms.some((form) => form.includes("figuring")));
});

test("analyze records occurrences by cue index with matched forms", () => {
    const result = Shared.phraseLibraryAnalyze(cues(
        "Let us figure out the plan.",
        "No phrase here today.",
        "Can you figure out the answer?"
    ));
    const hit = find(result, "figure out");
    assert.ok(hit);
    assert.deepEqual(hit.occurrences.map((item) => item.cueIndex), [0, 2]);
});

test("analyze detects idioms", () => {
    const result = Shared.phraseLibraryAnalyze(cues("Thanks, you really broke the ice at the party."));
    const hit = find(result, "break the ice");
    assert.ok(hit, "expected idiom to be detected via inflected 'broke'");
});

test("analyze detects slang", () => {
    const result = Shared.phraseLibraryAnalyze(cues("Are you coming? — Yeah, I'm down!"));
    const hit = find(result, "im down");
    assert.ok(hit || find(result, "i'm down"), "expected slang 'I'm down' to be detected");
});

test("analyze sorts by count then IELTS relevance", () => {
    const result = Shared.phraseLibraryAnalyze(cues(
        "figure out figure out figure out",
        "look up look up"
    ));
    assert.ok(result.phrases.length >= 2);
    assert.equal(result.phrases[0].phrase, "figure out");
    assert.equal(result.phrases[0].count, 3);
    assert.equal(result.phrases[1].count, 2);
});

test("analyze returns empty result for no cues", () => {
    const result = Shared.phraseLibraryAnalyze([]);
    assert.deepEqual(result.phrases, []);
    assert.equal(result.total, 0);
    assert.equal(result.totalCues, 0);
});

test("analyze honours limit", () => {
    const text = "figure out look up give up turn on put off make up take off break down come back " +
        "get over deal with focus on set up show up call off carry out check in count on cut off " +
        "drop out end up fall behind fill in go ahead hand out hang out hold back keep on let down " +
        "move on pass by pay off pick up point out pull out run away save up speak up stand out " +
        "stick to stop by try out wake up watch out work out write down";
    const result = Shared.phraseLibraryAnalyze(cues(text), {limit: 5});
    assert.ok(result.phrases.length <= 5);
});

test("custom entries are merged and can override built-ins", () => {
    const custom = [
        ["my special phrase", "idiom", "我的专属短语", "daily", "B2"],
        ["figure out", "collocation", "自定义释义", "ielts", "B2"],
    ];
    const result = Shared.phraseLibraryAnalyze(cues("Let me figure out my special phrase."), {entries: custom});
    assert.ok(find(result, "my special phrase"), "custom entry should be detected");
    const overridden = find(result, "figure out");
    assert.equal(overridden.meaning, "自定义释义", "custom entry should override built-in");
    assert.equal(overridden.type, "collocation");
});

test("normalizeEntry validates type and tags", () => {
    assert.equal(Shared.phraseLibraryNormalize(["test phrase", "badtype", "x", "daily", "B1"]), null);
    const norm = Shared.phraseLibraryNormalize(["Test Phrase", "idiom", "中文", "daily|bogus", "Z9"]);
    assert.equal(norm.phrase, "test phrase");
    assert.deepEqual(norm.tags, ["daily"]);
    assert.equal(norm.level, "B2");
});

test("function words stay literal so 'look up' does not match 'look ups'", () => {
    const forms = Shared.phraseLibraryFormsFor("up");
    // 'up' is a function word only when compiled; raw formsFor still expands it,
    // but compilePhrase locks function words. Verify via analyze that a made-up
    // plural particle does not create a false hit.
    assert.ok(forms.has("up"));
    const result = Shared.phraseLibraryAnalyze(cues("I look ups the word."));
    assert.equal(find(result, "look up"), undefined);
});
