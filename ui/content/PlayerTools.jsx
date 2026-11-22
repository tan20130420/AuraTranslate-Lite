import {React} from "./runtime.js";

// Icon geometry matches the extension's previous inline SVG set so the player
// stylesheet keeps rendering the same marks.
const ICON_PATHS = {
    subtitles: "M3 5h18v14H3zM6 13h5M14 13h4M6 16h3M12 16h6",
    settings: "M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    summary: "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    close: "m6 6 12 12M18 6 6 18",
    back: "m14 5-7 7 7 7",
    copy: "M8 8h12v13H8zM16 8V3H3v13h5",
    reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16",
    volume: "M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6",
    plus: "M12 5v14M5 12h14",
    check: "m5 12 4 4L19 6",
};

function Icon({name}) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={ICON_PATHS[name] || ICON_PATHS.subtitles}/>
        </svg>
    );
}

function MenuRow({icon, action, trailing, children, onAction}) {
    return (
        <button type="button" className="ytbt-menu-row" data-action={action}
                onClick={() => onAction(action)}>
            <Icon name={icon}/><span>{children}</span>
            {trailing && <span aria-hidden="true">{trailing}</span>}
        </button>
    );
}

function StyleFields({settings, onSetting, onAction}) {
    return (
        <div className="ytbt-menu-style" hidden={false}>
            <div className="ytbt-style-heading">
                <button type="button" className="ytbt-icon-button" data-action="back" title="返回"
                        aria-label="返回" onClick={() => onAction("back")}><Icon name="back"/></button>
                <strong>字幕样式</strong>
                <button type="button" className="ytbt-icon-button" data-action="reset-style"
                        title="恢复默认样式" aria-label="恢复默认样式"
                        onClick={() => onAction("reset-style")}><Icon name="reset"/></button>
            </div>
            <label className="ytbt-style-field">显示模式
                <select data-setting="subtitleDisplayMode" aria-label="显示模式"
                        value={settings.subtitleDisplayMode}
                        onChange={(event) => onSetting("subtitleDisplayMode", event.target.value)}>
                    <option value="bilingual">双语字幕</option>
                    <option value="translation">仅译文</option>
                    <option value="original">仅原文</option>
                </select>
            </label>
            <label className="ytbt-style-field">字号
                <output className="ytbt-font-value">{Number(settings.fontScale).toFixed(2)}x</output>
                <input type="range" min="0.3" max="3" step="0.05" data-setting="fontScale"
                       aria-label="字幕字号" value={String(settings.fontScale)}
                       onChange={(event) => onSetting("fontScale", Number(event.target.value))}/>
            </label>
            <label className="ytbt-style-field">背景不透明度
                <output className="ytbt-opacity-value">{Math.round(settings.subtitleBackgroundOpacity * 100)}%</output>
                <input type="range" min="0" max="1" step="0.05" data-setting="subtitleBackgroundOpacity"
                       aria-label="背景不透明度" value={String(settings.subtitleBackgroundOpacity)}
                       onChange={(event) => onSetting("subtitleBackgroundOpacity", Number(event.target.value))}/>
            </label>
            <label className="ytbt-style-field ytbt-color-field">文字颜色
                <input type="color" data-setting="subtitleColor" aria-label="字幕文字颜色"
                       value={settings.subtitleColor}
                       onChange={(event) => onSetting("subtitleColor", event.target.value)}/>
            </label>
            <button type="button" className="ytbt-text-button" data-action="reset-position"
                    onClick={() => onAction("reset-position")}>重置字幕位置</button>
        </div>
    );
}

