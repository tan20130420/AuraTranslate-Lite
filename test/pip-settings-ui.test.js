const {
  mount,
  click,
  setValue,
} = require("../scripts/ui-test-helpers.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");

async function openPipSettings(t, storage = {}) {
  return mount(t, "options", {storage, hash: "#pip-settings"});
}

test("画中画设置页默认参数可见且开关打开", async (t) => {
  const page = await openPipSettings(t);
  const section = page.$("#pip-settings");
  assert.equal(section.hidden, false);
  assert.match(section.textContent, /画中画字幕/);
  assert.equal(page.field("pipEnabled").checked, true);
  assert.equal(page.field("pipShowHeader").checked, true);
  assert.equal(Number(page.field("pipFontScale").value), 1);
  assert.equal(Number(page.field("pipOpacity").value), 0.82);
});

test("画中画设置页的开关与滑块会写入 storage", async (t) => {
  const page = await openPipSettings(t);
  click(page.field("pipEnabled"));
  click(page.field("pipShowHeader"));
  setValue(page.field("pipFontScale"), "1.4");
  setValue(page.field("pipOpacity"), "0.55");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.storage.pipEnabled, false);
  assert.equal(page.storage.pipShowHeader, false);
  assert.equal(Number(page.storage.pipFontScale), 1.4);
  assert.equal(Number(page.storage.pipOpacity), 0.55);
});
