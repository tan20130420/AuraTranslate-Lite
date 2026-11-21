// English phrase / idiom / collocation / slang library for subtitle learning.
// Browser: registers the library + matching engine on YTBTShared.
// Node: exports a factory so tests can register it onto a Shared object.
//
// Entry format: [phrase, type, meaningZh, tags, level]
//   type  : phrasal | idiom | collocation | slang
//   tags  : pipe-separated, from PHRASE_LIBRARY_TAGS
//   level : CEFR reference (A2 / B1 / B2 / C1)
// Curation: kept only high-frequency items useful for IELTS and everyday
// American conversation; deliberately excluded obscure/dated expressions.
(function registerSharedModule(root, register) {
    if (typeof module !== "undefined" && module.exports) module.exports = register;
    else register(root.YTBTShared || (root.YTBTShared = {}));
})(globalThis, function (Shared) {
    "use strict";

    const ENTRIES = [
        // ---------------- Phrasal verbs (1) ----------------
        ["figure out", "phrasal", "弄清楚；想出", "ielts|daily", "B1"],
        ["look up", "phrasal", "查阅；向上看", "daily|academic", "A2"],
        ["look after", "phrasal", "照顾；照看", "daily", "A2"],
        ["look into", "phrasal", "调查；研究", "ielts|work", "B1"],
        ["look forward to", "phrasal", "期待；盼望", "ielts|daily", "B1"],
        ["look down on", "phrasal", "看不起；轻视", "daily", "B2"],
        ["look up to", "phrasal", "敬仰；仰慕", "daily", "B2"],
        ["look back on", "phrasal", "回顾；回忆", "ielts|speaking", "B2"],
        ["look out for", "phrasal", "留意；提防；关照", "daily", "B1"],
        ["look over", "phrasal", "检查；浏览", "work|daily", "B1"],
        ["look through", "phrasal", "浏览；看穿", "daily", "B1"],
        ["look out", "phrasal", "小心；当心；向外看", "daily", "A2"],
        ["find out", "phrasal", "查明；发现", "daily", "A2"],
        ["give up", "phrasal", "放弃；戒掉", "daily", "A2"],
        ["give in", "phrasal", "屈服；让步；交上", "daily", "B1"],
        ["give out", "phrasal", "分发；耗尽；公布", "daily", "B1"],
        ["give away", "phrasal", "赠送；泄露；暴露", "daily", "B1"],
        ["give back", "phrasal", "归还；恢复", "daily", "A2"],
        ["get up", "phrasal", "起床；起身", "daily", "A2"],
        ["get over", "phrasal", "克服；恢复；越过", "daily|ielts", "B1"],
        ["get along with", "phrasal", "与…相处融洽", "daily", "B1"],
        ["get on with", "phrasal", "与…相处；继续进行", "daily", "B1"],
        ["get off", "phrasal", "下车；离开；下班", "daily", "A2"],
        ["get on", "phrasal", "上车；进展；相处", "daily", "A2"],
        ["get in", "phrasal", "进入；到达；当选", "daily", "A2"],
        ["get into", "phrasal", "进入；陷入；开始从事", "daily", "B1"],
        ["get out of", "phrasal", "逃离；摆脱；退出", "daily", "B1"],
        ["get through", "phrasal", "完成；接通电话；熬过", "daily|work", "B1"],
        ["get by", "phrasal", "勉强应付；过得去", "daily", "B1"],
        ["get back", "phrasal", "返回；取回；报复", "daily", "A2"],
        ["get together", "phrasal", "相聚；收集；达成一致", "daily", "B1"],
        ["get rid of", "phrasal", "摆脱；去除", "ielts|daily", "B1"],
        ["get used to", "phrasal", "习惯于", "ielts|daily", "B1"],
        ["get down to", "phrasal", "开始认真做；着手处理", "ielts|work", "B2"],
        ["get away with", "phrasal", "侥幸逃脱；做…不受惩罚", "daily", "B2"],
        ["get ahead", "phrasal", "取得进展；出人头地", "work|daily", "B1"],
        ["get across", "phrasal", "把…表达清楚", "ielts|speaking", "B2"],
        ["get around", "phrasal", "四处走动；规避；传开", "daily", "B1"],
        ["take off", "phrasal", "起飞；脱下；突然成功", "daily|travel", "A2"],
        ["take on", "phrasal", "承担；呈现；雇用", "work|ielts", "B1"],
        ["take up", "phrasal", "开始从事；占据（时间/空间）", "ielts|daily", "B1"],
        ["take in", "phrasal", "吸收；理解；欺骗；收留", "daily", "B1"],
        ["take over", "phrasal", "接管；接手", "work|daily", "B1"],
        ["take back", "phrasal", "收回；退回；使想起", "daily", "B1"],
        ["take after", "phrasal", "长得像；效仿（长辈）", "daily", "B1"],
        ["take apart", "phrasal", "拆开；剖析", "daily", "B2"],
        ["take out", "phrasal", "带…出去；取出；办理", "daily", "A2"],
        ["take place", "phrasal", "发生；举行", "ielts|academic", "B1"],
        ["take part in", "phrasal", "参加；参与", "ielts|daily", "B1"],
        ["take care of", "phrasal", "照顾；处理", "daily", "A2"],
        ["turn on", "phrasal", "打开（设备）；攻击", "daily", "A2"],
        ["turn off", "phrasal", "关掉；使厌烦", "daily", "A2"],
        ["turn up", "phrasal", "出现；调大；发现", "daily", "B1"],
        ["turn down", "phrasal", "拒绝；调小；翻下", "daily", "B1"],
        ["turn out", "phrasal", "结果是；生产；出席", "ielts|daily", "B1"],
        ["turn into", "phrasal", "变成；转变为", "daily", "B1"],
        ["turn around", "phrasal", "转身；好转；转变", "daily|work", "B1"],
        ["turn back", "phrasal", "折返；倒退；翻转", "daily", "B1"],
        ["turn away", "phrasal", "转身离开；拒绝进入", "daily", "B2"],
        ["put off", "phrasal", "推迟；使反感；劝阻", "ielts|daily", "B1"],
        ["put on", "phrasal", "穿上；上演；增加（体重）", "daily", "A2"],
        ["put out", "phrasal", "熄灭；发布；使不便", "daily", "B1"],
        ["put up with", "phrasal", "忍受；容忍", "ielts|daily", "B2"],
        ["put up", "phrasal", "张贴；搭建；提供住宿；提高", "daily", "B1"],
        ["put down", "phrasal", "放下；写下；贬低；镇压", "daily", "B1"],
        ["put forward", "phrasal", "提出（建议/理论）", "ielts|academic", "B2"],
        ["put away", "phrasal", "收起来；存（钱）", "daily", "A2"],
        ["put in", "phrasal", "投入；提交；安装", "work|daily", "B1"],
        ["make up", "phrasal", "编造；化妆；和解；组成", "daily", "B1"],
        ["make out", "phrasal", "辨认出；理解；写出", "daily", "B2"],
        ["make up for", "phrasal", "弥补；补偿", "ielts|daily", "B2"],
        ["make sense", "phrasal", "说得通；有道理", "ielts|daily", "B1"],
        ["make a difference", "phrasal", "有影响；起作用", "ielts|speaking", "B1"],
        ["break down", "phrasal", "出故障；崩溃；分解", "daily|work", "B1"],
        ["break up", "phrasal", "分手；解散；打碎", "daily", "B1"],
        ["break out", "phrasal", "爆发（战争/火灾）", "ielts|daily", "B1"],
        ["break in", "phrasal", "闯入；打断；磨合", "daily", "B1"],
        ["break into", "phrasal", "闯入；突然开始（笑/唱）", "daily", "B2"],
        ["break off", "phrasal", "中断；断绝", "daily", "B2"],
        ["break through", "phrasal", "突破；冲破", "ielts|work", "B2"],
        ["bring up", "phrasal", "提出；抚养；呕吐", "daily", "B1"],
        ["bring about", "phrasal", "导致；引起", "ielts|academic", "B2"],
        ["bring back", "phrasal", "带回；使想起；恢复", "daily", "B1"],
        ["bring in", "phrasal", "引进；赚得；请来", "work|ielts", "B1"],
        ["bring out", "phrasal", "推出；使显现；出版", "ielts|daily", "B2"],
        ["come up with", "phrasal", "想出；提出（想法）", "ielts|work", "B2"],
        ["come up", "phrasal", "出现；发生；被提及", "daily", "B1"],
        ["come across", "phrasal", "偶遇；给人…印象；被理解", "daily", "B1"],
        ["come back", "phrasal", "回来；恢复；重新流行", "daily", "A2"],
        ["come down with", "phrasal", "染上（疾病）", "daily", "B2"],
        ["come out", "phrasal", "出版；结果是；公开；出来", "daily", "B1"],
        ["come over", "phrasal", "顺便来访；突然感到", "daily", "B1"],
        ["come through", "phrasal", "度过；传来；成功", "daily", "B2"],
        ["come to", "phrasal", "达到；苏醒；总计；涉及", "ielts|daily", "B1"],
        ["come true", "phrasal", "实现；成真", "daily", "B1"],
        ["come in handy", "phrasal", "派上用场", "daily", "B2"],
        ["run into", "phrasal", "偶遇；撞上；陷入（麻烦）", "daily", "B1"],
        ["run out of", "phrasal", "用完；耗尽", "ielts|daily", "B1"],
        ["run over", "phrasal", "碾过；溢出；超过；复习", "daily", "B2"],
        ["run away", "phrasal", "逃跑；私奔", "daily", "A2"],
        ["run through", "phrasal", "贯穿；排练；快速处理", "daily", "B2"],
        ["set up", "phrasal", "建立；设置；安排", "work|daily", "B1"],
        ["set off", "phrasal", "出发；引爆；引起；抵消", "daily|travel", "B1"],
        ["set out", "phrasal", "出发；着手；陈述", "ielts|academic", "B2"],
        ["set aside", "phrasal", "留出；搁置；不理会", "ielts|work", "B2"],
        ["set down", "phrasal", "写下；放下；规定", "ielts|academic", "B2"],
        ["settle down", "phrasal", "定居；平静下来；专心", "daily", "B1"],
        ["show up", "phrasal", "出现；露面；使显眼", "daily", "B1"],
        ["show off", "phrasal", "炫耀；卖弄", "daily|informal", "B1"],
        ["call off", "phrasal", "取消；停止", "work|daily", "B1"],
        ["call on", "phrasal", "拜访；号召；要求", "ielts|work", "B2"],
        ["call out", "phrasal", "大声喊；召集；点名批评", "daily", "B2"],
        ["carry on", "phrasal", "继续；进行；相处", "daily", "B1"],
        ["carry out", "phrasal", "执行；实施；完成", "ielts|academic", "B2"],
        ["catch up with", "phrasal", "赶上；跟上；叙旧", "daily", "B1"],
        ["catch on", "phrasal", "流行起来；理解", "daily", "B2"],
        ["check in", "phrasal", "登记入住；报到；托运", "travel|daily", "A2"],
        ["check out", "phrasal", "结账离开；查看；试一试", "travel|daily", "A2"],
        ["check up on", "phrasal", "检查；核实；了解近况", "daily", "B1"],
        ["clear up", "phrasal", "清理；澄清；放晴", "daily", "B1"],
        ["count on", "phrasal", "依靠；指望", "ielts|daily", "B1"],
        ["cut down on", "phrasal", "减少；削减（数量）", "ielts|daily", "B1"],
        ["cut off", "phrasal", "切断；中断；隔绝", "daily", "B1"],
        ["cut out", "phrasal", "删除；停止做；剪下", "daily", "B1"],
        ["deal with", "phrasal", "处理；对付；与…打交道", "ielts|work", "B1"],
        ["depend on", "phrasal", "取决于；依靠", "ielts|daily", "A2"],
        ["drop out", "phrasal", "退学；退出；脱落", "ielts|daily", "B1"],
        ["drop by", "phrasal", "顺便拜访", "daily", "B1"],
        ["drop off", "phrasal", "减少；下车；送去；睡着", "daily", "B1"],
        ["end up", "phrasal", "最终成为；以…告终", "ielts|daily", "B1"],
        ["fall apart", "phrasal", "崩溃；散架；破裂", "daily", "B1"],
        ["fall behind", "phrasal", "落后；拖欠", "ielts|work", "B2"],
        ["fall for", "phrasal", "爱上；上当受骗", "daily", "B2"],
        ["fill in", "phrasal", "填写；代替；告知", "work|daily", "B1"],
        ["fill out", "phrasal", "填写（表格）；长胖", "daily", "B1"],
        ["focus on", "phrasal", "专注于；集中于", "ielts|academic", "B1"],
        ["go through", "phrasal", "经历；仔细检查；通过；用完", "ielts|daily", "B1"],
        ["go over", "phrasal", "复习；检查；越过", "ielts|daily", "B1"],
        ["go ahead", "phrasal", "继续；请便；着手", "daily", "B1"],
        ["go along with", "phrasal", "同意；陪同；遵循", "daily", "B2"],
        ["go back on", "phrasal", "违背（诺言）；背叛", "daily", "B2"],
        ["go by", "phrasal", "经过；遵循；以…为准", "daily", "B1"],
        ["go down", "phrasal", "下降；下沉；被接受；倒车", "daily", "B1"],
        ["go in for", "phrasal", "参加；从事；喜欢", "daily", "B2"],
        ["go off", "phrasal", "离开；爆炸；响起；变质", "daily", "B1"],
        ["go on", "phrasal", "继续；发生；进行；依据", "daily", "A2"],
        ["go out", "phrasal", "出去；熄灭；约会；公布", "daily", "A2"],
        ["go up", "phrasal", "上升；上涨；建造；爆炸", "ielts|daily", "B1"],
        ["grow up", "phrasal", "长大；成长；成熟", "daily", "A2"],
        ["grow out of", "phrasal", "长大而不再；由…产生", "daily", "B2"],
        ["hand in", "phrasal", "上交；提交", "work|daily", "A2"],
        ["hand out", "phrasal", "分发；发放", "work|daily", "B1"],
        ["hand over", "phrasal", "移交；交出", "work", "B2"],
        ["hang out", "phrasal", "闲逛；常去；共处", "daily|informal", "B1"],
        ["hang on", "phrasal", "坚持；等一下；抓紧", "daily", "B1"],
        ["hang up", "phrasal", "挂断电话；挂起", "daily", "B1"],
        ["hold on", "phrasal", "坚持；等一下；抓住", "daily", "B1"],
        ["hold up", "phrasal", "举起；支撑；延误；抢劫", "daily", "B2"],
        ["hold back", "phrasal", "阻止；隐瞒；退缩", "ielts|daily", "B2"],
        ["keep up with", "phrasal", "跟上；了解；保持联系", "ielts|daily", "B1"],
        ["keep on", "phrasal", "继续；坚持", "daily", "B1"],
        ["keep away from", "phrasal", "远离；避开", "daily", "B1"],
        ["keep off", "phrasal", "避开；不接近；禁止", "daily", "B1"],
        ["keep to", "phrasal", "遵守；坚持；局限于", "ielts|work", "B2"],
        ["kick off", "phrasal", "开始；开球；启动", "work|daily", "B2"],
        ["knock out", "phrasal", "淘汰；击倒；使惊叹", "daily", "B2"],
        ["leave out", "phrasal", "遗漏；排除；不提及", "ielts|work", "B2"],
        ["let down", "phrasal", "使失望；放下；降低", "daily", "B1"],
        ["let off", "phrasal", "放过；宽恕；排放", "daily", "B2"],
        ["let out", "phrasal", "放出；发出；泄露；放大", "daily", "B1"],
        ["lie down", "phrasal", "躺下", "daily", "A2"],
        ["live up to", "phrasal", "达到；符合；不辜负", "ielts|work", "B2"],
        ["live on", "phrasal", "以…为生；继续存在", "ielts|daily", "B2"],
        ["mix up", "phrasal", "混淆；弄混；搞错", "daily", "B1"],
        ["move on", "phrasal", "继续前进；换个话题", "daily", "B1"],
        ["pass away", "phrasal", "去世；消失", "daily", "B1"],
        ["pass by", "phrasal", "经过；忽略；逝去", "daily", "B1"],
        ["pay back", "phrasal", "偿还；报复", "daily", "B1"],
        ["pay for", "phrasal", "付款；为…付出代价", "daily", "A2"],
        ["pay off", "phrasal", "还清；取得成功；值得", "work|daily", "B2"],
        ["pick out", "phrasal", "挑选出；辨认出", "daily", "B1"],
        ["pick up", "phrasal", "捡起；接载；学会；好转；收拾", "daily", "B1"],
        ["point out", "phrasal", "指出；指明", "ielts|work", "B1"],
        ["pull out", "phrasal", "拔出；退出；驶离", "daily|travel", "B1"],
        ["pull through", "phrasal", "渡过难关；恢复健康", "daily", "B2"],
        ["refer to", "phrasal", "提到；指的是；参考", "ielts|academic", "B2"],
        ["relate to", "phrasal", "涉及；与…有关；理解认同", "ielts|daily", "B2"],
        ["rely on", "phrasal", "依靠；依赖", "ielts|academic", "B1"],
        ["result in", "phrasal", "导致；造成", "ielts|academic", "B2"],
        ["result from", "phrasal", "由…产生；起因于", "ielts|academic", "B2"],
        ["save up", "phrasal", "攒钱；储存", "daily", "B1"],
        ["see through", "phrasal", "看穿；识破；坚持到底", "daily", "B2"],
        ["see to", "phrasal", "处理；照看；负责", "work|daily", "B2"],
        ["set in", "phrasal", "开始；到来；定住", "ielts|academic", "B2"],
        ["slow down", "phrasal", "放慢；减速；减速行驶", "daily|travel", "A2"],
        ["speak up", "phrasal", "大声说；坦率表态", "ielts|speaking", "B2"],
        ["speed up", "phrasal", "加速；加快", "ielts|daily", "B1"],
        ["stand out", "phrasal", "突出；显眼；脱颖而出", "ielts|work", "B2"],
        ["stand up for", "phrasal", "支持；维护；为…辩护", "ielts|speaking", "B2"],
        ["stand by", "phrasal", "支持；待命；旁观", "work|daily", "B2"],
        ["start off", "phrasal", "开始；出发；以…开始", "daily", "B1"],
        ["stay up", "phrasal", "熬夜；不睡觉", "daily", "B1"],
        ["stick to", "phrasal", "坚持；遵守；粘住", "ielts|daily", "B1"],
        ["stop by", "phrasal", "顺便拜访；短暂停留", "daily", "B1"],
        ["switch off", "phrasal", "关掉；使失去兴趣", "daily", "A2"],
        ["switch on", "phrasal", "打开；使兴奋", "daily", "A2"],
        ["talk over", "phrasal", "商量；讨论；说服", "work|daily", "B1"],
        ["tear down", "phrasal", "拆除；撕毁；诋毁", "work|daily", "B2"],
        ["tell off", "phrasal", "训斥；责备", "daily", "B2"],
        ["think of", "phrasal", "想起；认为；考虑", "daily", "A2"],
        ["think over", "phrasal", "仔细考虑；权衡", "ielts|work", "B1"],
        ["throw away", "phrasal", "扔掉；浪费；错过", "daily", "B1"],
        ["try on", "phrasal", "试穿；试用", "daily", "A2"],
        ["try out", "phrasal", "试用；试验；参加选拔", "daily", "B1"],
        ["wake up", "phrasal", "醒来；唤醒；意识到", "daily", "A2"],
        ["warm up", "phrasal", "热身；变暖；活跃起来", "daily", "B1"],
        ["watch out", "phrasal", "小心；留意；当心", "daily", "B1"],
        ["wear out", "phrasal", "穿破；使疲惫；耗尽", "daily", "B2"],
        ["work out", "phrasal", "锻炼；解决；计算出；结果是", "daily|work", "B1"],
        ["work on", "phrasal", "从事于；致力于；作用于", "work|ielts", "B1"],
        ["write down", "phrasal", "写下；记下", "daily", "A2"],
        ["write up", "phrasal", "详细写出；报道；记录", "work|academic", "B2"],

        // ---------------- Idioms ----------------
        ["break the ice", "idiom", "打破僵局；缓和气氛", "ielts|speaking|daily", "B1"],
        ["a blessing in disguise", "idiom", "塞翁失马；因祸得福", "ielts|speaking", "B2"],
        ["hit the nail on the head", "idiom", "一针见血；说中要害", "ielts|speaking|work", "B2"],
        ["piece of cake", "idiom", "小菜一碟；轻而易举", "daily|informal", "B1"],
        ["under the weather", "idiom", "身体不适；有点病", "daily|informal", "B1"],
        ["call it a day", "idiom", "到此为止；收工", "work|daily", "B1"],
        ["over the moon", "idiom", "欣喜若狂；非常高兴", "ielts|speaking|daily", "B2"],
        ["once in a blue moon", "idiom", "千载难逢；极少", "ielts|speaking", "B2"],
        ["cost an arm and a leg", "idiom", "非常昂贵；要价过高", "ielts|speaking|daily", "B2"],
        ["on the same page", "idiom", "意见一致；达成共识", "work|daily", "B1"],
        ["the ball is in your court", "idiom", "轮到你做决定/行动了", "work|daily", "B2"],
        ["hit the ground running", "idiom", "一开始就干劲十足；迅速上手", "work|ielts", "B2"],
        ["back to square one", "idiom", "回到原点；重新开始", "work|daily", "B2"],
        ["get the ball rolling", "idiom", "开始做某事；让事情启动起来", "work|daily", "B2"],
        ["in the weeds", "idiom", "忙得不可开交；陷入细节", "work|informal", "C1"],
        ["cut to the chase", "idiom", "直奔主题；言归正传", "work|informal", "B2"],
        ["a piece of the action", "idiom", "一份好处；参与其中", "work|informal", "B2"],
        ["better late than never", "idiom", "迟做总比不做好", "ielts|speaking|daily", "B1"],
        ["bite the bullet", "idiom", "咬紧牙关；硬着头皮做", "ielts|speaking|work", "B2"],
        ["burn the midnight oil", "idiom", "开夜车；挑灯夜战", "ielts|speaking", "B2"],
        ["by the book", "idiom", "照章办事；按规矩来", "work|daily", "B2"],
        ["can't complain", "idiom", "还不错；没什么可抱怨的", "daily|informal", "B1"],
        ["no big deal", "idiom", "没什么大不了", "daily|informal", "B1"],
        ["not my cup of tea", "idiom", "不是我的菜；我不喜欢", "ielts|speaking|daily", "B2"],
        ["off the top of my head", "idiom", "凭记忆；不假思索", "work|daily", "B2"],
        ["on the same wavelength", "idiom", "想法一致；心有灵犀", "ielts|speaking|work", "B2"],
        ["hit it off", "idiom", "一见如故；相处融洽", "daily|informal", "B2"],
        ["go way back", "idiom", "认识很久；有交情", "daily|informal", "B2"],
        ["have someone's back", "idiom", "支持某人；为某人撑腰", "daily|informal", "B2"],
        ["break the bank", "idiom", "耗尽财力；花一大笔钱", "work|daily", "B2"],
        ["learn the ropes", "idiom", "学会门道；熟悉情况", "work|daily", "B2"],
        ["know the ropes", "idiom", "懂行；熟悉内情", "work|daily", "B2"],
        ["pull someone's leg", "idiom", "跟某人开玩笑；逗弄", "daily|informal", "B2"],
        ["a double-edged sword", "idiom", "双刃剑；有利有弊", "ielts|writing|academic", "C1"],
        ["a mixed blessing", "idiom", "好坏参半的事", "ielts|speaking|writing", "C1"],
        ["the last straw", "idiom", "最后一根稻草；忍无可忍", "ielts|speaking|daily", "B2"],
        ["out of the blue", "idiom", "出乎意料；突然", "ielts|speaking|daily", "B2"],
        ["out of the question", "idiom", "不可能；不予考虑", "ielts|writing", "B2"],
        ["up in the air", "idiom", "悬而未决；不确定", "ielts|speaking|work", "B2"],
        ["in the pipeline", "idiom", "在进行中；即将发生", "work|ielts", "B2"],
        ["on the right track", "idiom", "走上正轨；方向正确", "ielts|work", "B1"],
        ["off track", "idiom", "偏离正轨；跑题", "ielts|work", "B2"],
        ["a far cry from", "idiom", "与…大不相同；相差甚远", "ielts|writing", "C1"],
        ["a shot in the dark", "idiom", "瞎猜；碰碰运气", "daily|informal", "B2"],
        ["ring a bell", "idiom", "听起来耳熟；唤起记忆", "daily|informal", "B2"],
        ["strike a chord", "idiom", "引起共鸣；打动人心", "ielts|speaking", "C1"],
        ["a tough nut to crack", "idiom", "难对付的人；棘手的事", "ielts|speaking", "C1"],
        ["a hard pill to swallow", "idiom", "难以接受的事实", "ielts|speaking", "C1"],
        ["speak of the devil", "idiom", "说曹操曹操到", "daily|informal", "B2"],
        ["the tip of the iceberg", "idiom", "冰山一角", "ielts|writing|speaking", "C1"],
        ["at the end of the day", "idiom", "归根结底；最终", "ielts|speaking|work", "B1"],
        ["in a nutshell", "idiom", "简而言之；概括地说", "ielts|speaking|writing", "B2"],
        ["a double take", "idiom", "再看一眼；惊讶地回头看", "daily|informal", "C1"],
        ["luck out", "idiom", "走运；侥幸成功", "daily|informal", "B2"],
        ["no-brainer", "idiom", "无需动脑的事；显而易见", "work|informal", "B2"],
        ["a no-go", "idiom", "行不通；不赞成", "work|informal", "B2"],
        ["green light", "idiom", "批准；放行", "work|daily", "B2"],
        ["red tape", "idiom", "繁文缛节；官僚手续", "ielts|writing|work", "C1"],
        ["in the same boat", "idiom", "处境相同；同舟共济", "daily", "B2"],
        ["in hot water", "idiom", "陷入麻烦；处境困难", "daily|informal", "B2"],
        ["under the table", "idiom", "秘密地；私下（交易）", "work|informal", "B2"],
        ["a level playing field", "idiom", "公平竞争的环境", "ielts|writing|academic", "C1"],
        ["the writing on the wall", "idiom", "不祥之兆；危机信号", "ielts|writing", "C1"],
        ["turn a blind eye", "idiom", "视而不见；装作没看见", "ielts|speaking|writing", "B2"],
        ["turn a deaf ear", "idiom", "充耳不闻", "ielts|writing", "C1"],
        ["pay lip service", "idiom", "口惠而实不至；敷衍", "ielts|writing|academic", "C1"],
        ["spill the beans", "idiom", "泄露秘密；说漏嘴", "daily|informal", "B2"],
        ["let the cat out of the bag", "idiom", "泄露秘密；露馅", "daily|informal", "B2"],
        ["hit the sack", "idiom", "上床睡觉", "daily|informal", "B1"],
        ["burn out", "idiom", "精疲力竭；倦怠", "work|daily", "B2"],
        ["on the ball", "idiom", "机灵；能干；反应快", "work|informal", "B2"],
        ["drop the ball", "idiom", "犯错；失职；搞砸", "work|informal", "B2"],
        ["a piece of cake", "idiom", "轻而易举的事", "daily|informal", "B1"],
        ["fall on deaf ears", "idiom", "被置若罔闻；没人听", "ielts|writing", "C1"],
        ["give someone the benefit of the doubt", "idiom", "姑且相信；无罪推定", "ielts|speaking|work", "C1"],
        ["a case in point", "idiom", "恰当的例子；典型例证", "ielts|writing|academic", "C1"],
        ["in the long run", "idiom", "从长远来看", "ielts|writing|speaking", "B2"],
        ["in the short term", "idiom", "从短期来看", "ielts|writing|academic", "B2"],
        ["for better or worse", "idiom", "不管好坏；无论如何", "ielts|speaking", "B2"],
        ["take something with a grain of salt", "idiom", "对某事半信半疑", "ielts|speaking", "C1"],
        ["a mixed bag", "idiom", "好坏混杂；参差不齐", "ielts|writing|speaking", "C1"],
        ["the elephant in the room", "idiom", "显而易见却回避的问题", "ielts|speaking|work", "C1"],
        ["a change of pace", "idiom", "节奏的改变；换换环境", "daily", "B2"],
        ["call it even", "idiom", "两清了；扯平", "daily|informal", "B2"],
        ["cut corners", "idiom", "走捷径；偷工减料", "ielts|writing|work", "C1"],
        ["go the extra mile", "idiom", "付出额外努力；加倍用心", "ielts|speaking|work", "B2"],
        ["keep an eye on", "idiom", "留意；照看", "daily|work", "B1"],
        ["keep your chin up", "idiom", "振作起来；别灰心", "daily|informal", "B2"],
        ["on the money", "idiom", "完全正确；恰到好处", "work|informal", "B2"],
        ["par for the course", "idiom", "意料之中；正常现象", "work|informal", "C1"],
        ["the whole nine yards", "idiom", "全部；一切；不遗余力", "daily|informal", "C1"],
        ["a far stretch", "idiom", "牵强；夸大其词", "ielts|speaking", "C1"],

        // ---------------- Collocations ----------------
        ["play a vital role", "collocation", "发挥至关重要的作用", "ielts|writing|academic", "B2"],
        ["play a key role", "collocation", "发挥关键作用", "ielts|writing|academic", "B2"],
        ["play a crucial role", "collocation", "发挥关键作用", "ielts|writing|academic", "B2"],
        ["have a significant impact", "collocation", "有重大影响", "ielts|writing|academic", "B2"],
        ["have a profound effect", "collocation", "有深远影响", "ielts|writing|academic", "C1"],
        ["make a significant contribution", "collocation", "做出重大贡献", "ielts|writing", "B2"],
        ["pose a threat to", "collocation", "对…构成威胁", "ielts|writing|academic", "B2"],
        ["raise public awareness", "collocation", "提高公众意识", "ielts|writing", "B2"],
        ["address the root cause", "collocation", "解决根本原因", "ielts|writing", "C1"],
        ["tackle the problem", "collocation", "应对/解决问题", "ielts|writing", "B2"],
        ["take effective measures", "collocation", "采取有效措施", "ielts|writing", "B2"],
        ["implement policies", "collocation", "实施政策", "ielts|writing|academic", "B2"],
        ["introduce legislation", "collocation", "引入立法", "ielts|writing|academic", "C1"],
        ["provide financial support", "collocation", "提供经济支持", "ielts|writing", "B2"],
        ["invest in infrastructure", "collocation", "投资基础设施", "ielts|writing", "B2"],
        ["improve public services", "collocation", "改善公共服务", "ielts|writing", "B2"],
        ["bridge the gap", "collocation", "缩小差距；弥合鸿沟", "ielts|writing|speaking", "B2"],
        ["narrow the gap", "collocation", "缩小差距", "ielts|writing|academic", "B2"],
        ["keep pace with", "collocation", "跟上…的步伐", "ielts|writing", "B2"],
        ["strike a balance", "collocation", "取得平衡；权衡", "ielts|writing|speaking", "B2"],
        ["strike the right balance", "collocation", "取得恰当的平衡", "ielts|writing", "C1"],
        ["a growing concern", "collocation", "日益关注的问题", "ielts|writing", "B2"],
        ["a key factor", "collocation", "关键因素", "ielts|writing|academic", "B1"],
        ["a major cause", "collocation", "主要原因", "ielts|writing|academic", "B1"],
        ["significant benefits", "collocation", "显著的好处", "ielts|writing", "B2"],
        ["negative consequences", "collocation", "负面后果", "ielts|writing", "B2"],
        ["unintended consequences", "collocation", "意料之外的后果", "ielts|writing|academic", "C1"],
        ["a wide range of", "collocation", "广泛的；各种各样的", "ielts|writing|speaking", "B1"],
        ["a variety of", "collocation", "多种多样的", "ielts|writing|speaking", "B1"],
        ["a growing number of", "collocation", "越来越多的", "ielts|writing", "B2"],
        ["an increasing number of", "collocation", "越来越多的", "ielts|writing", "B2"],
        ["the majority of", "collocation", "大多数的", "ielts|writing|academic", "B1"],
        ["a minority of", "collocation", "少数的", "ielts|writing|academic", "B2"],
        ["be attributed to", "collocation", "归因于", "ielts|writing|academic", "C1"],
        ["be responsible for", "collocation", "对…负责；是…的原因", "ielts|writing", "B1"],
        ["be linked to", "collocation", "与…有关联", "ielts|writing|academic", "B2"],
        ["be associated with", "collocation", "与…相关", "ielts|writing|academic", "B2"],
        ["contribute to", "collocation", "有助于；促成", "ielts|writing|academic", "B2"],
        ["lead to", "collocation", "导致；带来", "ielts|writing|speaking", "B1"],
        ["give rise to", "collocation", "引起；导致", "ielts|writing|academic", "C1"],
        ["have access to", "collocation", "有机会使用；能够获得", "ielts|writing|academic", "B2"],
        ["gain access to", "collocation", "获得进入/使用权", "ielts|writing", "B2"],
        ["make an effort", "collocation", "做出努力", "ielts|speaking|daily", "B1"],
        ["make progress", "collocation", "取得进步", "ielts|speaking|work", "B1"],
        ["make a decision", "collocation", "做决定", "daily|work", "A2"],
        ["reach a conclusion", "collocation", "得出结论", "ielts|writing|academic", "B2"],
        ["draw a conclusion", "collocation", "得出结论", "ielts|writing|academic", "B2"],
        ["conduct research", "collocation", "进行研究", "ielts|writing|academic", "B2"],
        ["carry out research", "collocation", "开展研究", "ielts|writing", "B2"],
        ["gather evidence", "collocation", "收集证据", "ielts|writing|academic", "B2"],
        ["provide evidence", "collocation", "提供证据", "ielts|writing", "B2"],
        ["a body of evidence", "collocation", "大量证据", "ielts|writing|academic", "C1"],
        ["take into account", "collocation", "考虑到；把…考虑在内", "ielts|writing|academic", "B2"],
        ["take into consideration", "collocation", "考虑到", "ielts|writing", "B2"],
        ["bear in mind", "collocation", "牢记；记住", "ielts|speaking|writing", "B2"],
        ["keep in mind", "collocation", "牢记；记住", "ielts|speaking|daily", "B1"],
        ["in terms of", "collocation", "就…而言；在…方面", "ielts|writing|speaking", "B2"],
        ["with regard to", "collocation", "关于；至于", "ielts|writing|academic", "C1"],
        ["in relation to", "collocation", "与…相关", "ielts|writing|academic", "B2"],
        ["in the context of", "collocation", "在…的背景下", "ielts|writing|academic", "C1"],
        ["from a global perspective", "collocation", "从全球视角来看", "ielts|writing|speaking", "B2"],
        ["from my perspective", "collocation", "在我看来", "ielts|speaking|writing", "B2"],
        ["in my opinion", "collocation", "在我看来", "ielts|speaking|writing", "B1"],
        ["it is widely believed", "collocation", "人们普遍认为", "ielts|writing", "B2"],
        ["there is no denying", "collocation", "不可否认", "ielts|writing|speaking", "B2"],
        ["take advantage of", "collocation", "利用", "ielts|writing|daily", "B2"],
        ["make the most of", "collocation", "充分利用", "ielts|speaking|daily", "B2"],
        ["a key priority", "collocation", "首要任务", "ielts|writing|work", "B2"],
        ["top priority", "collocation", "头等大事", "work|ielts", "B2"],
        ["a pressing issue", "collocation", "紧迫的问题", "ielts|writing", "C1"],
        ["a widespread problem", "collocation", "普遍存在的问题", "ielts|writing", "B2"],
        ["a growing trend", "collocation", "日益增长的趋势", "ielts|writing", "B2"],
        ["a significant increase", "collocation", "显著增长", "ielts|writing|academic", "B2"],
        ["a sharp decline", "collocation", "急剧下降", "ielts|writing|academic", "B2"],
        ["a dramatic change", "collocation", "巨大的变化", "ielts|writing", "B2"],
        ["a substantial number", "collocation", "相当多的数量", "ielts|writing|academic", "C1"],
        ["a considerable amount", "collocation", "相当多的量", "ielts|writing", "B2"],
        ["a negligible amount", "collocation", "微不足道的量", "ielts|writing|academic", "C1"],
        ["at an alarming rate", "collocation", "以惊人的速度", "ielts|writing", "C1"],
        ["on a global scale", "collocation", "在全球范围内", "ielts|writing", "B2"],
        ["in the long term", "collocation", "从长远来看", "ielts|writing", "B2"],
        ["sustainable development", "collocation", "可持续发展", "ielts|writing|academic", "B2"],
        ["economic growth", "collocation", "经济增长", "ielts|writing|academic", "B1"],
        ["quality of life", "collocation", "生活质量", "ielts|writing|speaking", "B1"],
        ["standard of living", "collocation", "生活水平", "ielts|writing|academic", "B2"],
        ["public health", "collocation", "公共卫生", "ielts|writing|academic", "B1"],
        ["mental health", "collocation", "心理健康", "ielts|writing|speaking", "B2"],
        ["environmental protection", "collocation", "环境保护", "ielts|writing", "B1"],
        ["renewable energy", "collocation", "可再生能源", "ielts|writing|academic", "B2"],
        ["climate change", "collocation", "气候变化", "ielts|writing|academic", "B1"],
        ["carbon footprint", "collocation", "碳足迹", "ielts|writing|academic", "B2"],
        ["social inequality", "collocation", "社会不平等", "ielts|writing|academic", "B2"],
        ["gender equality", "collocation", "性别平等", "ielts|writing|academic", "B2"],
        ["poverty reduction", "collocation", "减贫", "ielts|writing", "B2"],
        ["job opportunities", "collocation", "就业机会", "ielts|writing|speaking", "B1"],
        ["work-life balance", "collocation", "工作与生活的平衡", "ielts|speaking|work", "B2"],
        ["career development", "collocation", "职业发展", "ielts|speaking|work", "B2"],
        ["academic performance", "collocation", "学业表现", "ielts|writing|academic", "B2"],
        ["higher education", "collocation", "高等教育", "ielts|writing|academic", "B1"],
        ["lifelong learning", "collocation", "终身学习", "ielts|writing|speaking", "B2"],
        ["digital literacy", "collocation", "数字素养", "ielts|writing|tech", "C1"],
        ["information overload", "collocation", "信息过载", "ielts|writing|tech", "C1"],
        ["cultural diversity", "collocation", "文化多样性", "ielts|writing|speaking", "B2"],
        ["cultural heritage", "collocation", "文化遗产", "ielts|writing|academic", "B2"],
        ["a sense of belonging", "collocation", "归属感", "ielts|writing|speaking", "C1"],
        ["a sense of responsibility", "collocation", "责任感", "ielts|writing|speaking", "B2"],

        // ---------------- Slang (everyday American) ----------------
        ["what's up", "slang", "最近怎么样；怎么了（打招呼）", "daily|informal", "A2"],
        ["how's it going", "slang", "最近还好吗（打招呼）", "daily|informal", "A2"],
        ["not much", "slang", "没什么；还行（回应问候）", "daily|informal", "A2"],
        ["cool", "slang", "酷；好的；没问题", "daily|informal", "A1"],
        ["awesome", "slang", "太棒了；超赞", "daily|informal", "A2"],
        ["no biggie", "slang", "没什么大不了的", "daily|informal", "B1"],
        ["for sure", "slang", "当然；肯定", "daily|informal", "B1"],
        ["you bet", "slang", "当然；没问题", "daily|informal", "B1"],
        ["sure thing", "slang", "当然可以；没问题", "daily|informal", "B1"],
        ["I'm down", "slang", "我愿意；算我一个", "daily|informal", "B1"],
        ["count me in", "slang", "算我一个；我也参加", "daily|informal", "B1"],
        ["count me out", "slang", "别算我；我不参加", "daily|informal", "B1"],
        ["chill", "slang", "放松；冷静；休闲", "daily|informal", "B1"],
        ["chill out", "slang", "放松一下；冷静点", "daily|informal", "B1"],
        ["grab a bite", "slang", "随便吃点东西", "daily|informal", "B1"],
        ["grab a coffee", "slang", "去喝杯咖啡", "daily|informal", "B1"],
        ["hit the road", "slang", "出发；上路", "daily|travel|informal", "B1"],
        ["call shotgun", "slang", "抢副驾驶座位", "daily|informal", "B2"],
        ["run behind", "slang", "迟到；落后于计划", "daily|work|informal", "B2"],
        ["running late", "slang", "要迟到了；快迟到了", "daily|informal", "B1"],
        ["make a right", "slang", "右转", "daily|travel|informal", "B1"],
        ["figure it out", "slang", "自己想办法搞定", "daily|informal", "B1"],
        ["not buying it", "slang", "不信；不接受这个说法", "daily|informal", "B2"],
        ["we'd better", "slang", "我们最好…（该走了）", "daily|informal", "B1"],
        ["all I know", "slang", "我只知道…（强调）", "daily|informal", "B2"],
        ["holy smokes", "slang", "天哪；哇（表示惊讶）", "daily|informal", "B2"],
        ["no way", "slang", "不会吧；不可能", "daily|informal", "A2"],
        ["get out of here", "slang", "不会吧；别闹了（惊讶）", "daily|informal", "B1"],
        ["are you kidding me", "slang", "你开玩笑吧", "daily|informal", "B1"],
        ["give me a break", "slang", "得了吧；别烦我", "daily|informal", "B1"],
        ["knock it off", "slang", "住手；别闹了", "daily|informal", "B2"],
        ["cut it out", "slang", "住手；别这样", "daily|informal", "B2"],
        ["whatever", "slang", "随便；无所谓", "daily|informal", "B1"],
        ["same old same old", "slang", "老样子；没什么新鲜事", "daily|informal", "B2"],
        ["it's been a crazy week", "slang", "这周真是忙疯了", "daily|work|informal", "B2"],
        ["any plans for the weekend", "slang", "周末有什么安排吗", "daily|informal", "B1"],
        ["long story short", "slang", "长话短说", "daily|informal", "B2"],
        ["to be honest", "slang", "说实话；老实说", "daily|speaking|informal", "B1"],
        ["honestly", "slang", "说实话；真的", "daily|informal", "B1"],
        ["literally", "slang", "字面上；简直（口语强调）", "daily|informal", "B2"],
        ["basically", "slang", "基本上；说白了", "daily|informal", "B2"],
        ["I mean", "slang", "我是说；我的意思是", "daily|informal", "A2"],
        ["you know", "slang", "你知道的；（口头语）", "daily|informal", "A2"],
        ["I guess so", "slang", "我想是吧；大概吧", "daily|informal", "B1"],
        ["makes sense", "slang", "有道理；说得通", "daily|informal", "B1"],
        ["fair enough", "slang", "有道理；可以接受", "daily|informal", "B2"],
        ["sounds good", "slang", "听起来不错；好的", "daily|informal", "A2"],
        ["sounds like a plan", "slang", "就这么定了；好主意", "daily|informal", "B2"],
        ["I'm game", "slang", "我愿意试试；算我一个", "daily|informal", "B2"],
        ["game on", "slang", "放马过来；开始吧", "daily|informal", "B2"],
        ["it's a date", "slang", "就这么说定了（约会）", "daily|informal", "B2"],
        ["my bad", "slang", "我的错；不好意思", "daily|informal", "B1"],
        ["oops", "slang", "哎呀；糟糕", "daily|informal", "A2"],
        ["whoa", "slang", "哇；哇哦（惊讶）", "daily|informal", "B1"],
        ["ouch", "slang", "哎哟（疼痛）", "daily|informal", "A2"],
        ["yikes", "slang", "哎呀；吓一跳", "daily|informal", "B2"],
        ["dude", "slang", "哥们；老兄", "daily|informal", "B1"],
        ["buddy", "slang", "伙计；朋友", "daily|informal", "B1"],
        ["bud", "slang", "哥们；兄弟（buddy 的简称）", "daily|informal", "B2"],
        ["man", "slang", "老兄；伙计（感叹）", "daily|informal", "A2"],
        ["guys", "slang", "大家；伙计们", "daily|informal", "A2"],
        ["folks", "slang", "大家；各位", "daily|informal", "B1"],
        ["y'all", "slang", "你们（you all，南方口语）", "daily|informal", "B2"],
        ["gonna", "slang", "打算（going to 的口语）", "daily|informal", "B1"],
        ["wanna", "slang", "想要（want to 的口语）", "daily|informal", "B1"],
        ["gotta", "slang", "必须；得（got to 的口语）", "daily|informal", "B1"],
        ["kinda", "slang", "有点；有点儿（kind of）", "daily|informal", "B1"],
        ["sorta", "slang", "有点；差不多（sort of）", "daily|informal", "B2"],
        ["lemme", "slang", "让我（let me 的口语）", "daily|informal", "B2"],
        ["gimme", "slang", "给我（give me 的口语）", "daily|informal", "B2"],
        ["c'mon", "slang", "得了吧；来吧（come on）", "daily|informal", "B2"],
        ["come on", "slang", "拜托；加油；得了吧", "daily|informal", "A2"],
        ["chillax", "slang", "放松（chill + relax）", "daily|informal", "B2"],
        ["vibe", "slang", "氛围；感觉", "daily|informal", "B2"],
        ["good vibes", "slang", "好氛围；正能量", "daily|informal", "B2"],
        ["lit", "slang", "超嗨的；很棒的（派对/活动）", "daily|informal", "B2"],
        ["bummer", "slang", "真扫兴；遗憾的事", "daily|informal", "B2"],
        ["bummed", "slang", "沮丧的；失望的", "daily|informal", "B2"],
        ["sick", "slang", "超酷的；很棒的（俚语用法）", "daily|informal", "B2"],
        ["cool beans", "slang", "太好了；真棒", "daily|informal", "B2"],
        ["sweet", "slang", "太好了；赞", "daily|informal", "B1"],
        ["rad", "slang", "超酷的；极好的", "daily|informal", "B2"],
        ["gnarly", "slang", "超赞的；也可指危险或糟糕", "daily|informal", "C1"],
        ["sketchy", "slang", "可疑的；不太靠谱的", "daily|informal", "B2"],
        ["shady", "slang", "可疑的；不正派的", "daily|informal", "B2"],
        ["sus", "slang", "可疑的（suspicious 的缩写）", "daily|informal", "B2"],
        ["legit", "slang", "真的；靠谱的；合法的", "daily|informal", "B2"],
        ["for real", "slang", "真的；说真的", "daily|informal", "B1"],
        ["no cap", "slang", "不骗你；说真的", "daily|informal", "B2"],
        ["nah", "slang", "不；才不（no 的口语）", "daily|informal", "B1"],
        ["yep / yeah", "slang", "是的；对（口语）", "daily|informal", "A2"],
        ["nope", "slang", "不；没有（口语）", "daily|informal", "A2"],
        ["totally", "slang", "完全；超（表强调）", "daily|informal", "B1"],
        ["I'm dead", "slang", "笑死我了；太好笑了", "daily|informal", "B2"],
        ["LOL", "slang", "哈哈；大笑（laughing out loud）", "daily|informal", "B1"],
        ["SMH", "slang", "摇头（shaking my head，表无奈）", "daily|informal", "B2"],
        ["IDK", "slang", "不知道（I don't know）", "daily|informal", "B1"],
        ["TBH", "slang", "说实话（to be honest）", "daily|informal", "B2"],
        ["IMO", "slang", "在我看来（in my opinion）", "daily|informal", "B2"],
        ["BRB", "slang", "马上回来（be right back）", "daily|informal", "B1"],
        ["GTG", "slang", "我得走了（got to go）", "daily|informal", "B1"],
        ["hype", "slang", "炒作；热烈宣传", "daily|tech|informal", "B2"],
        ["hyped", "slang", "兴奋的；期待的", "daily|informal", "B2"],
        ["stoked", "slang", "非常兴奋的；欣喜的", "daily|informal", "B2"],
        ["pumped", "slang", "兴奋的；劲头十足的", "daily|informal", "B2"],
        ["couch potato", "slang", "电视迷；懒人", "daily|informal", "B2"],
        ["party animal", "slang", "派对狂；爱玩的人", "daily|informal", "B2"],
        ["social butterfly", "slang", "交际花；爱社交的人", "daily|informal", "B2"],
        ["people person", "slang", "善于交际的人", "daily|work|informal", "B2"],
        ["homebody", "slang", "宅家的人；恋家的人", "daily|informal", "B2"],
        ["nerd", "slang", "书呆子；极客", "daily|informal", "B1"],
        ["geek", "slang", "极客；迷（某领域）", "daily|tech|informal", "B2"],
        ["bestie", "slang", "闺蜜；死党（best friend）", "daily|informal", "B2"],
        ["BFF", "slang", "永远的好朋友（best friends forever）", "daily|informal", "B2"],
        ["wingman", "slang", "僚机；帮忙牵线的朋友", "daily|informal", "C1"],
        ["third wheel", "slang", "电灯泡；多余的人", "daily|informal", "C1"],
        ["ghost", "slang", "突然失联；放鸽子", "daily|informal", "C1"],
        ["friend zone", "slang", "朋友区（暧昧但没发展）", "daily|informal", "C1"],
        ["hangover", "slang", "宿醉", "daily|informal", "B2"],
        ["on the house", "slang", "店家请客；免费", "daily|informal", "B2"],
        ["way to go", "slang", "做得好；太棒了", "daily|informal", "B1"],
        ["give it a shot", "slang", "试一试", "daily|informal", "B2"],
        ["take a rain check", "slang", "改天吧；下次再说", "daily|informal", "C1"],
    ];

    const TYPES = ["phrasal", "idiom", "collocation", "slang"];
    const TAGS = ["ielts", "academic", "speaking", "writing", "daily", "work", "travel", "tech", "informal"];
    const LEVELS = ["A2", "B1", "B2", "C1"];

    // Custom entries use the same shape: [phrase, type, meaningZh, tags, level].
    // Stored in chrome.storage.local by the options "My phrase library" page.
    const CUSTOM_STORAGE_KEY = "auraPhraseLibraryCustom";

    // Verb inflections we must recognise when a library phrase appears in a
    // subtitle in a different form (e.g. "figured out" -> "figure out").
    const IRREGULAR = {
        be: ["is", "am", "are", "was", "were", "been", "being"],
        go: ["goes", "went", "gone", "going"],
        get: ["gets", "got", "gotten", "getting"],
        take: ["takes", "took", "taken", "taking"],
        make: ["makes", "made", "making"],
        give: ["gives", "gave", "given", "giving"],
        come: ["comes", "came", "coming"],
        see: ["sees", "saw", "seen", "seeing"],
        know: ["knows", "knew", "known", "knowing"],
        think: ["thinks", "thought", "thinking"],
        find: ["finds", "found", "finding"],
        tell: ["tells", "told", "telling"],
        become: ["becomes", "became", "becoming"],
        leave: ["leaves", "left", "leaving"],
        feel: ["feels", "felt", "feeling"],
        bring: ["brings", "brought", "bringing"],
        begin: ["begins", "began", "begun", "beginning"],
        keep: ["keeps", "kept", "keeping"],
        hold: ["holds", "held", "holding"],
        write: ["writes", "wrote", "written", "writing"],
        stand: ["stands", "stood", "standing"],
        hear: ["hears", "heard", "hearing"],
        let: ["lets", "letting"],
        put: ["puts", "putting"],
        set: ["sets", "setting"],
        cut: ["cuts", "cutting"],
        say: ["says", "said", "saying"],
        do: ["does", "did", "done", "doing"],
        have: ["has", "had", "having"],
        break: ["breaks", "broke", "broken", "breaking"],
        fall: ["falls", "fell", "fallen", "falling"],
        send: ["sends", "sent", "sending"],
        build: ["builds", "built", "building"],
        spend: ["spends", "spent", "spending"],
        grow: ["grows", "grew", "grown", "growing"],
        lose: ["loses", "lost", "losing"],
        win: ["wins", "won", "winning"],
        run: ["runs", "ran", "running"],
        sit: ["sits", "sat", "sitting"],
        speak: ["speaks", "spoke", "spoken", "speaking"],
        pay: ["pays", "paid", "paying"],
        meet: ["meets", "met", "meeting"],
        buy: ["buys", "bought", "buying"],
        teach: ["teaches", "taught", "teaching"],
        catch: ["catches", "caught", "catching"],
        drink: ["drinks", "drank", "drunk", "drinking"],
        sing: ["sings", "sang", "sung", "singing"],
        eat: ["eats", "ate", "eaten", "eating"],
        forget: ["forgets", "forgot", "forgotten", "forgetting"],
        draw: ["draws", "drew", "drawn", "drawing"],
        fly: ["flies", "flew", "flown", "flying"],
    };

    const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

    function tokenize(text) {
        const matches = String(text || "").toLocaleLowerCase().match(WORD_RE);
        if (!matches) return [];
        return matches.map((word) => word.replace(/['’]/g, ""));
    }

    // Build the set of surface forms that should count as this lemma.
    function formsFor(lemma) {
        const forms = new Set([lemma]);
        const extra = IRREGULAR[lemma] || [];
        for (const word of extra) forms.add(word);
        if (lemma.length > 2) {
            forms.add(lemma + "s");
            if (/[^aeiou]y$/.test(lemma)) {
                forms.add(lemma.slice(0, -1) + "ies");
                forms.add(lemma.slice(0, -1) + "ied");
            } else if (/e$/.test(lemma)) {
                forms.add(lemma + "d");
                forms.add(lemma.slice(0, -1) + "ing");
            } else {
                forms.add(lemma + "ed");
                forms.add(lemma + "ing");
                if (/[^aeiou][aeiou][^aeiouwxy]$/.test(lemma)) {
                    forms.add(lemma + lemma.slice(-1) + "ing");
                }
            }
        }
        return forms;
    }

    // Compile a library phrase into an array of acceptable form Sets, one per
    // token, with function words locked to their literal form to avoid noise.
    const FUNCTION_WORDS = new Set([
        "a", "an", "the", "of", "in", "on", "at", "to", "from", "by", "for",
        "with", "and", "or", "as", "is", "am", "are", "was", "were", "be",
        "i", "you", "it", "we", "they", "me", "my", "your", "not", "no",
    ]);

    function compilePhrase(phrase) {
        const tokens = tokenize(phrase);
        if (tokens.length < 2) return null;
        return tokens.map((token) => FUNCTION_WORDS.has(token) ? new Set([token]) : formsFor(token));
    }

    function normalizeEntry(entry) {
        if (!Array.isArray(entry) || entry.length < 5) return null;
        const phrase = String(entry[0] || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
        const type = String(entry[1] || "phrasal");
        if (!phrase || !TYPES.includes(type)) return null;
        if (tokenize(phrase).length < 2) return null;
        const tags = String(entry[3] || "daily").split("|").filter((tag) => TAGS.includes(tag));
        const level = LEVELS.includes(entry[4]) ? entry[4] : "B2";
        return {
            phrase,
            type,
            meaning: String(entry[2] || "").trim(),
            tags: tags.length ? tags : ["daily"],
            level,
        };
    }

    function buildEntry(entry, index) {
        const norm = normalizeEntry(entry);
        if (!norm) return null;
        const pattern = compilePhrase(norm.phrase);
        if (!pattern) return null;
        return {key: norm.phrase + "#" + index, ...norm, pattern, length: pattern.length};
    }

    function mergedLibrary(customEntries) {
        const custom = Array.isArray(customEntries) ? customEntries : [];
        const seen = new Map();
        const all = ENTRIES.concat(custom);
        for (let i = 0; i < all.length; i += 1) {
            const built = buildEntry(all[i], i);
            if (!built) continue;
            // Custom entries (later in the array) override built-ins on phrase match.
            seen.set(built.phrase, built);
        }
        return Array.from(seen.values());
    }

    // Scan one cue's tokens for a compiled phrase. Returns matched surface forms.
    function matchInTokens(tokens, compiled) {
        const n = compiled.length;
        if (tokens.length < n) return [];
        const forms = [];
        for (let i = 0; i + n <= tokens.length; i += 1) {
            let ok = true;
            for (let j = 0; j < n; j += 1) {
                if (!compiled[j].has(tokens[i + j])) { ok = false; break; }
            }
            if (ok) forms.push(tokens.slice(i, i + n).join(" "));
        }
        return forms;
    }

    // cues: array with sourceText / displaySourceText. Returns phrases found in
    // the video sorted by in-video count, then IELTS relevance, then length.
    function analyze(cues, options) {
        const opts = options || {};
        const library = opts.entries ? mergedLibrary(opts.entries) : mergedLibrary([]);
        const limit = Math.max(1, Math.min(500, Number(opts.limit) || 100));
        const list = Array.isArray(cues) ? cues : [];
        const tokenized = list.map((cue) => tokenize(cue && (cue.displaySourceText || cue.sourceText || cue.text)));

        const results = new Map();
        for (const entry of library) {
            const occurrenceMap = new Map();
            const surfaces = new Set();
            let count = 0;
            for (let ci = 0; ci < tokenized.length; ci += 1) {
                const forms = matchInTokens(tokenized[ci], entry.pattern);
                if (!forms.length) continue;
                count += forms.length;
                for (const form of forms) surfaces.add(form);
                occurrenceMap.set(ci, Array.from(new Set((occurrenceMap.get(ci) || []).concat(forms))));
            }
            if (!count) continue;
            const occurrences = Array.from(occurrenceMap)
                .map(([cueIndex, forms]) => ({cueIndex, forms: forms.sort()}))
                .sort((a, b) => a.cueIndex - b.cueIndex);
            results.set(entry.key, {
                phrase: entry.phrase,
                type: entry.type,
                meaning: entry.meaning,
                tags: entry.tags,
                level: entry.level,
                count,
                cueCount: occurrences.length,
                forms: Array.from(surfaces).sort(),
                occurrences,
            });
        }

        const typeRank = {phrasal: 3, idiom: 2, collocation: 2, slang: 1};
        const phrases = Array.from(results.values()).sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            const ai = a.tags.includes("ielts") ? 1 : 0;
            const bi = b.tags.includes("ielts") ? 1 : 0;
            if (ai !== bi) return bi - ai;
            const ar = typeRank[a.type] || 0;
            const br = typeRank[b.type] || 0;
            if (ar !== br) return br - ar;
            return a.phrase.localeCompare(b.phrase);
        });

        return {phrases: phrases.slice(0, limit), total: phrases.length, totalCues: tokenized.length};
    }

    function all() { return ENTRIES; }
    function byType(type) { return ENTRIES.filter(function (e) { return e[1] === type; }); }

    Object.assign(Shared, {
        PHRASE_LIBRARY_EN: ENTRIES,
        PHRASE_LIBRARY_TYPES: TYPES,
        PHRASE_LIBRARY_TAGS: TAGS,
        PHRASE_LIBRARY_LEVELS: LEVELS,
        PHRASE_CUSTOM_STORAGE_KEY: CUSTOM_STORAGE_KEY,
        phraseLibraryAll: all,
        phraseLibraryByType: byType,
        phraseLibraryNormalize: normalizeEntry,
        phraseLibraryMerge: mergedLibrary,
        phraseLibraryTokenize: tokenize,
        phraseLibraryFormsFor: formsFor,
        phraseLibraryAnalyze: analyze,
    });
});
