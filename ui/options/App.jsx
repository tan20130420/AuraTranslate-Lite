import {useEffect, useState} from "react";
import {useSettings} from "./useSettings";
import {TranslationSettings} from "./TranslationSettings";
import {GeneralSettings} from "./GeneralSettings";
import {SelectionSettings} from "./SelectionSettings";
import {WordFreqSettings} from "./WordFreqSettings";
import {PhraseLibrary} from "./PhraseLibrary";
import {Vocabulary} from "./Vocabulary";
import {Icon} from "../shared/Icon";

const PAGES = [
    ["realtime-api", "实时字幕", "视频双语字幕"],
    ["immersive-api", "沉浸式翻译", "网页翻译"],
    ["selection-settings", "划词翻译", "所选文字与上下文"],
    ["wordfreq-settings", "视频词频", "统计字幕里的高频词"],
    ["phrase-library", "我的词库", "管理短语、习语与俚语"],
    ["vocabulary", "生词本", "收藏、复习与学习状态"],
    ["general-settings", "通用设置", "外观与缓存"],
];
const currentPage = () =>
    PAGES.find(([id]) => id === location.hash.replace(/^#\/?/, ""))?.[0] ||
    PAGES[0][0];

export function OptionsApp() {
    const {settings, update, status, clearCache} = useSettings();
    const [page, setPage] = useState(currentPage);

    useEffect(() => {
        const follow = () => setPage(currentPage());
        window.addEventListener("hashchange", follow);
        window.addEventListener("popstate", follow);
        return () => {
            window.removeEventListener("hashchange", follow);
            window.removeEventListener("popstate", follow);
        };
    }, []);
    useEffect(() => {
        document.title = `${PAGES.find(([id]) => id === page)[1]} · AuraTranslate 设置`;
        const revealTab = () => {
            const nav = document.querySelector(".sidebar-nav");
            const tab = document.getElementById(`tab-${page}`);
            if (!nav || !tab || nav.scrollWidth <= nav.clientWidth) return;
            const bounds = nav.getBoundingClientRect(), selected = tab.getBoundingClientRect();
            const offset = selected.left < bounds.left ? selected.left - bounds.left - 8
                : selected.right > bounds.right ? selected.right - bounds.right + 8 : 0;
            if (offset) nav.scrollBy?.({left: offset});
        };
        revealTab();
        window.addEventListener("resize", revealTab);
        return () => window.removeEventListener("resize", revealTab);
    }, [page]);

    function navigate(id, focus = false) {
        setPage(id);
        if (location.hash !== `#${id}`) {
            try {
                history.pushState(null, "", `#${id}`);
            } catch {
            }
        }
        if (focus) document.getElementById(`tab-${id}`)?.focus();
        window.scrollTo({
            top: Math.max(
                0,
                (document.querySelector(".settings-layout")?.getBoundingClientRect()
                    .top || 0) +
                window.scrollY -
                20,
            ),
            behavior: "smooth",
        });
    }

    function navigateKey(event, index) {
        const next = {
            ArrowDown: index + 1,
            ArrowRight: index + 1,
            ArrowUp: index - 1,
            ArrowLeft: index - 1,
            Home: 0,
            End: PAGES.length - 1,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        navigate(PAGES[(next + PAGES.length) % PAGES.length][0], true);
    }

    const ICONS = ["subtitles", "webpage", "translate", "book", "plus", "book", "settings"];

    return (
        <main className="page">
            <h1 className="sr-only">AuraTranslate 设置</h1>
            <div className="settings-layout">
                <aside className="settings-sidebar">
                    <nav
                        className="sidebar-nav"
                        role="tablist"
                        aria-orientation="vertical"
                        aria-label="设置导航"
                    >
                        {PAGES.map(([id, label, desc], index) => (
                            <button
                                type="button"
                                id={`tab-${id}`}
                                key={id}
                                className="sidebar-link"
                                role="tab"
                                aria-controls={id}
                                aria-selected={page === id}
                                tabIndex={page === id ? 0 : -1}
                                onClick={() => navigate(id)}
                                onKeyDown={(event) => navigateKey(event, index)}
                            >
                                <Icon name={ICONS[index]}/>
                                <span className="sidebar-copy">
                  <span className="sidebar-title">{label}</span>
                  <span className="sidebar-desc">{desc}</span>
                </span>
                            </button>
                        ))}
                    </nav>
                </aside>
                <div className="settings-content">
                    <div id="settings-form" className="panel">
                        {settings && (
                            <>
                                <TranslationSettings
                                    settings={settings}
                                    update={update}
                                    hidden={page !== "realtime-api"}
                                    navigate={navigate}
                                />
                                <TranslationSettings
                                    settings={settings}
                                    update={update}
                                    immersive
                                    hidden={page !== "immersive-api"}
                                />
                                <SelectionSettings settings={settings} update={update}
                                                   hidden={page !== "selection-settings"} navigate={navigate}/>
                                <WordFreqSettings settings={settings} update={update}
                                                   hidden={page !== "wordfreq-settings"} navigate={navigate}/>
                                <PhraseLibrary settings={settings} update={update}
                                               hidden={page !== "phrase-library"} navigate={navigate}/>
                                <Vocabulary hidden={page !== "vocabulary"} navigate={navigate}/>
                                <GeneralSettings
                                    settings={settings}
                                    update={update}
                                    clearCache={clearCache}
                                    hidden={page !== "general-settings"}
                                />
                            </>
                        )}
                        <p id="status" className="status" role="status" data-error={/失败|无法/.test(status)}>
                            {status}
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