function TranscriptView({transcript, view, onAction, onSearch, onFollow, onSeek}) {
    return (
        <div className="ytbt-transcript-view" hidden={view !== "transcript"}>
            <div className="ytbt-list-toolbar">
                <input type="search" className="ytbt-transcript-search" placeholder="搜索字幕"
                       aria-label="搜索字幕" value={transcript.query}
                       onChange={(event) => onSearch(event.target.value)}/>
                <label>
                    <input type="checkbox" className="ytbt-follow" checked={transcript.follow}
                           onChange={(event) => onFollow(event.target.checked)}/>跟随播放
                </label>
            </div>
            <div className="ytbt-cue-list" tabIndex={0} aria-label="视频字幕列表"
                 onWheel={() => onFollow(false)} onTouchMove={() => onFollow(false)}>
                {transcript.rows.map((row, index) => (
                    <button key={index} type="button" className="ytbt-cue-row"
                            data-index={index}
                            aria-current={row.current ? "true" : "false"}
                            onClick={() => onSeek(row.cue)}>
                        <time>{row.start}</time>
                        <span>
                            <span className="ytbt-cue-source">{row.original}</span>
                            <span className="ytbt-cue-translation">{row.translation}</span>
                        </span>
                    </button>
                ))}
                {!transcript.rows.length && (
                    <p className="ytbt-list-empty">{transcript.empty}</p>
                )}
            </div>
            <footer className="ytbt-list-footer">
                <span className="ytbt-cue-count">{transcript.count} 条字幕</span>
                <button type="button" className="ytbt-text-button" data-action="load-captions"
                        hidden={transcript.hasCues || transcript.loading}
                        onClick={() => onAction("load-captions")}>重新读取</button>
                <button type="button" className="ytbt-text-button" data-action="more"
                        hidden={!transcript.hasMore}
                        onClick={() => onAction("more")}>加载更多</button>
            </footer>
        </div>
    );
}

const LEVEL_LABEL = {core: "基础", common: "常见", advanced: "进阶", rare: "少见", unknown: "其他"};
const PHRASE_TYPE_LABEL = {phrasal: "短语动词", idiom: "习语", collocation: "搭配", slang: "俚语"};

