// Subtitle segmentation and translation message handlers.

// 字幕批量翻译：免费源回退链统一在 background-mymemory.js 里实现，
// 划词/沉浸式翻译共用同一套 Google → Bing → MyMemory 逻辑。
async function translateSubtitlesBuiltIn(request, provider, retain) {
    return translateWithBuiltInFallback(request, provider, retain);
}

// Classic scripts share the dedicated background scope; background.js loads them
// synchronously in Chrome, and manifest.json supplies the same order in Firefox.
async function handleSegmentSubtitles(message) {
    const settings = await storageGet(Core.DEFAULT_SETTINGS);
    const sourceLanguage = settings.sourceLanguage || Core.DEFAULT_SETTINGS.sourceLanguage;
    const translationConfig = Core.resolveTranslationConfig(settings);
    const cues = (Array.isArray(message.cues) ? message.cues : [])
        .map((cue) => ({
            id: cue && cue.id != null ? String(cue.id) : "",
            sourceText: Core.normalizeSubtitleText(cue && cue.sourceText),
            startMs: Number(cue && cue.startMs),
            endMs: Number(cue && cue.endMs)
        }))
        .filter((cue) => cue.id && cue.sourceText);

    if (!settings.llmSentenceSegmentationEnabled || !cues.length) {
        return {
            type: "SEGMENT_SUBTITLES_RESULT",
            ok: true,
            videoId: message.videoId,
            groups: cues.map((cue) => ({startId: cue.id, endId: cue.id})),
            errors: []
        };
    }

    // 精简版：没配 AI 时不报错，直接退化为“一句一条字幕”。
    if (!translationConfig.apiKey) {
        return {
            type: "SEGMENT_SUBTITLES_RESULT",
            ok: true,
            videoId: message.videoId,
            groups: cues.map((cue) => ({startId: cue.id, endId: cue.id})),
            errors: []
        };
    }

    const endpointUrl =
        Core.translationEndpoint(translationConfig);
    if (!endpointUrl || !translationConfig.model) {
        throw new Error(`${translationConfig.providerLabel} base URL or model is not configured.`);
    }

    const inputFingerprint = Core.fingerprintText(
        cues.map((cue) => `${cue.id}:${cue.startMs}:${cue.endMs}:${cue.sourceText}`).join("|")
    );
    const cacheKey = `ytbt:segments:${Core.fingerprintText([
        message.videoId || "",
        message.trackFingerprint || "",
        inputFingerprint,
        translationConfig.provider,
        endpointUrl,
        translationConfig.model,
        sourceLanguage,
        Core.SENTENCE_SEGMENTATION_VERSION,
        "complete-sentences-v1",
        settings.cacheVersion || "1"
    ].join("|"))}`;
    const cached = await storageGet({[cacheKey]: null});
    const cachedValue = cached[cacheKey];
    if (
        cachedValue &&
        cachedValue.inputFingerprint === inputFingerprint &&
        Array.isArray(cachedValue.groups)
    ) {
        try {
            Core.applySentenceSegmentationGroups(cues, cachedValue.groups);
            return {
                type: "SEGMENT_SUBTITLES_RESULT",
                ok: true,
                videoId: message.videoId,
                groups: cachedValue.groups,
                cached: true,
                errors: []
            };
        } catch (error) {
            // Ignore malformed or stale segmentation cache and regenerate it below.
        }
    }

    let pendingSegmentation = inFlightSentenceSegmentations.get(cacheKey);
    if (!pendingSegmentation) {
        pendingSegmentation = (async () => {
            const groups = await segmentSubtitleCues({translationConfig, sourceLanguage, cues});
            Core.applySentenceSegmentationGroups(cues, groups);
            await persistSentenceSegmentationCache(cacheKey, {
                kind: "sentence-segmentation",
                inputFingerprint,
                groups,
                updatedAt: Date.now(),
                provider: translationConfig.provider,
                model: translationConfig.model,
                sourceLanguage,
                version: Core.SENTENCE_SEGMENTATION_VERSION
            });
            return groups;
        })();
        inFlightSentenceSegmentations.set(cacheKey, pendingSegmentation);
        pendingSegmentation.finally(() => {
            if (inFlightSentenceSegmentations.get(cacheKey) === pendingSegmentation) {
                inFlightSentenceSegmentations.delete(cacheKey);
            }
        }).catch(() => {
        });
    }
    const groups = await pendingSegmentation;

    return {
        type: "SEGMENT_SUBTITLES_RESULT",
        ok: true,
        videoId: message.videoId,
        groups,
        cached: false,
        errors: []
    };
}

