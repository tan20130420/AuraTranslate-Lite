import {useEffect, useMemo, useState} from "react";
import {Core, storageGet, storageSet} from "../shared/settings";
import {Icon} from "../shared/Icon";

const TYPES = Core.PHRASE_LIBRARY_TYPES || ["phrasal", "idiom", "collocation", "slang"];
const TAGS = Core.PHRASE_LIBRARY_TAGS || [];
const LEVELS = Core.PHRASE_LIBRARY_LEVELS || ["A2", "B1", "B2", "C1"];
const STORAGE_KEY = Core.PHRASE_CUSTOM_STORAGE_KEY || "auraPhraseLibraryCustom";
const TYPE_LABEL = {phrasal: "短语动词", idiom: "习语", collocation: "搭配", slang: "俚语"};

const EMPTY_DRAFT = {
    phrase: "", type: "phrasal", meaning: "", tags: "daily", level: "B1",
};

function toEntry(draft) {
    return [draft.phrase.trim().toLocaleLowerCase().replace(/\s+/g, " "), draft.type,
        draft.meaning.trim(), draft.tags.trim(), draft.level];
}

function fromEntry(entry) {
    return {
        phrase: String(entry[0] || ""), type: String(entry[1] || "phrasal"),
        meaning: String(entry[2] || ""), tags: String(entry[3] || "daily"),
        level: String(entry[4] || "B1"),
    };
}

