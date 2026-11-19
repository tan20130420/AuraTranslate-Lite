import {SubtitlePreferences} from "./SubtitlePreferences";
import {DisabledSites} from "./DisabledSites";

// 精简版：只保留免 Key 的内置翻译源，不再要求用户配置 AI 服务与模型目录。
const FREE_PROVIDERS = [
    {value: "google-free", label: "Google 翻译（免费，无需 Key）"},
    {value: "bing-free", label: "Bing 翻译（免费，无需 Key）"},
];

export function TranslationSettings({settings, update, immersive = false, hidden}) {
    const key = immersive ? "immersiveTranslationService" : "subtitleTranslationProvider";
    const value = settings[key] || "google-free";
    const page = immersive ? "immersive-api" : "realtime-api";
    return (
        <section
            id={page}
            className="settings-section"
            role="tabpanel"
            aria-labelledby={`tab-${page}`}
            tabIndex={0}
            hidden={hidden}
        >
            <div className="section-heading">
                <p className="section-kicker">
                    {immersive ? "Webpage" : "YouTube / Google Drive"}
                </p>
                <h2>{immersive ? "沉浸式翻译" : "实时字幕"}</h2>
                <p>
                    {immersive
                        ? "在阅读的位置，呈现自然的双语对照。"
                        : "为 YouTube 和 Google Drive 视频显示双语字幕。"}
                </p>
            </div>
            <label className="field">
                <span>翻译源</span>
                <select
                    id={key}
                    value={value}
                    onChange={(event) => update({[key]: event.target.value})}
                >
                    {FREE_PROVIDERS.map((item) => (
                        <option key={item.value} value={item.value}>
                            {item.label}
                        </option>
                    ))}
                </select>
                <small>
                    内置免费接口，不需要 API Key。免费接口有频率限制，遇到限流可先切换到另一个源。
                </small>
            </label>
            {immersive ? (
                <DisabledSites settings={settings} update={update}/>
            ) : (
                <SubtitlePreferences settings={settings} update={update}/>
            )}
        </section>
    );
}
