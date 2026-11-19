// Local vocabulary format shared by the background, content script and settings.
(function registerSharedModule(root, register) {
    if (typeof module !== "undefined" && module.exports) module.exports = register;
    else register(root.YTBTShared || (root.YTBTShared = {}));
})(globalThis, function (Shared) {
    "use strict";
    // Deliberately outside ytbt:, whose keys are disposable translation caches.
    const VOCABULARY_STORAGE_KEY = "auraVocabulary";
    const VOCABULARY_MAX_ENTRIES = 5000;
    const SELECTION_MAX_CHARS = 3000;

    // 三档复习：0 生疏 → 1 一般 → 2 熟悉 → 3 掌握。
    // 间隔按档位递增，不引入 FSRS/Anki 一整套调度。
    const REVIEW_STEPS_MAX = 3;
    const REVIEW_INTERVALS_MS = [10 * 60 * 1000, 24 * 3600 * 1000, 3 * 24 * 3600 * 1000, 7 * 24 * 3600 * 1000];

    function vocabularyText(value, limit) {
        return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, limit) : "";
    }

    function vocabularySourceUrl(value) {
        try {
            const url = new URL(typeof value === "string" ? value.slice(0, 2048) : "");
            if (!["http:", "https:"].includes(url.protocol)) return "";
            url.username = "";
            url.password = "";
            return url.href;
        } catch (_) { return ""; }
    }

    function normalizeVocabularyEntry(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (typeof value.sourceText !== "string" || value.sourceText.length > SELECTION_MAX_CHARS ||
            typeof value.translatedText !== "string" || value.translatedText.length > 12000) return null;
        const sourceText = vocabularyText(value.sourceText, SELECTION_MAX_CHARS).replace(/\s+/g, " ");
        const translatedText = vocabularyText(value.translatedText, 12000);
        if (!sourceText || !translatedText) return null;
        const language = (code, fallback) => typeof code === "string" && /^(?:auto|[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2})$/i.test(code) ? code : fallback;
        const now = Date.now();
        const date = (n) => Number.isSafeInteger(n) && n > 0 && n <= now + 86400000 ? n : now;
        return {
            id: typeof value.id === "string" && /^[a-z0-9_-]{1,100}$/i.test(value.id) ? value.id : "",
            sourceText, translatedText,
            sourceLanguage: language(value.sourceLanguage, "auto"),
            targetLanguage: language(value.targetLanguage === "auto" ? "" : value.targetLanguage, "zh-CN"),
            contextText: vocabularyText(value.contextText, 1800),
            sourceUrl: vocabularySourceUrl(value.sourceUrl),
            sourceTitle: vocabularyText(value.sourceTitle, 300),
            notes: vocabularyText(value.notes, 2000),
            learned: value.learned === true,
            createdAt: date(value.createdAt),
            updatedAt: date(value.updatedAt),
            // 复习状态：老词条没有这些字段时按“未复习过”处理。
            step: Number.isInteger(value.step) && value.step >= 0 && value.step <= REVIEW_STEPS_MAX ? value.step : 0,
            reviewCount: Number.isSafeInteger(value.reviewCount) && value.reviewCount > 0 ? value.reviewCount : 0,
            lastReviewedAt: Number.isSafeInteger(value.lastReviewedAt) && value.lastReviewedAt > 0 ? value.lastReviewedAt : 0,
            nextReviewAt: Number.isSafeInteger(value.nextReviewAt) && value.nextReviewAt > 0 ? value.nextReviewAt : 0,
        };
    }

    function vocabularyIdentity(entry) {
        const canonical = (text) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
        // Keep different senses of the same word as separate entries.
        return JSON.stringify([canonical(entry.sourceText), entry.sourceLanguage.toLowerCase(),
            entry.targetLanguage.toLowerCase(), canonical(entry.translatedText)]);
    }

    // 评分：again 回到 0 档，good 进一档，easy 进两档。
    function scheduleReview(entry, rating, now = Date.now()) {
        const current = Number.isInteger(entry.step) ? entry.step : 0;
        let step;
        if (rating === "again") step = 0;
        else if (rating === "easy") step = Math.min(REVIEW_STEPS_MAX, current + 2);
        else step = Math.min(REVIEW_STEPS_MAX, current + 1);
        const interval = REVIEW_INTERVALS_MS[step];
        return {
            step,
            reviewCount: (Number.isSafeInteger(entry.reviewCount) ? entry.reviewCount : 0) + 1,
            lastReviewedAt: now,
            nextReviewAt: now + interval,
            // 连过三档才算学全，仍允许手动改。
            learned: step >= REVIEW_STEPS_MAX,
        };
    }

    function isReviewDue(entry, now = Date.now()) {
        if (!entry || entry.learned) return false;
        return !entry.nextReviewAt || entry.nextReviewAt <= now;
    }

    Object.assign(Shared, {VOCABULARY_STORAGE_KEY, VOCABULARY_MAX_ENTRIES, SELECTION_MAX_CHARS,
        REVIEW_STEPS_MAX, REVIEW_INTERVALS_MS,
        vocabularySourceUrl, normalizeVocabularyEntry, vocabularyIdentity, scheduleReview, isReviewDue});
});
