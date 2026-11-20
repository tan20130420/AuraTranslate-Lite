/*
 * 悬停查词：给字幕里的单个单词取音标、词性、中文释义。
 *
 * 走有道网页版 JSON 接口（免 Key、带音标和词性分组），失败时退到 MyMemory
 * 只取一句中文。整体失败返回 null，前端静默不显示浮层，不打扰阅读。
 */
"use strict";

const DICT_YOUDAO_URL = "https://dict.youdao.com/jsonapi";
const DICT_MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const DICT_CACHE_LIMIT = 400;
const WORD_PATTERN = /^[A-Za-z][A-Za-z'-]*$/;

// 查过的词直接进内存缓存：字幕反复滚动时同一个词会被频繁悬停。
const dictCache = new Map();

function dictCacheGet(word) {
    return dictCache.get(word) || null;
}

function dictCacheSet(word, value) {
    if (dictCache.size >= DICT_CACHE_LIMIT) {
        dictCache.delete(dictCache.keys().next().value);
    }
    dictCache.set(word, value);
}

function normalizeLookupWord(raw) {
    return String(raw || "").trim().replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, "").toLowerCase();
}

// 有道的释义行形如 "adj. 有韧性的，能恢复的" / "v. 混合" / "n. 化合物"
function parseYoudaoLines(lines) {
    const entries = [];
    for (const line of lines) {
        const text = String(line || "").trim();
        if (!text) continue;
        const match = text.match(/^([a-z]+\.)\s*(.+)$/i);
        const pos = match ? match[1] : "";
        const body = match ? match[2] : text;
        const variants = body
            .split(/[,，;；]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 4);
        if (variants.length) entries.push({pos, variants});
    }
    return entries;
}

async function lookupYoudao(word) {
    const url = `${DICT_YOUDAO_URL}?q=${encodeURIComponent(word)}`;
    const {response, bodyText} = await fetchWithTimeout(
        url,
        {credentials: "omit", referrerPolicy: "no-referrer"},
        6000,
        false
    );
    if (!response.ok) return null;

    let data;
    try {
        data = JSON.parse(bodyText);
    } catch {
        return null;
    }

    const entry = data && data.ec && data.ec.word && data.ec.word[0];
    if (!entry) return null;

    const lines = [];
    for (const item of entry.trs || []) {
        const text = item && item.tr && item.tr[0] && item.tr[0].l && item.tr[0].l.i && item.tr[0].l.i[0];
        if (text) lines.push(text);
    }
    const entries = parseYoudaoLines(lines);
    if (!entries.length) return null;

    const simple = (data.simple && data.simple.word && data.simple.word[0]) || {};
    const phonetic = entry.usphone || entry.ukphone || simple.usphone || simple.ukphone || "";

    return {
        word,
        phonetic: phonetic ? `/${phonetic}/` : "",
        entries,
        source: "youdao"
    };
}

async function lookupMyMemory(word) {
    const url = `${DICT_MYMEMORY_URL}?q=${encodeURIComponent(word)}&langpair=en%7Czh-CN`;
    const {response, bodyText} = await fetchWithTimeout(
        url,
        {credentials: "omit", referrerPolicy: "no-referrer"},
        6000,
        false
    );
    if (!response.ok) return null;

    let data;
    try {
        data = JSON.parse(bodyText);
    } catch {
        return null;
    }
    const translated = data && data.responseData && data.responseData.translatedText;
    if (typeof translated !== "string" || !translated.trim()) return null;
    if (/MYMEMORY WARNING|INVALID|QUERY LENGTH LIMIT/i.test(translated)) return null;

    return {
        word,
        phonetic: "",
        entries: [{pos: "", variants: [translated.trim()]}],
        source: "mymemory"
    };
}

async function lookupDict(word) {
    const cached = dictCacheGet(word);
    if (cached) return cached;

    let result = null;
    try {
        result = await lookupYoudao(word);
    } catch {
        result = null;
    }
    if (!result) {
        try {
            result = await lookupMyMemory(word);
        } catch {
            result = null;
        }
    }
    if (result) dictCacheSet(word, result);
    return result;
}

async function handleLookupWord(message) {
    const word = normalizeLookupWord(message && message.word);
    if (!word || word.length > 48 || !WORD_PATTERN.test(word)) {
        return {type: "LOOKUP_WORD_RESULT", ok: false, error: "not a word"};
    }

    const result = await lookupDict(word);
    if (!result) return {type: "LOOKUP_WORD_RESULT", ok: false, error: "no translation"};
    return {type: "LOOKUP_WORD_RESULT", ok: true, result};
}

// 批量查词：按并发度分组、每组之间稍作停顿，避免触发有道的频率限制。
// 只返回查到的词，查不到的词直接跳过，不在结果里占位。
async function handleBatchLookupWord(message) {
    const rawWords = Array.isArray(message && message.words) ? message.words : [];
    const words = [];
    const seen = new Set();
    for (const raw of rawWords) {
        const word = normalizeLookupWord(raw);
        if (!word || word.length > 48 || !WORD_PATTERN.test(word) || seen.has(word)) continue;
        seen.add(word);
        words.push(word);
    }
    const max = Math.min(60, words.length);
    const limited = words.slice(0, max);
    const results = {};
    const concurrency = 3;
    const delayMs = 180;

    for (let i = 0; i < limited.length; i += concurrency) {
        const batch = limited.slice(i, i + concurrency);
        const settled = await Promise.all(batch.map(async (word) => {
            try {
                const result = await lookupDict(word);
                return result ? [word, result] : null;
            } catch {
                return null;
            }
        }));
        for (const item of settled) {
            if (item) results[item[0]] = item[1];
        }
        if (i + concurrency < limited.length) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    return {type: "BATCH_LOOKUP_WORD_RESULT", ok: true, results};
}
