const {
  mount,
  click,
  setValue,
} = require("../scripts/ui-test-helpers.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");

const STORAGE_KEY = "auraPhraseLibraryCustom";

async function openLibrary(t, storage = {}) {
  const page = await mount(t, "options", {storage, hash: "#phrase-library"});
  return page;
}

function entriesOf(page) {
  return [...page.document.querySelectorAll("#phrase-library .vocabulary-entry")];
}

async function addEntry(page, {phrase, type = "idiom", meaning = "释义", tags = "daily", level = "B2"}) {
  const addButtons = [...page.document.querySelectorAll("#phrase-library button")]
    .filter((button) => button.textContent.includes("新增词条"));
  click(addButtons[0]);
  const editor = page.$("#phrase-library .phrase-editor");
  const inputs = [...editor.querySelectorAll("input")];
  const selects = [...editor.querySelectorAll("select")];
  setValue(inputs[0], phrase);
  setValue(selects[0], type);
  setValue(inputs[1], meaning);
  setValue(inputs[2], tags);
  setValue(selects[1], level);
  const save = [...editor.querySelectorAll("button")].find((b) => b.textContent.includes("保存词条"));
  click(save);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("phrase library page shows built-in count and starts empty", async (t) => {
  const page = await openLibrary(t);
  assert.equal(page.$("#phrase-library").hidden, false);
  assert.match(page.$("#phrase-library .section-heading").textContent, /内置 \d+ 条/);
  assert.equal(entriesOf(page).length, 0);
  assert.match(page.$("#phrase-library .vocabulary-empty").textContent, /还没有自定义词条/);
});

test("phrase library adds, persists and lists a custom entry", async (t) => {
  const storage = {};
  const page = await openLibrary(t, storage);
  await addEntry(page, {phrase: "my cool phrase", meaning: "我的酷短语", tags: "daily|informal"});
  assert.equal(entriesOf(page).length, 1);
  assert.match(entriesOf(page)[0].textContent, /my cool phrase/);
  assert.match(entriesOf(page)[0].textContent, /我的酷短语/);
  assert.ok(storage[STORAGE_KEY], "entry persisted to storage");
  assert.equal(storage[STORAGE_KEY][0][0], "my cool phrase");
  assert.equal(storage[STORAGE_KEY][0][1], "idiom");
});

test("phrase library rejects invalid phrase and keeps storage unchanged", async (t) => {
  const storage = {};
  const page = await openLibrary(t, storage);
  await addEntry(page, {phrase: "a"}); // single word, less than two tokens
  assert.equal(entriesOf(page).length, 0);
  assert.equal(storage[STORAGE_KEY], undefined);
  assert.match(page.$("#phrase-library .vocabulary-status").textContent, /至少两个词/);
});

test("phrase library edits an existing entry", async (t) => {
  const storage = {[STORAGE_KEY]: [["old phrase", "slang", "旧", "daily", "B1"]]};
  const page = await openLibrary(t, storage);
  assert.equal(entriesOf(page).length, 1);
  click([...entriesOf(page)[0].querySelectorAll("button")].find((b) => b.textContent === "编辑"));
  const editor = page.$("#phrase-library .phrase-editor");
  const inputs = [...editor.querySelectorAll("input")];
  setValue(inputs[0], "new phrase");
  setValue(inputs[1], "新释义");
  click([...editor.querySelectorAll("button")].find((b) => b.textContent.includes("保存词条")));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(storage[STORAGE_KEY].length, 1);
  assert.equal(storage[STORAGE_KEY][0][0], "new phrase");
  assert.equal(storage[STORAGE_KEY][0][2], "新释义");
});

test("phrase library deletes an entry", async (t) => {
  const storage = {[STORAGE_KEY]: [["one phrase", "idiom", "一", "daily", "B1"], ["two phrase", "slang", "二", "daily", "B1"]]};
  const page = await openLibrary(t, storage);
  assert.equal(entriesOf(page).length, 2);
  click([...entriesOf(page)[0].querySelectorAll("button")].find((b) => b.textContent === "删除"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(entriesOf(page).length, 1);
  assert.equal(storage[STORAGE_KEY].length, 1);
  assert.equal(storage[STORAGE_KEY][0][0], "two phrase");
});

test("phrase library search filters entries", async (t) => {
  const storage = {[STORAGE_KEY]: [
    ["figure out", "phrasal", "弄清楚", "ielts", "B1"],
    ["no biggie", "slang", "没什么大不了", "informal", "B1"],
  ]};
  const page = await openLibrary(t, storage);
  setValue(page.field("phrase-search"), "biggie");
  assert.equal(entriesOf(page).length, 1);
  assert.match(entriesOf(page)[0].textContent, /no biggie/);
});

test("phrase library type filter works", async (t) => {
  const storage = {[STORAGE_KEY]: [
    ["figure out", "phrasal", "弄清楚", "ielts", "B1"],
    ["no biggie", "slang", "没什么大不了", "informal", "B1"],
  ]};
  const page = await openLibrary(t, storage);
  setValue(page.field("phrase-filter"), "slang");
  assert.equal(entriesOf(page).length, 1);
  assert.match(entriesOf(page)[0].textContent, /no biggie/);
});

test("phrase library clear removes all custom entries", async (t) => {
  const storage = {[STORAGE_KEY]: [["one phrase", "idiom", "一", "daily", "B1"]]};
  const page = await openLibrary(t, storage);
  page.window.confirm = () => true;
  const clear = [...page.document.querySelectorAll("#phrase-library button")]
    .find((b) => b.textContent.includes("清空自定义"));
  click(clear);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(entriesOf(page).length, 0);
  assert.deepEqual(storage[STORAGE_KEY], []);
});

test("phrase enabled toggle persists", async (t) => {
  const page = await openLibrary(t);
  const toggle = page.field("phraseEnabled");
  assert.equal(toggle.checked, true);
  click(toggle);
  await page.save();
  assert.equal(page.storage.phraseEnabled, false);
});

test("phrase library lists built-in entries with search and show-more", async (t) => {
  const page = await openLibrary(t);
  const builtin = page.$("#phrase-library .builtin-library");
  assert.ok(builtin, "built-in library section exists");
  assert.match(builtin.textContent, /543 条/);
  const rows = () => [...builtin.querySelectorAll(".builtin-entry")];
  assert.equal(rows().length, 50, "shows first 50 by default");
  const more = builtin.querySelector(".builtin-more");
  assert.ok(more, "show-more button present");
  assert.match(more.textContent, /还有 493 条/);
  click(more);
  assert.equal(rows().length, 100, "show-more reveals next batch");

  const search = page.$("#builtin-search");
  setValue(search, "figure out");
  const filtered = rows();
  assert.ok(filtered.length > 0 && filtered.length < 100);
  assert.ok(filtered.some((row) => /figure out/i.test(row.textContent)));
});

test("phrase library built-in section is read-only (no edit/delete buttons)", async (t) => {
  const page = await openLibrary(t);
  const builtin = page.$("#phrase-library .builtin-library");
  const buttons = [...builtin.querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(!buttons.some((text) => /编辑|删除/.test(text)), "built-in entries have no edit/delete controls");
});