async function segmentSubtitleCues({translationConfig, sourceLanguage, cues}) {
    const committedGroups = [];
    let carryCues = [];
    let cursor = 0;

    while (cursor < cues.length) {
        const nextCursor = Math.min(cues.length, cursor + SEGMENTATION_BATCH_SIZE);
        const windowCues = carryCues.concat(cues.slice(cursor, nextCursor));
        cursor = nextCursor;
        const groups = await translateWithRetry({
            translationConfig,
            targetLanguage: "",
            sourceLanguage,
            asrCorrectionEnabled: false,
            cues: windowCues,
            mode: "segmentation"
        });
        const isFinalWindow = cursor >= cues.length;

        if (isFinalWindow) {
            committedGroups.push(...groups);
            carryCues = [];
            break;
        }

        const lastGroup = groups[groups.length - 1];
        const carryStartIndex = windowCues.findIndex(
            (cue) => String(cue.id) === String(lastGroup.startId)
        );
        const carryEndIndex = windowCues.findIndex(
            (cue) => String(cue.id) === String(lastGroup.endId)
        );
        const nextCarry = windowCues.slice(carryStartIndex, carryEndIndex + 1);

        if (nextCarry.length && nextCarry.length <= MAX_SEGMENTATION_CARRY_CUES) {
            committedGroups.push(...groups.slice(0, -1));
            carryCues = nextCarry;
        } else {
            committedGroups.push(...groups);
            carryCues = [];
        }
    }

    return committedGroups;
}