function PhraseView({phrase, view, onAction}) {
    return (
        <div className="ytbt-wordfreq-view ytbt-phrase-view" hidden={view !== "phrase"}>
            <div className="ytbt-list-toolbar ytbt-wordfreq-toolbar">
                <span className="ytbt-wordfreq-hint">视频字幕中的短语 · 点词条看例句</span>
                <button type="button" className="ytbt-text-button" data-action="ph-reload"
                        hidden={phrase.loading}
                        onClick={() => onAction("ph-reload")}>重新扫描</button>
            </div>
            <div className="ytbt-cue-list ytbt-wordfreq-list" tabIndex={0} aria-label="视频短语列表">
                {phrase.rows.map((row) => {
                    const expanded = phrase.expanded === row.phrase;
                    return (
                        <div key={row.phrase} className={`ytbt-wordfreq-row${expanded ? " expanded" : ""}`}>
                            <button type="button" className="ytbt-wordfreq-head" data-phrase={row.phrase}
                                    aria-expanded={expanded ? "true" : "false"}
                                    onClick={() => onAction(expanded ? "ph-collapse" : "ph-expand", row.phrase)}>
                                <span className="ytbt-ph-type">{PHRASE_TYPE_LABEL[row.type] || row.type}</span>
                                <span className="ytbt-wf-word">{row.phrase}</span>
                                <span className="ytbt-wf-count">{row.count} 次</span>
                            </button>
                            {expanded && (
                                <div className="ytbt-wordfreq-detail">
                                    <p className="ytbt-wf-meaning">{row.meaning || "（暂无释义，可在设置里编辑）"}</p>
                                    <div className="ytbt-wf-actions">
                                        <button type="button" className="ytbt-icon-button" data-action="ph-speak"
                                                title="朗读" aria-label="朗读" onClick={() => onAction("ph-speak", row.phrase)}>
                                            <Icon name="volume"/>
                                        </button>
                                    </div>
                                    {row.examples && row.examples.length > 0 && (
                                        <div className="ytbt-wf-examples">
                                            <p className="ytbt-wf-examples-title">
                                                视频中出现 {row.examples.length} 次 · 点句子跳转播放
                                            </p>
                                            {(phrase.examplesAll ? row.examples : row.examples.slice(0, 5))
                                                .map((example, exIndex) => (
                                                    <button type="button" key={`${example.cueIndex}-${exIndex}`}
                                                            className="ytbt-wf-example" data-action="ph-example-seek"
                                                            title="跳转到视频此处播放"
                                                            onClick={() => onAction("ph-example-seek", example)}>
                                                        <time>{example.start}</time>
                                                        <span>
                                                            {example.parts.map((part, pIndex) => part.hit
                                                                ? <mark key={pIndex}>{part.text}</mark>
                                                                : <span key={pIndex}>{part.text}</span>)}
                                                        </span>
                                                    </button>
                                                ))}
                                            {row.examples.length > 5 && (
                                                <button type="button" className="ytbt-text-button" data-action="ph-examples-all"
                                                        onClick={() => onAction("ph-examples-all")}>
                                                    {phrase.examplesAll ? "收起例句" : `查看全部 ${row.examples.length} 句`}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {!phrase.rows.length && (
                    <p className="ytbt-list-empty">{phrase.empty}</p>
                )}
            </div>
            <footer className="ytbt-list-footer">
                <span className="ytbt-cue-count">{phrase.count} 个短语</span>
            </footer>
        </div>
    );
}

function WordFreqView({wordfreq, view, onAction}) {
    return (
        <div className="ytbt-wordfreq-view" hidden={view !== "wordfreq"}>
            <div className="ytbt-list-toolbar ytbt-wordfreq-toolbar">
                <span className="ytbt-wordfreq-hint">按出现次数排序 · 点词条看释义</span>
                <button type="button" className="ytbt-text-button" data-action="wf-reload"
                        hidden={wordfreq.loading}
                        onClick={() => onAction("wf-reload")}>重新统计</button>
            </div>
            <div className="ytbt-cue-list ytbt-wordfreq-list" tabIndex={0} aria-label="视频词频列表">
                {wordfreq.rows.map((row, index) => {
                    const expanded = wordfreq.expanded === row.word;
                    const definition = wordfreq.definitions[row.word];
                    const meanings = definition && definition.entries
                        ? definition.entries.map((entry) => [entry.pos, entry.variants.join("，")].filter(Boolean).join(" ")).join("；")
                        : "";
                    return (
                        <div key={row.word} className={`ytbt-wordfreq-row${expanded ? " expanded" : ""}`}>
                            <button type="button" className="ytbt-wordfreq-head" data-word={row.word}
                                    aria-expanded={expanded ? "true" : "false"}
                                    onClick={() => onAction(expanded ? "wf-collapse" : "wf-expand", row.word)}>
                                <span className={`ytbt-wf-level level-${row.level}`}>{LEVEL_LABEL[row.level] || "其他"}</span>
                                <span className="ytbt-wf-word">{row.word}</span>
                                <span className="ytbt-wf-count">{row.count} 次</span>
                            </button>
                            {expanded && (
                                <div className="ytbt-wordfreq-detail">
                                    <p className="ytbt-wf-forms">出现形式：{row.forms.join(" / ")}</p>
                                    <p className="ytbt-wf-meaning">
                                        {wordfreq.loadingWord === row.word
                                            ? "正在查询释义..."
                                            : (meanings || (definition ? "未找到释义" : "点下方按钮查询释义"))}
                                    </p>
                                    <div className="ytbt-wf-actions">
                                        <button type="button" className="ytbt-icon-button" data-action="wf-speak"
                                                title="朗读" aria-label="朗读" onClick={() => onAction("wf-speak", row.word)}>
                                            <Icon name="volume"/>
                                        </button>
                                        <button type="button" className="ytbt-icon-button" data-action="wf-def"
                                                title="查释义" aria-label="查释义" onClick={() => onAction("wf-def", row.word)}>
                                            <Icon name="book"/>
                                        </button>
                                        <button type="button" className="ytbt-icon-button" data-action="wf-save"
                                                title={row.saved ? "已收藏" : "收藏到生词本"} aria-label="收藏到生词本"
                                                onClick={() => onAction("wf-save", row.word)}>
                                            <Icon name={row.saved ? "check" : "plus"}/>
                                        </button>
                                    </div>
                                    {row.examples && row.examples.length > 0 && (
                                        <div className="ytbt-wf-examples">
                                            <p className="ytbt-wf-examples-title">
                                                视频中出现 {row.examples.length} 次 · 点句子跳转播放
                                            </p>
                                            {(wordfreq.examplesAll ? row.examples : row.examples.slice(0, 5))
                                                .map((example, exIndex) => (
                                                    <button type="button" key={`${example.cueIndex}-${exIndex}`}
                                                            className="ytbt-wf-example" data-action="wf-example-seek"
                                                            title="跳转到视频此处播放"
                                                            onClick={() => onAction("wf-example-seek", example)}>
                                                        <time>{example.start}</time>
                                                        <span>
                                                            {example.parts.map((part, pIndex) => part.hit
                                                                ? <mark key={pIndex}>{part.text}</mark>
                                                                : <span key={pIndex}>{part.text}</span>)}
                                                        </span>
                                                    </button>
                                                ))}
                                            {row.examples.length > 5 && (
                                                <button type="button" className="ytbt-text-button" data-action="wf-examples-all"
                                                        onClick={() => onAction("wf-examples-all")}>
                                                    {wordfreq.examplesAll
                                                        ? "收起例句"
                                                        : `查看全部 ${row.examples.length} 句`}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {!wordfreq.rows.length && (
                    <p className="ytbt-list-empty">{wordfreq.empty}</p>
                )}
            </div>
            <footer className="ytbt-list-footer">
                <span className="ytbt-cue-count">{wordfreq.count} 个词条</span>
            </footer>
        </div>
    );
}

export function PlayerTools(props) {
    const {
        menuOpen, styleView, panelOpen, view, error, settings,
        transcript, wordfreq, phrase, onAction, onSetting, onSearch, onFollow, onSeek,
    } = props;
    return (
        <>
            <section id="ytbt-player-menu" className="ytbt-player-menu" role="dialog"
                     aria-label="AuraTranslate" hidden={!menuOpen}>
                <div className="ytbt-menu-main" hidden={styleView}>
                    <label className="ytbt-menu-row">
                        <Icon name="subtitles"/><span>视频字幕</span>
                        <input type="checkbox" role="switch" data-setting="subtitleEnabled"
                               aria-label="视频字幕" checked={Boolean(settings.subtitleEnabled)}
                               onChange={(event) => onSetting("subtitleEnabled", event.target.checked)}/>
                        <span className="ytbt-switch" aria-hidden="true"/>
                    </label>
                    <MenuRow icon="settings" action="style" trailing="›" onAction={onAction}>字幕样式</MenuRow>
                    {settings.pipEnabled !== false && (
                        <MenuRow icon="subtitles" action="pip-toggle" trailing={settings.pipOpen ? "●" : "›"}
                                 onAction={onAction}>
                            {settings.pipOpen ? "关闭画中画字幕" : "打开画中画字幕"}
                        </MenuRow>
                    )}
                    <MenuRow icon="list" action="transcript" onAction={onAction}>悬浮字幕列表</MenuRow>
                    {settings.wordFreqEnabled !== false && <MenuRow icon="book" action="wordfreq" onAction={onAction}>视频词频</MenuRow>}
                    {settings.phraseEnabled !== false && <MenuRow icon="list" action="phrase" onAction={onAction}>短语与俚语</MenuRow>}
                </div>
                {styleView && <StyleFields settings={settings} onSetting={onSetting} onAction={onAction}/>}
                <p className="ytbt-tools-error" role="status" hidden={!error}>{error}</p>
            </section>
            <section className="ytbt-tools-panel" role="dialog" aria-label="AuraTranslate 字幕列表"
                     hidden={!panelOpen}>
                <div className="ytbt-panel-tabs ytbt-panel-handle">
                    <button type="button" data-action="transcript"
                            aria-pressed={view === "transcript"}
                            onClick={() => onAction("transcript")}>字幕列表</button>
                    <button type="button" data-action="wordfreq"
                            aria-pressed={view === "wordfreq"}
                            hidden={wordfreq.disabled}
                            onClick={() => onAction("wordfreq")}>视频词频</button>
                    <button type="button" data-action="phrase"
                            aria-pressed={view === "phrase"}
                            hidden={phrase && phrase.disabled}
                            onClick={() => onAction("phrase")}>短语俚语</button>
                    <button type="button" className="ytbt-icon-button" data-action="close-panel"
                            title="关闭面板" aria-label="关闭面板"
                            onClick={() => onAction("close-panel")}><Icon name="close"/></button>
                </div>
                <TranscriptView transcript={transcript} view={view} onAction={onAction} onSearch={onSearch}
                                onFollow={onFollow} onSeek={onSeek}/>
                {wordfreq && <WordFreqView wordfreq={wordfreq} view={view} onAction={onAction}/>}
                {phrase && <PhraseView phrase={phrase} view={view} onAction={onAction}/>}
            </section>
        </>
    );
}
