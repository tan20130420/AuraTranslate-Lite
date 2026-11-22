export function PipSettings({settings, update, hidden, navigate}) {
    const scale = Math.max(0.6, Math.min(1.8, Number(settings.pipFontScale) || 1));
    const opacity = Math.max(0.3, Math.min(1, Number(settings.pipOpacity) || 0.82));
    return (
        <section id="pip-settings" className="settings-section" role="tabpanel"
                 aria-labelledby="tab-pip-settings" tabIndex={0} hidden={hidden}>
            <div className="section-heading">
                <p className="section-kicker">Picture-in-Picture</p>
                <h2>画中画字幕</h2>
                <p>把整段视频的字幕列表放进独立浮窗，可拖到第二块屏幕。支持搜索、点行跳转、当前行自动跟随，列表随视频实时更新。</p>
            </div>
            <label className="toggle">
                <input id="pipEnabled" type="checkbox"
                       checked={settings.pipEnabled !== false}
                       onChange={(event) => update({pipEnabled: event.target.checked})}/>
                <span>启用画中画字幕<small>关闭后，播放器菜单里不再显示画中画入口；已打开的窗口会在下次刷新页面后消失。</small></span>
            </label>
            <label className="toggle">
                <input id="pipShowHeader" type="checkbox"
                       checked={settings.pipShowHeader !== false}
                       onChange={(event) => update({pipShowHeader: event.target.checked})}/>
                <span>显示标题与进度<small>在浮窗顶部显示视频标题、播放时间和进度条。</small></span>
            </label>
            <label className="field">
                <span>字幕字号</span>
                <input id="pipFontScale" type="range" min="0.6" max="1.8" step="0.1" value={scale}
                       onChange={(event) => update({pipFontScale: Number(event.target.value)})}/>
                <small>当前 {scale.toFixed(1)}x。只影响画中画浮窗，不改变视频页面里的字幕。</small>
            </label>
            <label className="field">
                <span>背景不透明度</span>
                <input id="pipOpacity" type="range" min="0.3" max="1" step="0.05" value={opacity}
                       onChange={(event) => update({pipOpacity: Number(event.target.value)})}/>
                <small>当前 {Math.round(opacity * 100)}%。深色半透明背景便于叠加在其他窗口上。</small>
            </label>
            <p className="section-note">
                画中画窗口必须由点击触发，浏览器不支持自动弹出。需要 Chrome / Edge 桌面版 111 及以上版本。
                列表里的英文支持悬停取词、音标释义和自动英文朗读；拖选词组还能翻译并收藏到生词本。
                悬停字幕行会暂停视频，移开后自动恢复。
            </p>
            <ol className="selection-guide">
                <li>在 YouTube 播放器右侧点开 AuraTranslate 按钮，选择“打开画中画字幕”。</li>
                <li>把弹出的窗口拖到第二块屏幕，顶部搜索框可过滤字幕，点任意一行跳到对应画面。</li>
                <li>当前播放行会自动高亮并滚动到可见区域；取消勾选“跟随”可自由浏览。</li>
                <li>菜单里的“关闭画中画字幕”或直接关闭浮窗，都会停止同步。</li>
            </ol>
            <button type="button" className="secondary" onClick={() => navigate("realtime-api")}>返回实时字幕设置</button>
        </section>
    );
}
