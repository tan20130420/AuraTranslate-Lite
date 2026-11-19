const {
  mount,
  click,
  setValue,
  dispatch,
} = require("../scripts/ui-test-helpers.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/shared.js");
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function popup(t, values = {}, options = {}) {
  const settings = { ...Core.DEFAULT_SETTINGS, ...values };
  const messages = [];
  const runtime = {
    getManifest: () => ({ version: "0.3.12" }),
    openOptionsPage: () => {
      options.opened = true;
    },
  };
  const chrome = {
    runtime,
    storage: {
      local: {
        get: (_, callback) => callback(settings),
        set: (patch, callback) => {
          if (options.saveError)
            runtime.lastError = { message: "Storage unavailable" };
          else Object.assign(settings, patch);
          callback();
          delete runtime.lastError;
        },
      },
    },
    tabs: {
      query: (_, callback) =>
        callback([
          { id: 4, url: options.url || "https://docs.example.org/guide" },
        ]),
      sendMessage: (id, message, frame, callback) => {
        messages.push({ id, ...message, ...frame });
        if (options.disconnected)
          runtime.lastError = { message: "Receiving end does not exist" };
        callback(
          options.disconnected
            ? undefined
            : { ok: true, mode: options.running ? "translating" : "idle" },
        );
        delete runtime.lastError;
      },
    },
  };
  const ui = await mount(t, "popup", { chrome });
  return { ...ui, settings, messages };
}

test("popup restores language, free translation source and saved modes, and expands more controls", async (t) => {
  const { $, settings } = await popup(t, {
    immersiveTranslationService: "bing-free",
    immersiveDisplayMode: "translation",
  });
  assert.equal($("#source-language").value, "auto");
  assert.equal($("#target-language").value, "zh-CN");
  assert.equal($("#translation-service").value, "bing-free", "记住上次选择的免费源");
  assert.deepEqual(
    [...$("#translation-service").options].map((option) => option.value),
    ["google-free", "bing-free"],
    "只提供免 Key 源，不再让用户配置供应商与模型",
  );
  assert.equal($("#translation-model"), null);
  assert.equal($(".popup-header .brand"), null, "the header carries no product lockup");
  assert.equal($("h1.sr-only").textContent, "AuraTranslate", "the outline keeps the product name");
  assert.equal($(".current-page"), null, "the page chip is gone from the translation screen");
  assert.equal($("#status").textContent, "", "the idle hint no longer takes a line");
  assert.equal($("#more-panel").hidden, true);
  click($("#more-toggle"));
  assert.equal($("#more-panel").hidden, false);
  assert.equal($("#more-toggle").getAttribute("aria-expanded"), "true");
  assert.equal($("#mode-icon").textContent, "A");
  click($("#display-mode-toggle"));
  await tick();
  assert.equal(settings.immersiveDisplayMode, "bilingual");
  assert.equal(
    $('[data-display-mode="bilingual"]').getAttribute("aria-pressed"),
    "true",
  );
});

test("popup saves webpage preferences independently from subtitles and targets only the top frame", async (t) => {
  const { $, window, settings, messages } = await popup(t);
  for (const [selector, value] of [
    ["#source-language", "ja"],
    ["#target-language", "en"],
    ["#translation-service", "google-free"],
  ]) {
    setValue($(selector), value);
    dispatch($(selector), new window.Event("change"));
    await tick();
  }
  assert.equal(settings.immersiveSourceLanguage, "ja");
  assert.equal(settings.immersiveTargetLanguage, "en");
  assert.equal(settings.immersiveTranslationService, "google-free");
  assert.equal(settings.sourceLanguage, "en");
  assert.equal(settings.targetLanguage, "zh-CN");
  click($("#translate-page"));
  await tick();
  assert.equal(messages.at(-1).type, "IMMERSIVE_POPUP_TRANSLATE");
  assert.equal(messages.at(-1).id, 4);
  assert.equal(messages.at(-1).frameId, 0);
});

test("site rules preserve other websites and inherit removes only the current hostname", async (t) => {
  const { $, settings } = await popup(t, {
    immersiveSiteRules: { "other.org": "never" },
  });
  click($('[data-site-rule="always"]'));
  await tick();
  assert.equal(settings.immersiveSiteRules["docs.example.org"], "always");
  assert.equal(settings.immersiveSiteRules["other.org"], "never");
  click($('[data-site-rule="inherit"]'));
  await tick();
  assert.equal(settings.immersiveSiteRules["docs.example.org"], undefined);
  assert.equal(settings.immersiveSiteRules["other.org"], "never");
});

