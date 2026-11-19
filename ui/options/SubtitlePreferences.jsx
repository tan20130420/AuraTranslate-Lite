import {Core} from "../shared/settings";

export function SubtitlePreferences({settings, update}) {
    return (
        <>
            <h3 className="preference-heading">翻译与处理</h3>
            <div className="grid">
                <label className="field">
                    <span>字幕翻译范围</span>
                    <select
                        id="subtitleTranslationMode"
                        value={settings["subtitleTranslationMode"]}
                        onChange={(event) =>
                            update({["subtitleTranslationMode"]: event.target.value}, true)
                        }
                    >
                        <option value="economy">按需翻译（默认）</option>
                        <option value="full">翻译整部视频</option>
                    </select>
                    <small>
                        按需翻译只处理播放位置附近的字幕；整片模式优先处理附近，再继续翻译其余部分。切换模式复用已有缓存。
                    </small>
                </label>
                <label className="field">
                    <span>按需模式预翻译时长</span>
                    <select
                        id="subtitleLookAheadMinutes"
                        value={settings["subtitleLookAheadMinutes"]}
                        onChange={(event) =>
                            update({["subtitleLookAheadMinutes"]: event.target.value}, true)
                        }
                    >
                        <option value="1">未来 1 分钟</option>
                        <option value="2">未来 2 分钟（默认）</option>
                        <option value="3">未来 3 分钟</option>
                    </select>
                    <small>
                        随播放向前补充；跳转后调整待处理任务。已发出的请求仍会完成并缓存。
                    </small>
                </label>
            </div>

            <label className="toggle">
                <input
                    id="showOriginalTechnicalTerms"
                    type="checkbox"
                    checked={settings["showOriginalTechnicalTerms"] !== false}
                    onChange={(event) =>
                        update({["showOriginalTechnicalTerms"]: event.target.checked})
                    }
                />
                <span>
          保留专业术语原文<small>在译文中对照显示，例如“翻译 (Translation)”。</small>
        </span>
            </label>

            <h3 className="preference-heading">悬停交互</h3>
            <label className="toggle">
                <input
                    id="hoverPauseEnabled"
                    type="checkbox"
                    checked={settings["hoverPauseEnabled"] !== false}
                    onChange={(event) =>
                        update({["hoverPauseEnabled"]: event.target.checked})
                    }
                />
                <span>
          悬停暂停<small>鼠标停在字幕或右侧推荐视频列表上时暂停播放，移开后继续。</small>
        </span>
            </label>

            <label className="toggle">
                <input
                    id="hoverLookupEnabled"
                    type="checkbox"
                    checked={settings["hoverLookupEnabled"] !== false}
                    onChange={(event) =>
                        update({["hoverLookupEnabled"]: event.target.checked})
                    }
                />
                <span>
          悬停查词<small>鼠标停在字幕里的英文单词上时显示音标和释义，可直接收藏到生词本。</small>
        </span>
            </label>

            <h3 className="preference-heading">语言与显示</h3>
            <div className="grid">
                <label className="field">
                    <span>源语言</span>
                    <select
                        id="sourceLanguage"
                        value={settings["sourceLanguage"]}
                        onChange={(event) =>
                            update({["sourceLanguage"]: event.target.value}, true)
                        }
                    >
                        <option value="en">English</option>
                    </select>
                </label>

                <label className="field">
                    <span>目标语言</span>
                    <select
                        id="targetLanguage"
                        value={settings["targetLanguage"]}
                        onChange={(event) =>
                            update({["targetLanguage"]: event.target.value}, true)
                        }
                    >
                        <option value="zh-CN">简体中文</option>
                        <option value="zh-TW">繁体中文</option>
                    </select>
                </label>
            </div>

            <label className="field">
        <span>
          字幕大小{" "}
            <strong id="fontScaleValue">
            {Core.normalizeFontScale(settings.fontScale).toFixed(2)}x
          </strong>
        </span>
                <input
                    id="fontScale"
                    type="range"
                    min="0.3"
                    max="3"
                    step="0.05"
                    aria-describedby="fontScaleHint"
                    value={settings["fontScale"]}
                    onChange={(event) =>
                        update({["fontScale"]: event.target.value}, false)
                    }
                />
                <small id="fontScaleHint">
                    范围 0.30～3.00 倍，每次调整 0.05 倍。手机字幕偏大时可先试 0.50～0.65
                    倍，调整会自动保存。
                </small>
            </label>

            <label className="toggle">
                <input
                    id="subtitleEnabled"
                    type="checkbox"
                    checked={settings["subtitleEnabled"] !== false}
                    onChange={(event) =>
                        update({["subtitleEnabled"]: event.target.checked})
                    }
                />
                <span>显示双语字幕<small>使用插件字幕替换 YouTube / Google Drive 原生字幕。</small></span>
            </label>
        </>
    );
}