export function PhraseLibrary({hidden, navigate, settings, update}) {
    const [custom, setCustom] = useState(null);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [draft, setDraft] = useState(null);
    const [editingIndex, setEditingIndex] = useState(-1);
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState(false);

    const builtInCount = useMemo(() => (Core.phraseLibraryAll ? Core.phraseLibraryAll().length : 0), []);
    const customCount = custom ? custom.length : 0;

    async function load() {
        try {
            const result = await storageGet({[STORAGE_KEY]: []});
            setCustom(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
        } catch (error) {
            setNotice({text: `读取词库失败：${error.message}`, error: true});
            setCustom([]);
        }
    }

    useEffect(() => {
        if (hidden) return;
        load();
    }, [hidden]);

    async function persist(next) {
        setBusy(true);
        try {
            await storageSet({[STORAGE_KEY]: next});
            setCustom(next);
            setNotice({text: "已保存，播放器里点“重新扫描”即可生效。"});
        } catch (error) {
            setNotice({text: `保存失败：${error.message}`, error: true});
        } finally {
            setBusy(false);
        }
    }

    function validate(entry) {
        const norm = Core.phraseLibraryNormalize
            ? Core.phraseLibraryNormalize(entry) : null;
        if (!norm) return "请填写短语（至少两个词），并选择有效的类型。";
        if (norm.tags.length === 0) return "标签至少要有一个有效值。";
        return null;
    }

    function openAdd() {
        setDraft({...EMPTY_DRAFT});
        setEditingIndex(-1);
    }

    function openEdit(index, entry) {
        setDraft(fromEntry(entry));
        setEditingIndex(index);
    }

    async function saveDraft() {
        if (!draft) return;
        const entry = toEntry(draft);
        const problem = validate(entry);
        if (problem) {
            setNotice({text: problem, error: true});
            return;
        }
        const list = [...(custom || [])];
        if (editingIndex >= 0) list[editingIndex] = entry;
        else list.push(entry);
        await persist(list);
        setDraft(null);
        setEditingIndex(-1);
    }

    async function remove(index) {
        const list = (custom || []).filter((_, i) => i !== index);
        await persist(list);
    }

    async function restoreDefaults() {
        if (!window.confirm("确定清空所有自定义词条？内置词库不会受影响，此操作不可撤销。")) return;
        await persist([]);
    }

    const filtered = useMemo(() => {
        const list = (custom || []).map((entry, index) => ({entry, index}));
        const q = query.trim().toLocaleLowerCase();
        return list.filter(({entry}) => {
            const e = fromEntry(entry);
            if (filter !== "all" && e.type !== filter) return false;
            if (!q) return true;
            return `${e.phrase} ${e.meaning} ${e.tags}`.toLocaleLowerCase().includes(q);
        });
    }, [custom, query, filter]);

    return (
        <section id="phrase-library" className="settings-section" role="tabpanel"
                 aria-labelledby="tab-phrase-library" tabIndex={0} hidden={hidden}>
            <div className="section-heading">
                <p className="section-kicker">Vocabulary</p>
                <h2>我的词库</h2>
                <p>管理“短语与俚语”面板用到的词库。内置 {builtInCount} 条常用表达不可删除；你添加的词条会与内置词库合并，可随时修改或删除。</p>
            </div>

            <label className="toggle">
                <input id="phraseEnabled" type="checkbox"
                       checked={settings.phraseEnabled !== false}
                       onChange={(event) => update({phraseEnabled: event.target.checked})}/>
                <span>启用“短语与俚语”<small>关闭后，播放器菜单里不再显示短语入口。</small></span>
            </label>

            <div className="vocabulary-toolbar">
                <label className="vocabulary-search"><span className="sr-only">搜索我的词条</span>
                    <input id="phrase-search" type="search" placeholder="搜索我的词条"
                           aria-label="搜索我的词条" value={query}
                           onChange={(event) => setQuery(event.target.value)}/>
                </label>
                <select id="phrase-filter" aria-label="按类型筛选" value={filter}
                        onChange={(event) => setFilter(event.target.value)}>
                    <option value="all">全部类型</option>
                    {TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type] || type}</option>)}
                </select>
                <button type="button" className="secondary" onClick={openAdd}>
                    <Icon name="plus"/> 新增词条
                </button>
                <button type="button" className="secondary" onClick={restoreDefaults} disabled={busy || !customCount}>
                    清空自定义
                </button>
            </div>

            {draft && (
                <div className="field phrase-editor" role="group" aria-label="编辑词条">
                    <div className="phrase-editor-grid">
                        <label>短语（英文）
                            <input type="text" value={draft.phrase} placeholder="例如 figure out"
                                   onChange={(event) => setDraft({...draft, phrase: event.target.value})}/>
                        </label>
                        <label>类型
                            <select value={draft.type}
                                    onChange={(event) => setDraft({...draft, type: event.target.value})}>
                                {TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type] || type}</option>)}
                            </select>
                        </label>
                        <label>中文释义
                            <input type="text" value={draft.meaning} placeholder="例如 弄清楚；想出"
                                   onChange={(event) => setDraft({...draft, meaning: event.target.value})}/>
                        </label>
                        <label>标签（用 | 分隔）
                            <input type="text" value={draft.tags} placeholder="daily|informal"
                                   onChange={(event) => setDraft({...draft, tags: event.target.value})}/>
                        </label>
                        <label>级别
                            <select value={draft.level}
                                    onChange={(event) => setDraft({...draft, level: event.target.value})}>
                                {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                            </select>
                        </label>
                    </div>
                    <small>可选标签：{TAGS.join(" / ")}。自定义词条与内置词条同名的，会覆盖内置释义。</small>
                    <div className="phrase-editor-actions">
                        <button type="button" className="secondary" onClick={saveDraft} disabled={busy}>保存词条</button>
                        <button type="button" className="secondary" onClick={() => { setDraft(null); setEditingIndex(-1); }}>取消</button>
                    </div>
                </div>
            )}

            <div className="vocabulary-list">
                {filtered.map(({entry, index}) => {
                    const e = fromEntry(entry);
                    return (
                        <div className="vocabulary-entry" key={`${index}-${e.phrase}`}>
                            <div className="vocabulary-entry-head">
                                <strong className="vocabulary-word">{e.phrase}</strong>
                                <span className="vocabulary-meta">{TYPE_LABEL[e.type] || e.type} · {e.level} · {e.tags}</span>
                            </div>
                            <div className="vocabulary-translation">{e.meaning}</div>
                            <div className="vocabulary-entry-actions">
                                <button type="button" className="link-button" onClick={() => openEdit(index, entry)}>编辑</button>
                                <button type="button" className="link-button vocabulary-delete" onClick={() => remove(index)}>删除</button>
                            </div>
                        </div>
                    );
                })}
                {custom !== null && filtered.length === 0 && (
                    <p className="vocabulary-empty">{customCount ? "没有匹配的词条。" : "还没有自定义词条。点“新增词条”开始添加。"}</p>
                )}
            </div>

            <p className="vocabulary-count">自定义 {customCount} 条 · 内置 {builtInCount} 条</p>
            {notice && <p className="vocabulary-status" role="status" data-error={notice.error ? "true" : "false"}>{notice.text}</p>}
            <ol className="selection-guide">
                <li>添加后，回到视频在播放器里点开 AuraTranslate → 短语与俚语。</li>
                <li>点“重新扫描”以加载最新词库；之后切视频会自动使用新词库。</li>
                <li>自定义词条同名时会覆盖内置释义，可用于修正或补充释义。</li>
            </ol>
            <button type="button" className="secondary" onClick={() => navigate("wordfreq-settings")}>返回视频词频设置</button>
        </section>
    );
}