test("restricted and disconnected pages explain disabled translation while keeping settings usable", async (t) => {
  for (const options of [
    { url: "chrome://extensions" },
    { disconnected: true },
  ]) {
    const { $ } = await popup(t, {}, options);
    assert.equal($("#translate-page").disabled, true);
    assert.equal($("#source-language").disabled, false);
    assert.match($("#status").textContent, /普通网页|刷新/);
  }
});

test("failed saves roll back selected values and surface a recoverable error", async (t) => {
  const { $, window, settings } = await popup(t, {}, { saveError: true });
  setValue($("#translation-service"), "bing-free");
  dispatch($("#translation-service"), new window.Event("change"));
  await tick();
  assert.equal(settings.immersiveTranslationService, "ai", "写入失败不应改设置");
  assert.equal($("#translation-service").value, "google-free", "回滚到生效中的源");
  assert.match($("#status").textContent, /保存失败/);
  assert.equal($("#translation-service").disabled, false);
});

test("the appearance button cycles system, light and dark and persists each choice", async (t) => {
  const { $, window, settings } = await popup(t);
  const painted = [];
  window.AuraTheme = { apply: (theme) => painted.push(theme) };
  const toggle = $("#theme-toggle");
  assert.equal(toggle.dataset.themePreference, "system");
  assert.match(toggle.getAttribute("aria-label"), /跟随系统/);
  for (const expected of ["light", "dark", "system"]) {
    click(toggle);
    await tick();
    assert.equal(settings.uiTheme, expected);
    assert.equal(toggle.dataset.themePreference, expected);
  }
  assert.deepEqual(painted, ["light", "dark", "system"]);
  assert.match(toggle.getAttribute("aria-label"), /跟随系统/);
});

test("a failed appearance save repaints the previous theme", async (t) => {
  const { $, window, settings } = await popup(t, { uiTheme: "dark" }, { saveError: true });
  const painted = [];
  window.AuraTheme = { apply: (theme) => painted.push(theme) };
  click($("#theme-toggle"));
  await tick();
  assert.equal(settings.uiTheme, "dark");
  assert.deepEqual(painted, ["system", "dark"], "repaint, then undo");
  assert.equal($("#theme-toggle").dataset.themePreference, "dark");
  assert.match($("#status").textContent, /保存失败/);
});

test("running translations disable duplicate starts and language changes but retain mode switching", async (t) => {
  const { $ } = await popup(
    t,
    { translationModel: "my-model" },
    { running: true },
  );
  assert.equal($("#translate-page").disabled, true);
  assert.equal($("#source-language").disabled, true);
  assert.equal($("#translation-service").disabled, true);
  assert.equal($("#display-mode-toggle").disabled, false);
});

async function change(ui, selector, value) {
  setValue(ui.$(selector), value);
  dispatch(ui.$(selector), new ui.window.Event("change"));
  await tick();
}

test("翻译源切换只影响网页翻译，不动字幕的翻译源", async (t) => {
  const ui = await popup(t, { subtitleTranslationProvider: "" });
  assert.equal(ui.$("#translation-service").value, "google-free");
  await change(ui, "#translation-service", "bing-free");
  assert.equal(ui.settings.immersiveTranslationService, "bing-free");
  assert.equal(ui.settings.subtitleTranslationProvider, "", "字幕设置保持“自动”");
  const reopened = await popup(t, ui.settings);
  assert.equal(reopened.$("#translation-service").value, "bing-free");
  assert.ok(ui.messages.every((message) => message.type === "IMMERSIVE_POPUP_STATUS"));
});

test("保存失败时翻译源回到已保存的取值，并给出可恢复的提示", async (t) => {
  const ui = await popup(t, { immersiveTranslationService: "google-free" }, { saveError: true });
  await change(ui, "#translation-service", "bing-free");
  assert.equal(ui.$("#translation-service").value, "google-free");
  assert.equal(ui.settings.immersiveTranslationService, "google-free");
  assert.match(ui.$("#status").textContent, /保存失败/);
  assert.equal(ui.$("#translation-service").disabled, false, "失败后要能重试");
});
