import {Core} from "../shared/settings";

function ActionIcon({action}) {
    return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={action.path}/></svg>;
}

export function SelectionSettings({settings, update, hidden, navigate}) {
    const toolbar = Core.normalizeSelectionToolbar(settings.selectionToolbar);
    const patchToolbar = patch => update({selectionToolbar: {...toolbar, ...patch}});
    const selected = toolbar.actions.map(id => Core.SELECTION_TOOLBAR_ACTIONS.find(action => action.id === id));
    const ordered = [...selected, ...Core.SELECTION_TOOLBAR_ACTIONS.filter(action => !toolbar.actions.includes(action.id))];
    function move(id, direction) {
        const actions = [...toolbar.actions];
        const index = actions.indexOf(id), next = index + direction;
        if (index < 0 || next < 0 || next >= actions.length) return;
        [actions[index], actions[next]] = [actions[next], actions[index]];
        patchToolbar({actions});
    }
    return (
        <section id="selection-settings" className="settings-section" role="tabpanel"
                 aria-labelledby="tab-selection-settings" tabIndex={0} hidden={hidden}>
            <div className="section-heading">
                <p className="section-kicker">Selection</p>
                <h2>划词翻译</h2>
                <p>选中一个单词、短语或段落，在阅读的位置查看译文。</p>
            </div>
            <label className="toggle">
                <input id="selectionTranslationEnabled" type="checkbox"
                       checked={settings.selectionTranslationEnabled !== false}
                       onChange={(event) => update({selectionTranslationEnabled: event.target.checked})}/>
                <span>启用划词翻译<small>关闭后完全不处理网页上的选中文字。</small></span>
            </label>
            <label className="toggle">
                <input id="selectionAutoTranslate" type="checkbox"
                       checked={settings.selectionAutoTranslate !== false}
                       onChange={(event) => update({selectionAutoTranslate: event.target.checked})}/>
                <span>松开左键即翻译<small>拖选单词、短语或句子后松开鼠标，立即翻译整段；关闭后需点击工具栏翻译按钮。</small></span>
            </label>
            <label className="toggle">
                <input id="selectionSpeakEnabled" type="checkbox"
                       checked={settings.selectionSpeakEnabled !== false}
                       onChange={(event) => update({selectionSpeakEnabled: event.target.checked})}/>
                <span>选中即朗读<small>划词卡片出现时自动朗读选中的原文；点卡片上的喇叭可停止或重播。使用浏览器自带的语音。</small></span>
            </label>
            <label className="field">
                <span>朗读语速</span>
                <input id="selectionSpeakRate" type="range" min="0.7" max="1.2" step="0.1"
                       value={Number(settings.selectionSpeakRate) > 0 ? Number(settings.selectionSpeakRate) : 1}
                       onChange={(event) => update({selectionSpeakRate: Number(event.target.value)})}/>
                <small>0.7 倍较慢，1.2 倍较快；默认 1.0。</small>
            </label>
            <p className="section-note">
                沿用扩展弹出窗口中的网页翻译服务和语言设置。使用 AI 服务时，会结合所选文字附近的上下文判断含义。
                每次最多选择 3000 个字符。
            </p>
            <div className="selection-customization">
                <div className="selection-customization-heading">
                    <h3>自定义划词工具栏</h3>
                    <button type="button" className="link-button" id="selection-toolbar-reset"
                            onClick={() => update({selectionToolbar: Core.normalizeSelectionToolbar()})}>恢复默认</button>
                </div>
                <p className="section-note">选择需要的按钮，并调整显示顺序。修改会自动保存，已打开的网页同步生效。</p>
                <div className="selection-preview" data-position={toolbar.position}>
                    <span className="selection-preview-caption">实时预览</span>
                    <div className="selection-preview-content">
                        <p>Enjoy the <mark>little things</mark>.</p>
                        <div className="selection-toolbar" data-size={toolbar.size} data-labels={toolbar.showLabels}
                             role="img" aria-label={`工具栏预览：${selected.map(action => action.label).join("、")}`}>
                            {selected.map(action => <span key={action.id} className={`selection-tool${action.id === "translate" ? " selection-trigger" : ""}`}>
                                <ActionIcon action={action}/>{toolbar.showLabels && <span>{action.label}</span>}
                            </span>)}
                        </div>
                    </div>
                </div>
                <div className="grid selection-toolbar-fields">
                    <label className="field">
                        <span>工具栏尺寸</span>
                        <select id="selection-toolbar-size" value={toolbar.size}
                                onChange={event => patchToolbar({size: event.target.value})}>
                            <option value="compact">小巧 · 28px</option>
                            <option value="regular">标准 · 32px</option>
                            <option value="comfortable">宽松 · 40px</option>
                        </select>
                        <small>小巧适合鼠标，宽松更方便触屏点按。</small>
                    </label>
                    <label className="field">
                        <span>优先显示位置</span>
                        <select id="selection-toolbar-position" value={toolbar.position}
                                onChange={event => patchToolbar({position: event.target.value})}>
                            <option value="below">选区下方</option>
                            <option value="above">选区上方</option>
                        </select>
                        <small>靠近屏幕边缘时自动调整，避免遮挡。</small>
                    </label>
                </div>
                <label className="toggle">
                    <input id="selection-toolbar-labels" type="checkbox" checked={toolbar.showLabels}
                           onChange={event => patchToolbar({showLabels: event.target.checked})}/>
                    <span>显示按钮文字<small>关闭后仅显示图标，鼠标悬停可查看功能名称。</small></span>
                </label>
                <fieldset className="selection-action-settings">
                    <legend>工具栏按钮</legend>
                    <ol className="selection-action-list">
                        {ordered.map(action => {
                            const enabled = toolbar.actions.includes(action.id);
                            const index = toolbar.actions.indexOf(action.id);
                            return <li key={action.id} data-enabled={enabled}>
                                <label>
                                    <input id={`selection-action-${action.id}`} type="checkbox" checked={enabled}
                                           disabled={action.id === "translate"}
                                           onChange={event => patchToolbar({actions: event.target.checked
                                               ? [...toolbar.actions, action.id] : toolbar.actions.filter(id => id !== action.id)})}/>
                                    <ActionIcon action={action}/><span>{action.label}</span>
                                    {action.id === "translate" && <small>始终保留</small>}
                                </label>
                                <div className="selection-action-order">
                                    <button type="button" className="icon-button" aria-label={`上移${action.label}`}
                                            title={`上移${action.label}`} disabled={!enabled || index === 0}
                                            onClick={() => move(action.id, -1)}>↑</button>
                                    <button type="button" className="icon-button" aria-label={`下移${action.label}`}
                                            title={`下移${action.label}`} disabled={!enabled || index === toolbar.actions.length - 1}
                                            onClick={() => move(action.id, 1)}>↓</button>
                                </div>
                            </li>;
                        })}
                    </ol>
                </fieldset>
            </div>
            <ol className="selection-guide">
                <li>在网页上按住左键拖选单词、短语或句子，松开后立即翻译整段。</li>
                <li>卡片出现时会自动朗读选中的原文，点喇叭可停止或重播。</li>
                <li>译文卡片可“固定译文”，继续划选下一句，旧译文会保留在屏幕右上角。</li>
                <li>点击“收藏到生词本”，把这一整段原文、译文、上下文和来源存为一条。</li>
            </ol>
            <button type="button" className="secondary" onClick={() => navigate("vocabulary")}>打开生词本</button>
        </section>
    );
}