async function persistSentenceSegmentationCache(cacheKey, cacheValue) {
    await storageSet({[cacheKey]: cacheValue});
    const all = await storageGet(null);
    const entries = Object.keys(all)
        .filter((key) => key.startsWith("ytbt:segments:") && key !== cacheKey)
        .map((key) => ({
            key,
            updatedAt: Number(all[key] && all[key].updatedAt) || 0
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt);
    const staleKeys = entries
        .slice(Math.max(0, MAX_SEGMENTATION_CACHE_ENTRIES - 1))
        .map((entry) => entry.key);
    if (staleKeys.length) {
        await storageRemove(staleKeys);
    }
}

async function handleTranslateBatch(message) {
    const settings = await storageGet(Core.DEFAULT_SETTINGS);
    const targetLanguage = settings.targetLanguage || Core.DEFAULT_SETTINGS.targetLanguage;
    const sourceLanguage = settings.sourceLanguage || Core.DEFAULT_SETTINGS.sourceLanguage;
    const translationConfig = Core.resolveTranslationConfig(settings);
    // 注意：这个值参与缓存键计算，不能因为“当前没 Key”就翻转，
    // 否则用户填/清 Key 会导致已有字幕缓存全部失效。
    const asrCorrectionEnabled = settings.asrCorrectionEnabled !== false;
    const llmSentenceSegmentationEnabled = settings.llmSentenceSegmentationEnabled !== false;
    const showOriginalTechnicalTerms = settings.showOriginalTechnicalTerms !== false;

    const endpointUrl =
        Core.translationEndpoint(translationConfig);
    const cues = Array.isArray(message.cues) ? message.cues : [];
    const legacyCacheKeyParts = [
        message.videoId || "",
        message.trackFingerprint || "",
        translationConfig.provider,
        endpointUrl,
        translationConfig.model,
        targetLanguage,
        Core.MERGE_VERSION,
        settings.cacheVersion || "1"
    ];
    const correctedCacheKeyParts = legacyCacheKeyParts.slice(0, 5).concat([
        sourceLanguage,
        targetLanguage,
        "asr-correction-on",
        Core.MERGE_VERSION,
        settings.cacheVersion || "1"
    ]);
    const segmentedCacheKeyParts = legacyCacheKeyParts.slice(0, 5).concat([
        sourceLanguage,
        targetLanguage,
        asrCorrectionEnabled ? "asr-correction-on" : "asr-correction-off",
        "llm-sentence-segmentation-on",
        Core.SENTENCE_SEGMENTATION_VERSION,
        Core.MERGE_VERSION,
        settings.cacheVersion || "1"
    ]);
    const activeCacheKeyParts =
        llmSentenceSegmentationEnabled
            ? segmentedCacheKeyParts
            : asrCorrectionEnabled
                ? correctedCacheKeyParts
                : legacyCacheKeyParts;
    const cacheKey = Core.makeCacheKey(
        activeCacheKeyParts.concat(
            showOriginalTechnicalTerms
                ? "original-technical-terms-on"
                : "original-technical-terms-off"
        )
    );

    const cache = await storageGet({[cacheKey]: {items: {}, updatedAt: 0}});
    const cacheValue = cache[cacheKey] || {items: {}};
    const cachedItems = [];
    const missingCues = [];
    const sourceTextById = new Map();

    for (const cue of cues) {
        const id = cue && cue.id != null ? String(cue.id) : "";
        if (!id) {
            continue;
        }
        const sourceText = Core.normalizeSubtitleText(cue.sourceText || cue.displaySourceText || "");
        sourceTextById.set(id, sourceText);
        const cachedValue = cacheValue.items && cacheValue.items[id];
        const cachedText =
            typeof cachedValue === "string"
                ? cachedValue
                : cachedValue != null && typeof cachedValue === "object"
                    ? cachedValue.translatedText
                    : "";
        const cachedSourceFingerprint =
            cachedValue && typeof cachedValue === "object" ? cachedValue.sourceFingerprint : "";
        const sourceMatchesCache =
            cachedSourceFingerprint
                ? cachedSourceFingerprint === Core.fingerprintText(sourceText)
                : !llmSentenceSegmentationEnabled;
        if (cachedText && sourceMatchesCache) {
            const cachedItem = {id, translatedText: cachedText, cached: true};
            if (cachedValue && typeof cachedValue === "object" && cachedValue.displaySourceText) {
                cachedItem.displaySourceText = cachedValue.displaySourceText;
            }
            cachedItems.push(cachedItem);
        } else {
            missingCues.push({
                id,
                sourceText
            });
        }
    }

    if (message.cacheOnly === true || !missingCues.length) {
        return {
            type: "TRANSLATE_RESULT",
            ok: true,
            videoId: message.videoId,
            batchId: message.batchId,
            items: cachedItems,
            errors: []
        };
    }

    // 翻译源：显式选了内置源就用它；否则在没配 AI 时自动降级到免 Key 源。
    const requestedProvider = settings.subtitleTranslationProvider;
    const builtInProvider = ["google-free", "bing-free"].includes(requestedProvider)
        ? requestedProvider
        : !translationConfig.apiKey ? "google-free" : "off";

    if (builtInProvider === "off" && (!translationConfig.apiKey || !endpointUrl || !translationConfig.model)) {
        const missingKey = !translationConfig.apiKey;
        return {
            type: "TRANSLATE_RESULT",
            ok: false,
            videoId: message.videoId,
            batchId: message.batchId,
            items: cachedItems,
            errors: [{
                code: missingKey ? "missing_api_key" : "missing_provider_config",
                message: `${translationConfig.providerLabel} ${missingKey ? "API Key" : "base URL or model"} is not configured.`
            }]
        };
    }

    const translatedItems = await translateMissingCues({
        cacheKey,
        translationConfig,
        targetLanguage,
        sourceLanguage,
        asrCorrectionEnabled,
        showOriginalTechnicalTerms,
        cues: missingCues,
        translateCues: builtInProvider === "off" ? undefined : (request, retain) =>
            translateSubtitlesBuiltIn(request, builtInProvider, retain),
        async persistItems(items) {
            const newCacheItems = {};
            for (const item of items) {
                newCacheItems[item.id] = {
                    translatedText: item.translatedText,
                    displaySourceText: item.displaySourceText || "",
                    sourceFingerprint: Core.fingerprintText(sourceTextById.get(String(item.id)) || "")
                };
            }
            await persistTranslationCache({
                cacheKey,
                cacheValue: {
                    items: newCacheItems,
                    updatedAt: Date.now(),
                    provider: translationConfig.provider,
                    model: translationConfig.model,
                    baseUrl: translationConfig.baseUrl,
                    targetLanguage,
                    sourceLanguage,
                    asrCorrectionEnabled,
                    llmSentenceSegmentationEnabled,
                    showOriginalTechnicalTerms
                },
                maxItems: Number(settings.translationCacheMaxItems) || Core.DEFAULT_CACHE_MAX_ITEMS
            });
        }
    });

    return {
        type: "TRANSLATE_RESULT",
        ok: true,
        videoId: message.videoId,
        batchId: message.batchId,
        items: cachedItems.concat(translatedItems),
        errors: []
    };
}
