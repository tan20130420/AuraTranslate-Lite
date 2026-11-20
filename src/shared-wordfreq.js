// English word-frequency analysis for a single video's subtitle track.
// Browser: register before shared.js. Node: shared.js calls this factory.
// Data source: frequency-en.js registers a lowercase ranked word list on Shared.
(function registerSharedModule(root, register) {
    if (typeof module !== "undefined" && module.exports) module.exports = register;
    else register(root.YTBTShared || (root.YTBTShared = {}));
})(globalThis, function (Shared) {
    "use strict";

    // Words that must never leak into a "words to learn" list.
    const STOP_WORDS = new Set([
        "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "because",
        "of", "in", "on", "at", "to", "from", "by", "for", "with", "about", "into",
        "over", "under", "up", "down", "out", "off", "again", "once", "here", "there",
        "is", "am", "are", "was", "were", "be", "been", "being", "has", "have", "had",
        "having", "do", "does", "did", "doing", "will", "would", "shall", "should",
        "can", "could", "may", "might", "must", "ought", "i", "you", "he", "she", "it",
        "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its",
        "our", "their", "mine", "yours", "hers", "ours", "theirs", "myself", "yourself",
        "this", "that", "these", "those", "which", "who", "whom", "whose", "what",
        "when", "where", "why", "how", "all", "any", "both", "each", "few", "more",
        "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
        "too", "very", "s", "t", "just", "don", "now", "get", "got", "one", "two",
    ]);

    // Common irregular forms mapped to their lemma. Only forms that are NOT
    // themselves a standalone frequent word need to be listed here.
    const IRREGULAR = {
        is: "be", am: "be", are: "be", was: "be", were: "be", been: "be", being: "be",
        has: "have", had: "have", having: "have",
        does: "do", did: "do", doing: "do",
        went: "go", gone: "go", goes: "go", going: "go",
        ate: "eat", eaten: "eat",
        saw: "see", seen: "see",
        took: "take", taken: "take",
        made: "make",
        came: "come",
        said: "say",
        told: "tell",
        knew: "know", known: "know",
        thought: "think",
        bought: "buy",
        brought: "bring",
        caught: "catch",
        taught: "teach",
        felt: "feel",
        kept: "keep",
        left: "leave",
        lost: "lose",
        meant: "mean",
        met: "meet",
        paid: "pay",
        read: "read",
        ran: "run",
        sat: "sit",
        stood: "stand",
        spoke: "speak", spoken: "speak",
        wrote: "write", written: "write",
        broke: "break", broken: "break",
        chose: "choose", chosen: "choose",
        drove: "drive", driven: "drive",
        gave: "give", given: "give",
        grew: "grow", grown: "grow",
        held: "hold",
        hid: "hide", hidden: "hide",
        led: "lead",
        let: "let",
        put: "put",
        set: "set",
        showed: "show", shown: "show",
        sang: "sing", sung: "sing",
        sank: "sink", sunk: "sink",
        slept: "sleep",
        sold: "sell",
        sent: "send",
        shut: "shut",
        swam: "swim", swum: "swim",
        won: "win",
        wore: "wear", worn: "wear",
        wept: "weep",
        children: "child", men: "man", women: "woman", feet: "foot", teeth: "tooth",
        mice: "mouse", geese: "goose", people: "person", lives: "life", knives: "knife",
        wolves: "wolf", shelves: "shelf", leaves: "leaf", loaves: "loaf", halves: "half",
        better: "good", best: "good", worse: "bad", worst: "bad",
        further: "far", farthest: "far",
        less: "little", least: "little",
    };

    const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

    function frequencyList() {
        return Array.isArray(Shared.FREQUENCY_EN) ? Shared.FREQUENCY_EN : [];
    }

    function frequencyRank() {
        if (Shared._frequencyRank) return Shared._frequencyRank;
        const rank = new Map();
        const list = frequencyList();
        for (let i = 0; i < list.length; i += 1) rank.set(list[i], i);
        Shared._frequencyRank = rank;
        return rank;
    }

    function isKnownWord(word) {
        return frequencyRank().has(word);
    }

    // Naive English stemmer: strip suffixes only when the result is a known
    // frequent word, so we never turn "business" into "busi".
    function stem(word) {
        if (IRREGULAR[word]) return IRREGULAR[word];

        const candidates = [];
        if (word.endsWith("ies") && word.length > 4) candidates.push(word.slice(0, -3) + "y");
        if (word.endsWith("ves") && word.length > 4) {
            candidates.push(word.slice(0, -3) + "f");
            candidates.push(word.slice(0, -3) + "fe");
        }
        if (word.endsWith("es") && word.length > 3) {
            candidates.push(word.slice(0, -2));
            candidates.push(word.slice(0, -1));
        }
        if (word.endsWith("s") && word.length > 3 && !/(ss|us|is)$/.test(word)) {
            candidates.push(word.slice(0, -1));
        }
        if (word.endsWith("ing") && word.length > 5) {
            candidates.push(word.slice(0, -3));
            candidates.push(word.slice(0, -3) + "e");
            const base = word.slice(0, -3);
            if (/([bcdfghjklmnpqrstvwxz])\1$/.test(base)) candidates.push(base.slice(0, -1));
        }
        if (word.endsWith("ed") && word.length > 4) {
            candidates.push(word.slice(0, -2));
            candidates.push(word.slice(0, -1));
            const base = word.slice(0, -2);
            if (/([bcdfghjklmnpqrstvwxz])\1$/.test(base)) candidates.push(base.slice(0, -1));
        }
        if (word.endsWith("er") && word.length > 4) {
            candidates.push(word.slice(0, -2));
            candidates.push(word.slice(0, -1));
        }
        if (word.endsWith("est") && word.length > 5) {
            candidates.push(word.slice(0, -3));
            candidates.push(word.slice(0, -3) + "e");
        }
        if (word.endsWith("ly") && word.length > 4) candidates.push(word.slice(0, -2));

        let best = null;
        let bestRank = Infinity;
        for (const candidate of candidates) {
            if (!isKnownWord(candidate)) continue;
            const r = frequencyRank().get(candidate);
            if (r < bestRank) { bestRank = r; best = candidate; }
        }
        // Prefer the shortest valid lemma, but never merge a word into itself.
        // When both the surface form and a stem are known, merge only if the
        // stem is meaningfully shorter (avoids "business" -> "busi" style errors
        // and keeps already-canonical words stable).
        if (best && best !== word && best.length < word.length) return best;
        return word;
    }

    function tokenize(text) {
        const words = [];
        const matches = String(text || "").toLocaleLowerCase().match(WORD_RE);
        if (!matches) return words;
        for (const match of matches) {
            const clean = match.replace(/['’]/g, "");
            if (clean.length < 2) continue;
            words.push(clean);
        }
        return words;
    }

    function difficulty(rank) {
        if (rank < 1000) return "core";
        if (rank < 3000) return "common";
        if (rank < 8000) return "advanced";
        return "rare";
    }

    // cues: array of objects with sourceText / displaySourceText.
    // Returns words sorted by in-video count, then by general frequency rank.
    function analyze(cues, options) {
        const opts = options || {};
        const minLength = opts.minLength || 3;
        const includeStopWords = Boolean(opts.includeStopWords);
        const counts = new Map();
        const surfaces = new Map();
        let totalTokens = 0;

        const list = Array.isArray(cues) ? cues : [];
        for (const cue of list) {
            const text = cue && (cue.displaySourceText || cue.sourceText || cue.text);
            for (const token of tokenize(text)) {
                totalTokens += 1;
                const lemma = stem(token);
                if (!includeStopWords && STOP_WORDS.has(lemma)) continue;
                if (lemma.length < minLength) continue;
                counts.set(lemma, (counts.get(lemma) || 0) + 1);
                if (!surfaces.has(lemma)) surfaces.set(lemma, new Set());
                surfaces.get(lemma).add(token);
            }
        }

        const rank = frequencyRank();
        const words = [];
        for (const [word, count] of counts) {
            const freqRank = rank.has(word) ? rank.get(word) : null;
            words.push({
                word,
                count,
                rank: freqRank,
                level: freqRank == null ? "unknown" : difficulty(freqRank),
                forms: Array.from(surfaces.get(word) || []).sort(),
            });
        }

        words.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            const ar = a.rank == null ? Infinity : a.rank;
            const br = b.rank == null ? Infinity : b.rank;
            if (ar !== br) return ar - br;
            return a.word.localeCompare(b.word);
        });

        return {words, totalTokens, uniqueWords: words.length};
    }

    Object.assign(Shared, {
        WORDFREQ_MIN_LENGTH: 3,
        WORD_FREQUENCY_LEVELS: ["core", "common", "advanced", "rare", "unknown"],
        wordFreqTokenize: tokenize,
        wordFreqStem: stem,
        wordFreqAnalyze: analyze,
        wordFreqIsKnown: isKnownWord,
    });
});
