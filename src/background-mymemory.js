// MyMemory 免 Key 翻译：作为 Google / Bing 都不可用时的最后兜底。
// 优点：无需任何凭据、境内外都可访问；缺点：匿名额度有限（约 5000 字符/天），
// 长视频会被限流，所以只在前面两个源失败时使用。
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MYMEMORY_MAX_CHARS = 500;
let myMemoryCooldownUntil = 0;

function myMemoryLang(code) {
    const value = String(code || "auto").toLowerCase();
    if (!value || value === "auto") return "";
    if (value.startsWith("zh")) return "zh-CN";
    return value.split("-")[0];
}

// 兜底源不还原富文本标记，直接翻译纯文本，避免标记本身被翻译。
function stripFormattingMarkers(text) {
    return String(text || "").replace(/\[\[\/?YTBT_[A-Z_]+_\d+\]\]/g, "");
}

async function translateMyMemoryCue(text, request, deadline, hasFormatting = false) {
    if (Date.now() < myMemoryCooldownUntil) {
        throw new Error("MyMemory 免 Key 接口暂不可用，冷却后可手动重试。");
    }
    if (deadline - Date.now() <= 0) {
        throw new Error("兜底处理时间已用完，请手动重试剩余段落。");
    }

    const plain = stripFormattingMarkers(text).trim();
    if (!plain) return "";

    const from = myMemoryLang(request.sourceLanguage) || "en";
    const to = myMemoryLang(request.targetLanguage) || "zh-CN";
    const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(plain.slice(0, MYMEMORY_MAX_CHARS))}&langpair=${encodeURIComponent(`${from}|${to}`)}`;

    const remaining = Math.max(2000, deadline - Date.now());
    const {response, bodyText} = await fetchWithTimeout(
        url,
        {credentials: "omit", referrerPolicy: "no-referrer"},
        Math.min(15000, remaining),
        false
    );

    if (response.status === 429) {
        myMemoryCooldownUntil = Date.now() + 60000;
        throw new Error("MyMemory 已被限流，请稍后重试。");
    }
    if (!response.ok) {
        throw new Error(`MyMemory 请求失败 (${response.status})。`);
    }

    let body;
    try {
        body = JSON.parse(bodyText);
    } catch {
        throw new Error("MyMemory 返回了无效 JSON。");
    }

    const translated = body && body.responseData && body.responseData.translatedText;
    if (typeof translated !== "string" || !translated.trim()) {
        throw new Error("MyMemory 没有返回译文。");
    }
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|PLEASE SELECT/i.test(translated)) {
        throw new Error("MyMemory 已达到今日免费额度。");
    }

    return translated.trim();
}

async function translateMyMemoryBatch(request, retain) {
    const items = [];
    const deadline = Date.now() + 45000;
    for (const cue of request.cues) {
        let translatedText;
        try {
            translatedText = await translateMyMemoryCue(cue.sourceText, request, deadline, cue.hasFormatting);
        } catch (error) {
            if (items.length) return items;
            throw new Error(`MyMemory 翻译失败：${error.message}`);
        }
        const item = {id: cue.id, translatedText, translationProvider: "mymemory"};
        await retain([item]);
        items.push(item);
    }
    return items;
}

// --- 免费源统一回退链 ---
// 字幕、划词、网页沉浸式翻译都走这里。三个源都不需要 API Key：
//   Google（境内常不可达）→ Bing（免 Key 凭据偶发失效）→ MyMemory（额度有限但可用）
// 任何一条链路单独失败都不应该让用户看到“去配置 API”。
let builtInProviderFallback = "";
const BUILT_IN_HINT_KEY = "ytbt:freeProviderHint";
const BUILT_IN_HINT_TTL = 24 * 3600 * 1000;

// 记住上次成功的免费源（比如国内只能走 MyMemory），免得每次先等 Google 超时。
async function loadBuiltInProviderHint() {
    if (builtInProviderFallback) return builtInProviderFallback;
    try {
        const stored = await storageGet({[BUILT_IN_HINT_KEY]: null});
        const hint = stored[BUILT_IN_HINT_KEY];
        if (hint && hint.provider && Date.now() - Number(hint.at || 0) < BUILT_IN_HINT_TTL) {
            builtInProviderFallback = hint.provider;
        }
    } catch { /* 提示只是加速手段，失败就按默认顺序试 */ }
    return builtInProviderFallback;
}

async function rememberBuiltInProvider(provider) {
    builtInProviderFallback = provider || "";
    try {
        await storageSet({[BUILT_IN_HINT_KEY]: {provider: builtInProviderFallback, at: Date.now()}});
    } catch { /* 存不下也不影响功能 */ }
}

/**
 * 按 Google → Bing → MyMemory 顺序尝试，返回第一个成功的结果。
 * @param {object} request translateMissingCues 的请求体（含 cues）
 * @param {string} provider 用户显式选择的免费源
 * @param {Function} retain 逐条落缓存的回调
 */
async function translateWithBuiltInFallback(request, provider, retain) {
    const other = provider === "google-free" ? "bing-free" : "google-free";
    const chain = [provider, other, "mymemory"];
    const hint = await loadBuiltInProviderHint();
    const order = hint ? [hint].concat(chain.filter((item) => item !== hint)) : chain;
    const failures = [];
    for (const candidate of order) {
        try {
            const items = candidate === "mymemory"
                ? await translateMyMemoryBatch(request, retain)
                : await translateImmersiveBuiltIn(request, candidate, retain);
            if (candidate !== provider) await rememberBuiltInProvider(candidate);
            return items;
        } catch (error) {
            // 本地存储失败不是翻译源的问题，直接上抛，避免无意义地换源重译。
            if (error && error.localStorageFailure) throw error;
            failures.push(`${candidate === "mymemory" ? "MyMemory" : candidate === "bing-free" ? "Bing" : "Google"}：${error.message}`);
        }
    }
    const failure = new Error(`免费翻译源暂不可用。${failures.join("；")}`);
    failure.freeProviderFailures = failures;
    throw failure;
}
