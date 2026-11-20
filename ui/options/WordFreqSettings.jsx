export function WordFreqSettings({settings, update, hidden, navigate}) {
    const limit = Math.max(20, Math.min(500, Number(settings.wordFreqLimit) || 100));
    return (
        <section id="wordfreq-settings" className="settings-section" role="tabpanel"
                 aria-labelledby="tab-wordfreq-settings" tabIndex={0} hidden={hidden}>
            <div className="section-heading">
                <p className="section-kicker">Vocabulary</p>
                <h2>视频词频</h2>
                <p>统计当前视频字幕里出现的英文单词，按出现次数与通用词频排序，快速找到值得学的词。</p>
            </div>
            <label className="toggle">
                <input id="wordFreqEnabled" type="checkbox"
                       checked={settings.wordFreqEnabled !== false}
                       onChange={(event) => update({wordFreqEnabled: event.target.checked})}/>
                <span>启用视频词频<small>关闭后，播放器菜单里不再显示“视频词频”入口。</small></span>
            </label>
            <label className="field">
                <span>显示词条数量</span>
                <input id="wordFreqLimit" type="range" min="20" max="500" step="20" value={limit}
                       onChange={(event) => update({wordFreqLimit: Number(event.target.value)})}/>
                <small>当前 {limit} 个词条。词表在打开时一次性统计，不额外联网。</small>
            </label>
            <label className="toggle">
                <input id="wordFreqIncludeStopWords" type="checkbox"
                       checked={Boolean(settings.wordFreqIncludeStopWords)}
                       onChange={(event) => update({wordFreqIncludeStopWords: event.target.checked})}/>
                <span>包含常见虚词<small>默认隐藏 the、and、you 等功能词；开启后它们也会进入统计。</small></span>
            </label>
            <p className="section-note">
                词形会自动归并：running / runs / ran 都算作 run。颜色代表通用词频等级——
                基础 (前 1000) 通常是已掌握的高频词，少见词更适合重点学习。
                点词条可查看词典释义、朗读并收藏到生词本。
            </p>
            <ol className="selection-guide">
                <li>在 YouTube 播放器右侧点开 AuraTranslate 按钮，选择“视频词频”。</li>
                <li>词条按出现次数排序，次数相同则按通用词频由高到低排列。</li>
                <li>点词条展开释义，可朗读该词或收藏到生词本。</li>
            </ol>
            <button type="button" className="secondary" onClick={() => navigate("vocabulary")}>打开生词本</button>
        </section>
    );
}
