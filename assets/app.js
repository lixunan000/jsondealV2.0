/* =========================================================
 * JsonDeal · 应用逻辑
 * 纯前端实现，所有数据仅在浏览器本地处理
 * ========================================================= */
(function () {
    'use strict';

    /* ---------------------------------------------------------
     * 1. 基础工具
     * ------------------------------------------------------- */

    const $ = (selector, root) => (root || document).querySelector(selector);
    const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    const TOAST_ICON = {
        success: '✓',
        error: '✕',
        warning: '!',
        info: 'i'
    };

    function toast(message, type) {
        const kind = type || 'info';
        const host = $('#toasts');
        if (!host) return;

        const el = document.createElement('div');
        el.className = 'toast toast--' + kind;
        el.innerHTML = '<span class="toast__icon">' + (TOAST_ICON[kind] || 'i') + '</span>' +
            '<span>' + escapeHtml(message) + '</span>';
        host.appendChild(el);

        setTimeout(() => {
            el.classList.add('is-out');
            setTimeout(() => el.remove(), 240);
        }, 3000);
    }

    function copyText(text) {
        if (!text) {
            toast('没有内容可复制', 'warning');
            return Promise.resolve(false);
        }
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text)
                .then(() => { toast('已复制到剪贴板', 'success'); return true; })
                .catch(() => fallbackCopy(text));
        }
        return Promise.resolve(fallbackCopy(text));
    }

    function fallbackCopy(text) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            toast(ok ? '已复制到剪贴板' : '复制失败', ok ? 'success' : 'error');
            return ok;
        } catch (e) {
            toast('复制失败', 'error');
            return false;
        }
    }

    function downloadFile(filename, content, mime) {
        if (!content) {
            toast('没有内容可下载', 'warning');
            return;
        }
        const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('文件已下载', 'success');
    }

    function busy(button, on, label) {
        if (!button) return;
        if (on) {
            button.dataset.label = button.dataset.label || button.textContent;
            button.classList.add('is-busy');
            button.disabled = true;
        } else {
            button.classList.remove('is-busy');
            button.disabled = false;
            if (button.dataset.label) {
                button.textContent = button.dataset.label;
                delete button.dataset.label;
            }
        }
    }

    /* ---------------------------------------------------------
     * 雪花 ID 生成
     *
     * 完全对齐主流微服务平台的 62 位雪花 ID 生成器：
     *   id = ((unix秒 - 1483200000) << 33)
     *      | (dataCenterId << 25)   8 位
     *      | (workerId      << 19)  6 位
     *      | (reservedBit   << 18)  1 位（领域隔离位）
     *      | sequence               18 位
     * 纪元 1483200000 = 2017-01-02 00:00:00（北京时间）
     * ------------------------------------------------------- */

    const SNOWFLAKE_EPOCH = 1483200000n;
    const SNOWFLAKE_SEQ_MASK = 0x3FFFFn;      // 18 位序列掩码
    const SNOWFLAKE_MAX_DC = 256;             // dataCenterId 8 位
    const SNOWFLAKE_MAX_WORKER = 64;          // workerId 6 位

    let lastSnowflakeId = 0n;
    // 节点号在一次会话内固定，模拟同一台发号实例
    let snowflakeNode = null;

    function generateSnowflakeId() {
        if (!snowflakeNode) {
            snowflakeNode = {
                dc: BigInt(Math.floor(Math.random() * SNOWFLAKE_MAX_DC)),
                worker: BigInt(Math.floor(Math.random() * SNOWFLAKE_MAX_WORKER))
            };
        }
        const seconds = BigInt(Math.floor(Date.now() / 1000));
        const timestamp = seconds - SNOWFLAKE_EPOCH;
        const dataCenterId = snowflakeNode.dc;
        const workerId = snowflakeNode.worker;
        // 与主流实现一致：跨秒时序列号是随机的，同一秒内才自增
        let sequence = BigInt(Math.floor(Math.random() * 262144));

        let id = (timestamp << 33n) | (dataCenterId << 25n) | (workerId << 19n) | sequence;

        if (id <= lastSnowflakeId) {
            // 保证严格递增、不与上一次重复；序列耗尽则时间戳 +1
            const seq = lastSnowflakeId & SNOWFLAKE_SEQ_MASK;
            id = seq < SNOWFLAKE_SEQ_MASK
                ? (lastSnowflakeId & ~SNOWFLAKE_SEQ_MASK) | (seq + 1n)
                : ((lastSnowflakeId >> 33n) + 1n) << 33n;
        }
        lastSnowflakeId = id;
        return id;
    }

    /** 生成一个雪花 ID 并填入指定输入框 */
    function pickSnowflakeId(targetId) {
        const input = document.getElementById(targetId);
        if (!input) return;
        const id = generateSnowflakeId().toString();
        input.value = id;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        toast('已生成雪花 ID：' + id, 'success');
    }

    /* ---------------------------------------------------------
     * 2. 主题 / 换行 / 路由
     * ------------------------------------------------------- */

    const STORE_KEY = 'jsondeal.prefs';

    function loadPrefs() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function savePrefs(patch) {
        try {
            const prefs = Object.assign(loadPrefs(), patch);
            localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
        } catch (e) { /* 忽略隐私模式下的写入失败 */ }
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
        const label = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
        $('#themeLabel').textContent = label;
        $('#themeToggleTop').textContent = theme === 'dark' ? '☀' : '◐';
    }

    function toggleTheme() {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        savePrefs({ theme: next });
    }

    function applyWrap(enabled) {
        document.body.classList.toggle('is-wrap', !!enabled);
        $('#wrapToggle').classList.toggle('is-on', !!enabled);
        $('#wrapIcon').textContent = enabled ? '↵' : '⏎';
        refreshPanes();
    }

    /** 重新计算所有面板的行号（换行状态 / 可见宽度变化后需要重算） */
    function refreshPanes() {
        panes.forEach((pane, id) => {
            if (pane.box && pane.box.closest('.view') && pane.box.closest('.view').hidden) return;
            updatePane(id);
        });
    }

    const ROUTES = {
        home: { title: '总览', desc: '七个常用的小工具，覆盖调试、接口联调与数据准备场景。' },
        format: { title: 'JSON 格式化', desc: '校验并美化 JSON 字符串，输出 4 空格缩进的规范格式。' },
        compare: { title: 'JSON 对比', desc: '深度比较两个 JSON，差异行直接高亮在文本上。' },
        assert: { title: 'JSON 断言生成', desc: '根据接口响应 JSON 自动生成 assert 断言代码。' },
        uid: { title: 'UID 提取', desc: '提取以 UID: 开头的唯一标识符，自动去重排序。' },
        idreplace: { title: '批量 ID 替换', desc: '将 SQL 中的数字 ID 替换为连续的雪花 ID。' },
        groovy: { title: 'Groovy 提取 SQL', desc: '从 Groovy 代码中提取 Update / Delete 语句。' },
        billrule: { title: '转单规则 SQL', desc: '读取转单规则配置模板，按行生成可直接执行的明细 INSERT 语句。' }
    };

    const TOOL_ROUTES = ['format', 'compare', 'assert', 'uid', 'idreplace', 'groovy', 'billrule'];

    function currentRoute() {
        const hash = (location.hash || '').replace(/^#\/?/, '');
        return ROUTES[hash] ? hash : 'home';
    }

    function navigate(route) {
        if (!ROUTES[route]) route = 'home';
        if (currentRoute() === route) {
            applyRoute(route);
            return;
        }
        location.hash = '#/' + route;
    }

    function applyRoute(route) {
        closeFullscreenPanel();
        $$('.view').forEach(view => {
            view.hidden = view.id !== 'view-' + route;
        });
        $$('.nav__item').forEach(item => {
            item.classList.toggle('is-active', item.dataset.route === route);
        });
        const meta = ROUTES[route];
        $('#pageTitle').textContent = meta.title;
        $('#pageDesc').textContent = meta.desc;
        document.title = meta.title + ' · JsonDeal';
        closeSidebar();
        window.scrollTo(0, 0);
        // 视图可见后宽度才准确，此时重算行号
        refreshPanes();
    }

    /* ---------------------------------------------------------
     * 3. 面板全屏（沉浸模式）
     * ------------------------------------------------------- */

    /** 全屏面板的宿主层：挂在 body 下，避开视图入场动画残留的 transform */
    function getFullscreenLayer() {
        let layer = document.getElementById('fullscreenLayer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'fullscreenLayer';
            document.body.appendChild(layer);
        }
        return layer;
    }

    // 记录全屏前面板的原位置，退出时原样放回
    let fullscreenHome = null;

    function setFullscreenButtonState(panelId, active) {
        const button = $('[data-fullscreen-target="' + panelId + '"]');
        if (!button) return;
        button.textContent = active ? '✕' : '⛶';
        button.title = active ? '退出全屏' : '全屏显示';
        button.setAttribute('aria-label', button.title);
    }

    /** 切换某个面板的全屏（沉浸）显示 */
    function togglePanelFullscreen(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;

        if (panel.classList.contains('is-fullscreen')) {
            exitFullscreen(panel);
        } else {
            // 同一时间只允许一个面板处于全屏状态
            $$('.panel.is-fullscreen').forEach(el => {
                exitFullscreen(el);
            });
            fullscreenHome = { parent: panel.parentElement, next: panel.nextSibling };
            getFullscreenLayer().appendChild(panel);
            panel.classList.add('is-fullscreen');
            setFullscreenButtonState(panelId, true);
        }

        document.body.classList.toggle('is-locked', !!$('.panel.is-fullscreen'));
        // 尺寸变化后重新计算折行与行号
        refreshPanes();
    }

    /** 退出全屏：把面板放回原来的位置 */
    function exitFullscreen(panel) {
        panel.classList.remove('is-fullscreen');
        setFullscreenButtonState(panel.id, false);
        if (fullscreenHome && fullscreenHome.parent) {
            const { parent, next } = fullscreenHome;
            if (next && next.parentElement === parent) parent.insertBefore(panel, next);
            else parent.appendChild(panel);
        }
        fullscreenHome = null;
    }

    function closeFullscreenPanel() {
        const panel = $('.panel.is-fullscreen');
        if (!panel) return;
        exitFullscreen(panel);
        document.body.classList.remove('is-locked');
        refreshPanes();
    }

    /* ---------------------------------------------------------
     * 4. 编辑器（行号 + 滚动同步 + 语法高亮）
     * ------------------------------------------------------- */

    const panes = new Map();

    const PANE_STAT = {
        formatInput: 'format.input',
        assertInput: 'assert.input',
        uidInput: 'uid.input',
        idReplaceInput: 'idreplace.input',
        groovyInput: 'groovy.input'
    };

    function initPanes() {
        $$('[data-editor]').forEach(box => {
            const id = box.dataset.editor;
            const pane = {
                id: id,
                box: box,
                gutter: $('[data-gutter]', box),
                area: $('textarea', box),
                code: $('pre', box),
                overlay: $('[data-overlay]', box)
            };
            panes.set(id, pane);

            if (pane.area) {
                pane.area.addEventListener('input', () => {
                    updatePane(id);
                    // 内容一旦变化，上一次的差异高亮即失效
                    if (id === 'compareInput1' || id === 'compareInput2') clearDiffMarks(id);
                });
                pane.area.addEventListener('scroll', () => syncPaneScroll(id));
            }
            if (pane.code) {
                pane.code.addEventListener('scroll', () => syncPaneScroll(id));
            }
            updatePane(id);
        });
    }

    function paneText(id) {
        const pane = panes.get(id);
        if (!pane) return '';
        if (pane.area) return pane.area.value;
        if (pane.code) {
            // 结果面板可能采用「展示形态 ≠ 复制内容」的方式（如 UID 一行一个），
            // 复制/下载统一取 canonical，取不到时回退到展示文本
            if (pane.canonical !== undefined && pane.canonical !== null) return pane.canonical;
            const placeholder = pane.code.querySelector('.editor__placeholder');
            return placeholder ? '' : pane.code.textContent;
        }
        return '';
    }

    /** 面板的展示文本（用于行号、行数统计） */
    function paneDisplayText(id) {
        const pane = panes.get(id);
        if (!pane) return '';
        if (pane.code) {
            const placeholder = pane.code.querySelector('.editor__placeholder');
            return placeholder ? '' : pane.code.textContent;
        }
        return paneText(id);
    }

    function updatePane(id) {
        const pane = panes.get(id);
        if (!pane) return;

        const text = paneDisplayText(id);
        const lines = text ? text.split('\n') : [''];
        if (pane.gutter) {
            let html = '';
            for (let i = 0; i < lines.length; i++) {
                html += '<div>' + (i + 1) + '</div>';
                // 折行的逻辑行补齐空行，保证行号与内容始终对齐
                const extra = paneRows(pane, lines[i]) - 1;
                for (let k = 0; k < extra; k++) html += '<div class="gutter__pad"></div>';
            }
            pane.gutter.innerHTML = html;
        }
        const statName = PANE_STAT[id];
        if (statName) setStat(statName, lines.length + ' 行');
        syncPaneScroll(id);
    }

    /* ---------------------------------------------------------
     * 折行测量：结果面板始终软换行，输入区跟随顶栏的「自动换行」开关
     * ------------------------------------------------------- */

    let measurer = null;

    function paneWrapEnabled(pane) {
        if (pane.code) return true;
        return document.body.classList.contains('is-wrap');
    }

    function paneContentWidth(pane) {
        const el = pane.code || pane.area;
        if (!el || !el.clientWidth) return 0;
        const cs = getComputedStyle(el);
        return el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    }

    /** 某一行在当前宽度下实际占用的视觉行数 */
    function paneRows(pane, line) {
        if (!paneWrapEnabled(pane) || !line) return 1;
        const width = paneContentWidth(pane);
        if (width <= 0) return 1;

        const cs = getComputedStyle(pane.code || pane.area);
        const fontSize = parseFloat(cs.fontSize) || 13;
        const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.6;
        // 等宽字体粗略估算单行容量，短行直接判定为 1 行，避免逐行触发重排
        const approxChars = Math.floor(width / (fontSize * 0.62));
        if (line.length <= approxChars) return 1;

        if (!measurer) {
            measurer = document.createElement('div');
            measurer.setAttribute('aria-hidden', 'true');
            measurer.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;' +
                'pointer-events:none;white-space:pre;';
            document.body.appendChild(measurer);
        }
        measurer.style.fontFamily = cs.fontFamily;
        measurer.style.fontSize = cs.fontSize;
        measurer.style.lineHeight = cs.lineHeight;
        measurer.style.letterSpacing = cs.letterSpacing;
        measurer.style.whiteSpace = cs.whiteSpace;
        measurer.style.wordBreak = cs.wordBreak;
        measurer.style.overflowWrap = cs.overflowWrap;
        measurer.style.width = width + 'px';
        measurer.textContent = line;
        return Math.max(1, Math.round(measurer.offsetHeight / lineHeight));
    }

    function syncPaneScroll(id) {
        const pane = panes.get(id);
        if (!pane) return;
        const src = pane.area || pane.code;
        if (!src) return;
        if (pane.gutter) pane.gutter.scrollTop = src.scrollTop;
        if (pane.overlay) {
            pane.overlay.scrollTop = src.scrollTop;
            pane.overlay.scrollLeft = src.scrollLeft;
        }
    }

    function setPaneText(id, text, options) {
        const pane = panes.get(id);
        if (!pane || !pane.code) return;
        const opts = options || {};
        // canonical：复制 / 下载使用的内容，默认与展示内容一致
        pane.canonical = (opts.canonical !== undefined && opts.canonical !== null) ? opts.canonical : text;
        if (!text) {
            pane.code.innerHTML = '<span class="editor__placeholder">' +
                escapeHtml(opts.placeholder || '结果将在这里显示…') + '</span>';
        } else if (opts.json) {
            pane.code.innerHTML = highlightJson(text);
        } else {
            pane.code.textContent = text;
        }
        updatePane(id);
    }

    function setStat(name, value) {
        const el = $('[data-stat="' + name + '"]');
        if (el) el.textContent = value;
    }

    /** 轻量 JSON 语法高亮 */
    function highlightJson(source) {
        const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
        let out = '';
        let last = 0;
        let match;

        while ((match = re.exec(source)) !== null) {
            out += escapeHtml(source.slice(last, match.index));
            if (match[1] !== undefined) {
                if (match[2]) {
                    out += '<span class="tok-key">' + escapeHtml(match[1]) + '</span>' + escapeHtml(match[2]);
                } else {
                    out += '<span class="tok-str">' + escapeHtml(match[1]) + '</span>';
                }
            } else if (match[0] === 'true' || match[0] === 'false') {
                out += '<span class="tok-bool">' + match[0] + '</span>';
            } else if (match[0] === 'null') {
                out += '<span class="tok-null">null</span>';
            } else {
                out += '<span class="tok-num">' + escapeHtml(match[0]) + '</span>';
            }
            last = re.lastIndex;
        }
        out += escapeHtml(source.slice(last));
        return out;
    }

    /* ---------------------------------------------------------
     * 5. 命令面板
     * ------------------------------------------------------- */

    const PALETTE_ITEMS = TOOL_ROUTES.map(route => ({
        route: route,
        title: ROUTES[route].title,
        hint: ROUTES[route].desc
    }));

    let paletteIndex = 0;
    let paletteFiltered = PALETTE_ITEMS.slice();

    function openPalette() {
        $('#palette').hidden = false;
        const input = $('#paletteInput');
        input.value = '';
        renderPalette('');
        setTimeout(() => input.focus(), 0);
    }

    function closePalette() {
        $('#palette').hidden = true;
    }

    function renderPalette(keyword) {
        const kw = (keyword || '').trim().toLowerCase();
        paletteFiltered = PALETTE_ITEMS.filter(item =>
            !kw || item.title.toLowerCase().indexOf(kw) > -1 || item.hint.toLowerCase().indexOf(kw) > -1);
        paletteIndex = 0;
        const list = $('#paletteList');
        if (!paletteFiltered.length) {
            list.innerHTML = '<li class="palette__item">没有匹配的工具</li>';
            return;
        }
        list.innerHTML = paletteFiltered.map((item, index) =>
            '<li class="palette__item' + (index === 0 ? ' is-active' : '') + '" data-route="' + item.route + '">' +
            '<span class="nav__icon">{ }</span>' +
            '<span>' + escapeHtml(item.title) + '</span>' +
            '<small>' + escapeHtml(item.hint.slice(0, 18)) + '…</small>' +
            '</li>').join('');
    }

    function movePalette(step) {
        if (!paletteFiltered.length) return;
        paletteIndex = (paletteIndex + step + paletteFiltered.length) % paletteFiltered.length;
        const items = $$('.palette__item', $('#paletteList'));
        items.forEach((el, i) => el.classList.toggle('is-active', i === paletteIndex));
        if (items[paletteIndex]) items[paletteIndex].scrollIntoView({ block: 'nearest' });
    }

    /* ---------------------------------------------------------
     * 6. 工具一：JSON 格式化
     * ------------------------------------------------------- */

    /** 把 \" \\ \n 等转义序列还原成真实字符 */
    function unescapeJsonText(text) {
        return text.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (match, group) => {
            switch (group.charAt(0)) {
                case 'u': return String.fromCharCode(parseInt(group.slice(1), 16));
                case 'b': return '\b';
                case 'f': return '\f';
                case 'n': return '\n';
                case 'r': return '\r';
                case 't': return '\t';
                default: return group;
            }
        });
    }

    /**
     * 宽松解析 JSON，兼容「整体被转义」的文本，例如
     *   {\"inspectResult\":\"1\",\"pk_org\":\"2512556443864399874\"}
     *   "{\"inspectResult\":\"1\"}"
     * 依次尝试：直接解析 → 当作字符串解析后再解一层 → 先反转义再解析
     */
    function parseJsonLoose(text) {
        const attempts = [
            t => JSON.parse(t),
            t => JSON.parse(JSON.parse('"' + t + '"')),
            t => JSON.parse(unescapeJsonText(t))
        ];
        let lastError = null;
        for (let i = 0; i < attempts.length; i++) {
            try {
                return { value: attempts[i](text), converted: i > 0 };
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }

    /** 宽松解析并把「JSON 字符串里装的 JSON」再解一层 */
    function parseJsonInput(text) {
        const parsed = parseJsonLoose(text);
        if (typeof parsed.value === 'string') {
            try {
                const inner = JSON.parse(parsed.value);
                return { value: inner, converted: true };
            } catch (error) {
                /* 确实是普通字符串，保持原样 */
            }
        }
        return parsed;
    }

    function runFormat(button) {
        updatePane('formatInput');
        const input = paneText('formatInput').trim();
        if (!input) {
            toast('请输入 JSON 字符串', 'warning');
            return;
        }
        busy(button, true);
        setTimeout(() => {
            try {
                const parsed = parseJsonInput(input);
                const formatted = JSON.stringify(parsed.value, null, 4);
                setPaneText('formatOutput', formatted, { json: true, placeholder: '格式化结果将在这里显示…' });
                toast(parsed.converted ? '格式化成功！（已自动还原转义字符）' : '格式化成功！', 'success');
            } catch (error) {
                console.error('Format error:', error);
                setPaneText('formatOutput', '', { placeholder: '格式化结果将在这里显示…' });
                toast('JSON 格式错误，请检查输入', 'error');
            } finally {
                busy(button, false);
            }
        }, 80);
    }

    /**
     * 递归按 key 的字母顺序排序对象。
     * 先忽略大小写比较，大小写相同时再按编码值比较，保证结果稳定。
     */
    function sortJsonKeys(value) {
        if (Array.isArray(value)) return value.map(sortJsonKeys);
        if (value && typeof value === 'object') {
            const sorted = {};
            Object.keys(value).sort((a, b) => {
                const la = a.toLowerCase();
                const lb = b.toLowerCase();
                if (la < lb) return -1;
                if (la > lb) return 1;
                if (a < b) return -1;
                if (a > b) return 1;
                return 0;
            }).forEach(key => {
                sorted[key] = sortJsonKeys(value[key]);
            });
            return sorted;
        }
        return value;
    }

    function runFormatSort(button) {
        updatePane('formatInput');
        const input = paneText('formatInput').trim();
        if (!input) {
            toast('请输入 JSON 字符串', 'warning');
            return;
        }
        busy(button, true);
        setTimeout(() => {
            try {
                const parsed = parseJsonInput(input);
                const sorted = JSON.stringify(sortJsonKeys(parsed.value), null, 4);
                setPaneText('formatOutput', sorted, { json: true, placeholder: '格式化结果将在这里显示…' });
                toast('排序完成，已按 key 的字母顺序输出', 'success');
            } catch (error) {
                console.error('Format sort error:', error);
                setPaneText('formatOutput', '', { placeholder: '格式化结果将在这里显示…' });
                toast('JSON 格式错误，请检查输入', 'error');
            } finally {
                busy(button, false);
            }
        }, 80);
    }

    function clearFormat() {
        $('#formatInput').value = '';
        setPaneText('formatOutput', '', { placeholder: '格式化结果将在这里显示…' });
        updatePane('formatInput');
        toast('输入已清空', 'info');
    }

    /* ---------------------------------------------------------
     * 7. 工具二：JSON 对比
     * ------------------------------------------------------- */

    function isObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((item, index) => deepEqual(item, b[index]));
        }
        if (isObject(a) && isObject(b)) {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every(key => deepEqual(a[key], b[key]));
        }
        return false;
    }

    function safeStringify(value) {
        if (value === undefined || value === null) return null;
        try {
            return JSON.stringify(value, null, 2);
        } catch (e) {
            return String(value);
        }
    }

    function findJSONDifferences(obj1, obj2, path) {
        const differences = [];
        const current = path || '';

        const allKeys = new Set([
            ...(typeof obj1 === 'object' && obj1 !== null ? Object.keys(obj1) : []),
            ...(typeof obj2 === 'object' && obj2 !== null ? Object.keys(obj2) : [])
        ]);

        allKeys.forEach(key => {
            const currentPath = current ? current + '.' + key : key;

            if (obj1 && !Object.prototype.hasOwnProperty.call(obj1, key)) {
                differences.push({ path: currentPath, type: 'added', value1: null, value2: safeStringify(obj2[key]) });
                return;
            }
            if (obj2 && !Object.prototype.hasOwnProperty.call(obj2, key)) {
                differences.push({ path: currentPath, type: 'removed', value1: safeStringify(obj1[key]), value2: null });
                return;
            }

            const val1 = obj1[key];
            const val2 = obj2[key];

            if (isObject(val1) && isObject(val2)) {
                differences.push.apply(differences, findJSONDifferences(val1, val2, currentPath));
            } else if (Array.isArray(val1) && Array.isArray(val2)) {
                differences.push.apply(differences, compareArrays(val1, val2, currentPath));
            } else if (!deepEqual(val1, val2)) {
                differences.push({
                    path: currentPath,
                    type: 'changed',
                    value1: safeStringify(val1),
                    value2: safeStringify(val2)
                });
            }
        });

        return differences;
    }

    function compareArrays(arr1, arr2, path) {
        const differences = [];

        if (arr1.length !== arr2.length) {
            differences.push({
                path: path,
                type: 'length_changed',
                value1: '长度: ' + arr1.length,
                value2: '长度: ' + arr2.length
            });
        }

        const maxLen = Math.max(arr1.length, arr2.length);
        for (let i = 0; i < maxLen; i++) {
            const itemPath = path + '[' + i + ']';

            if (i >= arr1.length) {
                differences.push({ path: itemPath, type: 'added', value1: null, value2: safeStringify(arr2[i]) });
            } else if (i >= arr2.length) {
                differences.push({ path: itemPath, type: 'removed', value1: safeStringify(arr1[i]), value2: null });
            } else if (isObject(arr1[i]) && isObject(arr2[i])) {
                differences.push.apply(differences, findJSONDifferences(arr1[i], arr2[i], itemPath));
            } else if (Array.isArray(arr1[i]) && Array.isArray(arr2[i])) {
                differences.push.apply(differences, compareArrays(arr1[i], arr2[i], itemPath));
            } else if (!deepEqual(arr1[i], arr2[i])) {
                differences.push({
                    path: itemPath,
                    type: 'changed',
                    value1: safeStringify(arr1[i]),
                    value2: safeStringify(arr2[i])
                });
            }
        }

        return differences;
    }

    function countKeys(obj) {
        if (!obj || typeof obj !== 'object') return 0;
        let count = Object.keys(obj).length;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                count += countKeys(obj[key]);
            }
        }
        return count;
    }

    /* --- 差异行高亮 --- */

    /**
     * 解析 JSON 文本，并记录每个路径在原文中的行号。
     * 返回 { value, index }，index 的 key 是形如 a.b[0].c 的路径，
     * value 为 { keyLine, valueLine }（键所在行 / 值所在行，均从 1 开始）。
     */
    function parseJsonWithLines(text) {
        let pos = 0;
        let line = 1;
        const index = new Map();

        function fail(message) {
            throw new Error(message + '（第 ' + line + ' 行）');
        }

        function skipWhitespace() {
            while (pos < text.length) {
                const ch = text[pos];
                if (ch === '\n') { line++; pos++; }
                else if (ch === ' ' || ch === '\t' || ch === '\r') { pos++; }
                else break;
            }
        }

        function readString() {
            const start = pos;
            pos++;
            while (pos < text.length) {
                const ch = text[pos];
                if (ch === '\\') { pos += 2; continue; }
                if (ch === '"') { pos++; return JSON.parse(text.slice(start, pos)); }
                if (ch === '\n') fail('字符串中出现换行');
                pos++;
            }
            fail('字符串未闭合');
        }

        function readNumber() {
            const start = pos;
            while (pos < text.length && /[-+0-9.eE]/.test(text[pos])) pos++;
            const raw = text.slice(start, pos);
            const value = Number(raw);
            if (Number.isNaN(value)) fail('无法识别的数字 "' + raw + '"');
            return value;
        }

        function readLiteral(word, value) {
            if (text.substr(pos, word.length) !== word) fail('无法识别的字面量');
            pos += word.length;
            return value;
        }

        function parseValue(path) {
            skipWhitespace();
            const startLine = line;
            const ch = text[pos];
            let value;
            if (ch === '{') value = parseObject(path);
            else if (ch === '[') value = parseArray(path);
            else if (ch === '"') value = readString();
            else if (ch === '-' || (ch >= '0' && ch <= '9')) value = readNumber();
            else if (ch === 't') value = readLiteral('true', true);
            else if (ch === 'f') value = readLiteral('false', false);
            else if (ch === 'n') value = readLiteral('null', null);
            else fail('无法识别的字符 "' + (ch || '结尾') + '"');
            return { value: value, startLine: startLine };
        }

        function parseObject(path) {
            pos++;
            const obj = {};
            skipWhitespace();
            if (text[pos] === '}') { pos++; return obj; }
            for (;;) {
                skipWhitespace();
                if (text[pos] !== '"') fail('对象的键必须是字符串');
                const keyLine = line;
                const key = readString();
                skipWhitespace();
                if (text[pos] !== ':') fail('键 "' + key + '" 后缺少冒号');
                pos++;
                const childPath = path ? path + '.' + key : key;
                const info = parseValue(childPath);
                obj[key] = info.value;
                index.set(childPath, { keyLine: keyLine, valueLine: info.startLine });
                skipWhitespace();
                if (text[pos] === ',') {
                    pos++;
                    skipWhitespace();
                    if (text[pos] === '}') { pos++; break; }
                    continue;
                }
                if (text[pos] === '}') { pos++; break; }
                fail('对象中缺少逗号或右花括号');
            }
            return obj;
        }

        function parseArray(path) {
            pos++;
            const arr = [];
            skipWhitespace();
            if (text[pos] === ']') { pos++; return arr; }
            for (let i = 0; ; i++) {
                const childPath = path ? path + '[' + i + ']' : String(i);
                const info = parseValue(childPath);
                arr.push(info.value);
                index.set(childPath, { keyLine: info.startLine, valueLine: info.startLine });
                skipWhitespace();
                if (text[pos] === ',') {
                    pos++;
                    skipWhitespace();
                    if (text[pos] === ']') { pos++; break; }
                    continue;
                }
                if (text[pos] === ']') { pos++; break; }
                fail('数组中缺少逗号或右方括号');
            }
            return arr;
        }

        const parsed = parseValue('');
        skipWhitespace();
        return { value: parsed.value, index: index };
    }

    /** 高亮优先级：修改 > 新增 / 缺失 */
    const DIFF_CLASS_PRIORITY = { 'hl-changed': 3, 'hl-added': 2, 'hl-removed': 2 };

    /**
     * 依据路径行号索引，把差异精确标注到原文对应的行上。
     * 新增 / 缺失 → 标注键所在行；修改 → 标注值所在行（两侧都标注）。
     */
    function buildDiffLineMap(text, differences, jsonType) {
        const map = {};
        let index = null;
        try {
            index = parseJsonWithLines(text).index;
        } catch (error) {
            console.warn('行号索引解析失败，回退为模糊匹配：', error);
            return createDiffLineMap(text.split('\n'), differences, jsonType);
        }

        differences.forEach(diff => {
            const entry = index.get(diff.path);
            if (!entry) return;

            let className = '';
            let lineNumber = 0;

            if (diff.type === 'added') {
                if (jsonType !== 'json2') return;
                className = 'hl-added';
                lineNumber = entry.keyLine;
            } else if (diff.type === 'removed') {
                if (jsonType !== 'json1') return;
                className = 'hl-removed';
                lineNumber = entry.keyLine;
            } else {
                className = 'hl-changed';
                lineNumber = entry.valueLine;
            }

            if (!lineNumber) return;
            const current = map[lineNumber];
            if (!current || (DIFF_CLASS_PRIORITY[className] || 0) > (DIFF_CLASS_PRIORITY[current] || 0)) {
                map[lineNumber] = className;
            }
        });

        return map;
    }

    function assignHighlightClass(diffLineMap, lineNumber, diffType, jsonType) {
        let highlightClass = '';
        switch (diffType) {
            case 'added':
                if (jsonType === 'json2') highlightClass = 'hl-added';
                break;
            case 'removed':
                if (jsonType === 'json1') highlightClass = 'hl-removed';
                break;
            case 'changed':
            case 'length_changed':
                highlightClass = 'hl-changed';
                break;
        }
        if (highlightClass) diffLineMap[lineNumber] = highlightClass;
    }

    function highlightArrayDifferences(lines, diffLineMap, diff, jsonType) {
        const pathParts = diff.path.split('.');
        const arrayPath = pathParts.slice(0, -1).join('.');

        let arrayStartLine = -1;
        let arrayEndLine = -1;
        let bracketCount = 0;

        lines.forEach((line, index) => {
            const lineNumber = index + 1;

            if (line.includes(arrayPath) && line.includes('[')) {
                arrayStartLine = lineNumber;
                bracketCount = 1;
            }

            if (arrayStartLine !== -1) {
                bracketCount += (line.match(/\[/g) || []).length;
                bracketCount -= (line.match(/\]/g) || []).length;
                if (bracketCount === 0) arrayEndLine = lineNumber;
            }

            if (arrayStartLine !== -1 && arrayEndLine === -1) {
                const trimmed = line.trim();
                if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    const diffValue = jsonType === 'json1' ? diff.value1 : diff.value2;
                    if (diffValue && line.includes(JSON.stringify(diffValue).replace(/"/g, ''))) {
                        assignHighlightClass(diffLineMap, lineNumber, diff.type, jsonType);
                    }
                }
            }
        });
    }

    function highlightKeyValueDifferences(lines, diffLineMap, diff, jsonType) {
        const pathParts = diff.path.split('.');
        const lastKey = pathParts[pathParts.length - 1];

        lines.forEach((line, index) => {
            const lineNumber = index + 1;
            const trimmedLine = line.trim();

            const keyPattern = new RegExp('"' + lastKey + '"\\s*:');
            if (keyPattern.test(line)) {
                assignHighlightClass(diffLineMap, lineNumber, diff.type, jsonType);
                return;
            }

            if (pathParts.length > 1) {
                const parentKey = pathParts[pathParts.length - 2];
                const parentPattern = new RegExp('"' + parentKey + '"\\s*:');
                if (parentPattern.test(line)) {
                    if (trimmedLine.endsWith('{') || trimmedLine.endsWith('[')) {
                        assignHighlightClass(diffLineMap, lineNumber, diff.type, jsonType);
                        return;
                    }
                }
            }
        });
    }

    function createDiffLineMap(lines, differences, jsonType) {
        const diffLineMap = {};
        differences.forEach(diff => {
            if (diff.path.includes('[') && diff.path.includes(']')) {
                highlightArrayDifferences(lines, diffLineMap, diff, jsonType);
            } else {
                highlightKeyValueDifferences(lines, diffLineMap, diff, jsonType);
            }
        });
        return diffLineMap;
    }

    function renderOverlay(paneId, text, differences, jsonType) {
        const pane = panes.get(paneId);
        if (!pane || !pane.overlay) return;
        const lines = text.split('\n');
        const map = buildDiffLineMap(text, differences, jsonType);

        let html = '';
        lines.forEach((line, index) => {
            const cls = map[index + 1] || '';
            // 带上原文（透明显示），换行时高度与输入框保持一致，高亮条不错位
            html += '<div class="hl-line ' + cls + '">' + escapeHtml(line) + '</div>';
        });
        pane.overlay.innerHTML = html;
        paintGutterHighlights(paneId, map);
        syncPaneScroll(paneId);
    }

    /** 行号栏同步标注差异所在行 */
    function paintGutterHighlights(paneId, map) {
        const pane = panes.get(paneId);
        if (!pane || !pane.gutter) return;
        const children = pane.gutter.children;
        let lineNumber = 0;
        for (let i = 0; i < children.length; i++) {
            const el = children[i];
            if (el.classList.contains('gutter__pad')) continue;
            lineNumber++;
            const cls = map[lineNumber] || '';
            if (el.className !== cls) el.className = cls;
        }
    }

    /** 清掉某个面板上的差异标注（高亮条 + 行号） */
    function clearDiffMarks(paneId) {
        const pane = panes.get(paneId);
        if (!pane) return;
        if (pane.overlay) pane.overlay.innerHTML = '';
        paintGutterHighlights(paneId, {});
    }

    function groupDifferencesByType(differences) {
        const grouped = { removed: [], added: [], changed: [] };
        differences.forEach(diff => {
            if (diff.type === 'removed') grouped.removed.push(diff);
            else if (diff.type === 'added') grouped.added.push(diff);
            else if (diff.type === 'changed' || diff.type === 'length_changed') grouped.changed.push(diff);
        });
        return grouped;
    }

    function displayComparisonResult(differences, summary) {
        const box = $('#compareResult');
        if (!differences.length) {
            box.innerHTML = '<div class="empty"><span class="empty__icon">✓</span><p>两个 JSON 完全相同</p></div>';
            return;
        }

        const grouped = groupDifferencesByType(differences);

        let html = '<div class="diff-summary">' +
            '<span class="chip chip--accent">总差异 ' + (summary.total_differences || differences.length) + '</span>' +
            '<span class="chip chip--danger">删除 ' + grouped.removed.length + '</span>' +
            '<span class="chip chip--success">新增 ' + grouped.added.length + '</span>' +
            '<span class="chip chip--changed">修改 ' + grouped.changed.length + '</span>' +
            '<span class="chip">JSON 1 键数 ' + summary.json1_keys + '</span>' +
            '<span class="chip">JSON 2 键数 ' + summary.json2_keys + '</span>' +
            '</div>';

        const section = (cls, title, items, kind) => {
            if (!items.length) return '';
            let block = '<div class="diff-group diff-group--' + cls + '">' +
                '<h4 class="diff-group__title">' + title + ' (' + items.length + ')</h4>';
            items.forEach((diff, index) => {
                block += '<div class="diff-item diff-item--' + cls + '">' +
                    '<div class="diff-item__path">' + (index + 1) + '. ' + escapeHtml(diff.path) + '</div>' +
                    '<div class="diff-item__val"><span class="diff-item__label">' + kind + '</span>' + escapeHtml(diff.value) + '</div>' +
                    '</div>';
            });
            return block + '</div>';
        };

        html += section('removed', '删除的项', grouped.removed.map(d => ({ path: d.path, value: d.value1 })), '原值');
        html += section('added', '新增的项', grouped.added.map(d => ({ path: d.path, value: d.value2 })), '新值');
        html += section('changed', '修改的项', grouped.changed.map(d => ({ path: d.path, value: '原值: ' + d.value1 + '  →  新值: ' + d.value2 })), '');

        box.innerHTML = html;
    }

    /** 写入输入框并同步行号（保留滚动位置） */
    function setPaneInput(id, text) {
        const pane = panes.get(id);
        if (!pane || !pane.area) return;
        const scrollTop = pane.area.scrollTop;
        pane.area.value = text;
        pane.area.scrollTop = scrollTop;
        updatePane(id);
    }

    function runCompare(button) {
        updatePane('compareInput1');
        updatePane('compareInput2');
        const input1 = paneText('compareInput1').trim();
        const input2 = paneText('compareInput2').trim();
        if (!input1 || !input2) {
            toast('请填写两个 JSON 进行对比', 'warning');
            return;
        }
        busy(button, true);
        setTimeout(() => {
            try {
                clearHighlights();

                // 先解析：两边都合法才继续，避免只把一边改掉
                const parsed1 = parseJsonInput(input1);
                const parsed2 = parseJsonInput(input2);

                // 未格式化的 JSON 先自动排版，保证高亮能落到具体行上
                const text1 = JSON.stringify(parsed1.value, null, 4);
                const text2 = JSON.stringify(parsed2.value, null, 4);
                const autoFormatted = text1 !== input1 || text2 !== input2;
                if (text1 !== input1) setPaneInput('compareInput1', text1);
                if (text2 !== input2) setPaneInput('compareInput2', text2);

                const obj1 = parsed1.value;
                const obj2 = parsed2.value;
                const differences = findJSONDifferences(obj1, obj2);

                renderOverlay('compareInput1', text1, differences, 'json1');
                renderOverlay('compareInput2', text2, differences, 'json2');

                const grouped = groupDifferencesByType(differences);
                setStat('compare.removed', '删除 ' + grouped.removed.length);
                setStat('compare.changed', '修改 ' + grouped.changed.length);
                setStat('compare.added', '新增 ' + grouped.added.length);
                setStat('compare.changed2', '修改 ' + grouped.changed.length);
                setStat('compare.total', '总差异 ' + differences.length);

                displayComparisonResult(differences, {
                    total_differences: differences.length,
                    json1_keys: countKeys(obj1),
                    json2_keys: countKeys(obj2)
                });

                if (!differences.length) {
                    toast(autoFormatted ? '已自动格式化，两个 JSON 完全相同' : '两个 JSON 完全相同', 'info');
                } else {
                    toast(autoFormatted ? '已自动格式化输入内容，差异已高亮显示' : '对比完成，差异已高亮显示', 'success');
                }
            } catch (error) {
                console.error('Compare error:', error);
                toast('对比失败，请检查 JSON 格式', 'error');
            } finally {
                busy(button, false);
            }
        }, 80);
    }

    function clearHighlights() {
        const p1 = panes.get('compareInput1');
        const p2 = panes.get('compareInput2');
        if (p1 && p1.overlay) p1.overlay.innerHTML = '';
        if (p2 && p2.overlay) p2.overlay.innerHTML = '';
        paintGutterHighlights('compareInput1', {});
        paintGutterHighlights('compareInput2', {});
        const box = $('#compareResult');
        if (box) {
            box.innerHTML = '<div class="empty"><span class="empty__icon">⇄</span><p>点击「对比」开始分析两个 JSON 的差异</p></div>';
        }
        setStat('compare.removed', '删除 0');
        setStat('compare.changed', '修改 0');
        setStat('compare.added', '新增 0');
        setStat('compare.changed2', '修改 0');
        setStat('compare.total', '总差异 0');
    }

    function clearCompareInputs() {
        $('#compareInput1').value = '';
        $('#compareInput2').value = '';
        updatePane('compareInput1');
        updatePane('compareInput2');
        clearHighlights();
        toast('所有输入已清空', 'info');
    }

    const COMPARE_EXAMPLE_1 = `{
    "name": "张三",
    "age": 25,
    "hobbies": ["篮球", "阅读", "编程"],
    "address": {
        "city": "北京",
        "street": "朝阳区"
    }
}`;

    const COMPARE_EXAMPLE_2 = `{
    "name": "李四",
    "age": 30,
    "hobbies": ["足球", "音乐"],
    "address": {
        "city": "上海",
        "street": "浦东新区"
    }
}`;

    function loadCompareExample(which) {
        if (which === 1) {
            $('#compareInput1').value = COMPARE_EXAMPLE_1;
            updatePane('compareInput1');
            toast('示例1已加载', 'success');
        } else {
            $('#compareInput2').value = COMPARE_EXAMPLE_2;
            updatePane('compareInput2');
            toast('示例2已加载', 'success');
        }
    }

    /* ---------------------------------------------------------
     * 8. 工具三：JSON 断言生成
     * ------------------------------------------------------- */

    let assertDebounceTimer = null;

    function getIncludeFilter() {
        return splitFilter($('#assertInclude').value);
    }

    function getExcludeFilter() {
        return splitFilter($('#assertExclude').value);
    }

    function splitFilter(raw) {
        return String(raw || '').trim().split(',').map(key => key.trim()).filter(Boolean);
    }

    function shouldIncludeKey(key, fullPath, includeFilter, excludeFilter) {
        // 内置过滤规则
        if (key === 'pubts' || key === 'tenant' || key.endsWith('id')) {
            return false;
        }

        // 仅保留（优先级最高）
        if (includeFilter.length > 0) {
            if (includeFilter.indexOf(key) > -1) return true;
            for (const filterKey of includeFilter) {
                if (fullPath.includes('.' + filterKey + '.') || fullPath.endsWith('.' + filterKey)) {
                    return true;
                }
            }
            return false;
        }

        // 仅删除
        if (excludeFilter.length > 0) {
            if (excludeFilter.indexOf(key) > -1) return false;
            for (const filterKey of excludeFilter) {
                if (fullPath.includes('.' + filterKey + '.') || fullPath.endsWith('.' + filterKey)) {
                    return false;
                }
            }
            return true;
        }

        return true;
    }

    function generateAssertionsFromJson(json, path) {
        const basePath = path || 'resBody';
        let assertions = '';

        if (typeof json === 'object' && json !== null) {
            if (Array.isArray(json)) {
                // 数组：只断言元素字段，不生成 length 断言
                json.forEach((item, index) => {
                    assertions += generateAssertionsFromJson(item, basePath + '[' + index + ']');
                });
            } else {
                const includeFilter = getIncludeFilter();
                const excludeFilter = getExcludeFilter();

                Object.keys(json).forEach(key => {
                    const value = json[key];
                    const fullPath = basePath + '.' + key;

                    if (!shouldIncludeKey(key, fullPath, includeFilter, excludeFilter)) {
                        // 跳过该键，但对象/数组仍递归处理其子属性
                        if (typeof value === 'object' && value !== null) {
                            assertions += generateAssertionsFromJson(value, fullPath);
                        }
                        return;
                    }

                    if (typeof value === 'string') {
                        assertions += 'assert("' + value + '", ' + fullPath + ', "断言' + key + '");\n';
                    } else if (typeof value === 'number' || typeof value === 'boolean') {
                        assertions += 'assert(' + value + ', ' + fullPath + ', "断言' + key + '");\n';
                    } else if (value === null) {
                        assertions += 'assert(null, ' + fullPath + ', "断言' + key + '");\n';
                    } else {
                        assertions += generateAssertionsFromJson(value, fullPath);
                    }
                });
            }
        }

        return assertions;
    }

    function countAssertions(assertions) {
        return (assertions.match(/assert\(/g) || []).length;
    }

    function updateAssertStatus(status, detail) {
        const text = $('#assertStatusText');
        const detailEl = $('#assertStatusDetail');
        if (text) text.textContent = status;
        if (detailEl) detailEl.textContent = detail || '';
    }

    function runAssert() {
        updatePane('assertInput');
        const input = paneText('assertInput').trim();
        if (!input) {
            updateAssertStatus('就绪', '');
            setPaneText('assertOutput', '', { placeholder: '断言代码将在这里显示…' });
            return;
        }
        try {
            const parsed = parseJsonInput(input).value;
            const assertions = generateAssertionsFromJson(parsed);
            setPaneText('assertOutput', assertions, { placeholder: '断言代码将在这里显示…' });
            updateAssertStatus('完成', '已生成 ' + countAssertions(assertions) + ' 条断言');
        } catch (error) {
            console.error('Assert error:', error);
            updateAssertStatus('错误', 'JSON 转换失败');
            setPaneText('assertOutput', '', { placeholder: 'JSON 解析失败，请检查输入…' });
            toast('JSON 转换失败', 'error');
        }
    }

    function formatAssertJson() {
        const input = paneText('assertInput').trim();
        if (!input) {
            toast('请输入 JSON 字符串', 'warning');
            return;
        }
        try {
            const parsed = parseJsonInput(input).value;
            $('#assertInput').value = JSON.stringify(parsed, null, 4);
            updatePane('assertInput');
            runAssert();
            toast('格式化成功！', 'success');
        } catch (error) {
            toast('JSON 转换失败', 'error');
        }
    }

    function clearAssert() {
        $('#assertInput').value = '';
        setPaneText('assertOutput', '', { placeholder: '断言代码将在这里显示…' });
        updatePane('assertInput');
        updateAssertStatus('就绪', '');
        toast('输入已清空', 'info');
    }

    /* ---------------------------------------------------------
     * 9. 工具四：UID 提取
     * ------------------------------------------------------- */

    const UID_REGEX = /UID:[^\s,"'`#()\[\]{}<>=@|;]+/gi;

    function runUid(button) {
        updatePane('uidInput');
        const input = paneText('uidInput');
        if (!input.trim()) {
            toast('请输入文本内容或上传文件', 'warning');
            return;
        }
        busy(button, true);
        setTimeout(() => {
            try {
                const matches = input.match(UID_REGEX);
                if (matches && matches.length > 0) {
                    const uniqueUIDs = Array.from(new Set(matches)).sort();
                    // 结果一行一个 UID 便于阅读；复制/下载仍是逗号分隔的原始格式
                    setPaneText('uidOutput', uniqueUIDs.join('\n'), {
                        placeholder: '提取到的 UID 将在这里显示…',
                        canonical: uniqueUIDs.join(',')
                    });
                    $('#uidStats').textContent = '已提取: ' + uniqueUIDs.length + ' 个UID';
                    toast('成功提取 ' + uniqueUIDs.length + ' 个 UID', 'success');
                } else {
                    setPaneText('uidOutput', '', { placeholder: '提取到的 UID 将在这里显示…' });
                    $('#uidStats').textContent = '已提取: 0 个UID';
                    toast('未找到以 UID 开头的字符串', 'info');
                }
            } catch (error) {
                console.error('UID 提取错误:', error);
                toast('提取失败，请重试', 'error');
            } finally {
                busy(button, false);
            }
        }, 80);
    }

    function clearUid() {
        $('#uidInput').value = '';
        setPaneText('uidOutput', '', { placeholder: '提取到的 UID 将在这里显示…' });
        $('#uidFileList').innerHTML = '';
        $('#uidFileInput').value = '';
        $('#uidStats').textContent = '已提取: 0 个UID';
        updatePane('uidInput');
        toast('所有输入已清空', 'info');
    }

    /* ---------------------------------------------------------
     * 10. 工具五：批量 ID 替换
     * ------------------------------------------------------- */

    async function runIdReplace(button) {
        updatePane('idReplaceInput');
        const input = paneText('idReplaceInput').trim();
        if (!input) {
            toast('请输入 SQL 语句', 'warning');
            return;
        }
        busy(button, true);
        try {
            const replaced = replaceIdsInSql(input);
            setPaneText('idReplaceOutput', replaced, { placeholder: '替换后的 SQL 将在这里显示…' });
            toast('ID 替换成功！', 'success');
        } catch (error) {
            console.error('ID 替换错误:', error);
            toast(error.message, 'error');
        } finally {
            busy(button, false);
        }
    }

    function replaceIdsInSql(sql) {
        // 匹配形如 ('数字ID', ...) 的模式
        const idPattern = /\('(\d+)',[^)]*\)/g;
        const matches = Array.from(sql.matchAll(idPattern));
        const idCount = matches.length;

        if (idCount === 0) return sql;

        const startInput = $('#startSnowflakeId').value.trim();
        if (!startInput) throw new Error('请输入起始雪花ID');
        if (!/^\d+$/.test(startInput)) throw new Error('起始雪花ID必须是数字');

        const startId = BigInt(startInput);
        const snowflakeIds = [];
        for (let i = 0; i < idCount; i++) {
            snowflakeIds.push((startId + BigInt(i)).toString());
        }

        let currentIndex = 0;
        return sql.replace(idPattern, (match, originalId) => {
            if (currentIndex >= snowflakeIds.length) {
                throw new Error('雪花ID数量不足，无法完成替换');
            }
            const newId = "'" + snowflakeIds[currentIndex] + "'";
            currentIndex++;
            return match.replace("'" + originalId + "'", newId);
        });
    }

    function clearIdReplace() {
        $('#idReplaceInput').value = '';
        setPaneText('idReplaceOutput', '', { placeholder: '替换后的 SQL 将在这里显示…' });
        updatePane('idReplaceInput');
        toast('所有输入已清空', 'info');
    }

    /* ---------------------------------------------------------
     * 11. 工具六：Groovy 提取 SQL
     * ------------------------------------------------------- */

    function cleanSQL(sql) {
        return sql
            .replace(/\r\n/g, '\n')
            .replace(/\n\s+/g, '\n')
            .replace(/\s+/g, ' ')
            .replace(/;\s*$/g, ';')
            .trim();
    }

    function extractSQL(groovyText) {
        const sqlStatements = [];

        // 模式1：helper.execute("""...""") 且以 DELETE / UPDATE 开头
        const executePattern = /helper\.execute\s*\(\s*"""([\s\S]*?)"""\s*\)/g;
        let match;
        while ((match = executePattern.exec(groovyText)) !== null) {
            const sqlContent = match[1].trim();
            if (/^(DELETE|UPDATE)/i.test(sqlContent)) {
                sqlStatements.push(cleanSQL(sqlContent));
            }
        }

        // 模式2：纯 SQL 语句
        const pureSqlPattern = /(?:^|\n)(DELETE|UPDATE)[\s\S]*?;/gmi;
        let sqlMatch;
        while ((sqlMatch = pureSqlPattern.exec(groovyText)) !== null) {
            sqlStatements.push(cleanSQL(sqlMatch[0].trim()));
        }

        return sqlStatements;
    }

    function runGroovy(button) {
        updatePane('groovyInput');
        const input = paneText('groovyInput');
        if (!input.trim()) {
            toast('请输入 Groovy 代码或 SQL 语句', 'warning');
            return;
        }
        busy(button, true);
        setTimeout(() => {
            try {
                const statements = extractSQL(input);
                if (statements.length > 0) {
                    setPaneText('groovyOutput', statements.join('\n\n'), { placeholder: '提取到的 SQL 将在这里显示…' });
                    $('#groovyStats').textContent = '已提取: ' + statements.length + ' 条SQL';
                    toast('成功提取 ' + statements.length + ' 条 SQL 语句', 'success');
                } else {
                    setPaneText('groovyOutput', '', { placeholder: '提取到的 SQL 将在这里显示…' });
                    $('#groovyStats').textContent = '已提取: 0 条SQL';
                    toast('未找到 DELETE 或 UPDATE 语句', 'info');
                }
            } catch (error) {
                console.error('SQL 提取错误:', error);
                toast('提取失败，请重试', 'error');
            } finally {
                busy(button, false);
            }
        }, 80);
    }

    function clearGroovy() {
        $('#groovyInput').value = '';
        setPaneText('groovyOutput', '', { placeholder: '提取到的 SQL 将在这里显示…' });
        $('#groovyFileList').innerHTML = '';
        $('#groovyFileInput').value = '';
        $('#groovyStats').textContent = '已提取: 0 条SQL';
        updatePane('groovyInput');
        toast('所有输入已清空', 'info');
    }

    /* ---------------------------------------------------------
     * 12. 文件上传 / 拖拽
     * ------------------------------------------------------- */

    const VALID_FILE_TYPES = ['.txt', '.json', '.log', '.csv', '.groovy', '.sql'];

    function isValidFileType(file) {
        const name = file.name.toLowerCase();
        return VALID_FILE_TYPES.some(type => name.endsWith(type));
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function setupDropzone(dropzoneId, fileInputId, listId, targetPaneId) {
        const dropzone = $('#' + dropzoneId);
        const fileInput = $('#' + fileInputId);
        const list = $('#' + listId);
        if (!dropzone || !fileInput || !list) return;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => dropzone.classList.add('is-over'));
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, () => dropzone.classList.remove('is-over'));
        });

        dropzone.addEventListener('drop', e => {
            const files = e.dataTransfer && e.dataTransfer.files;
            if (files) handleFiles(files, list, targetPaneId);
        });

        fileInput.addEventListener('change', e => {
            handleFiles(e.target.files, list, targetPaneId);
            fileInput.value = '';
        });

        // 点击上传区（按钮除外）同样可以打开文件选择框
        dropzone.addEventListener('click', e => {
            if (e.target.closest('.link-btn')) return;
            fileInput.click();
        });
    }

    function handleFiles(files, list, targetPaneId) {
        if (!files || !files.length) return;
        Array.from(files).forEach(file => {
            if (isValidFileType(file)) {
                readFileContent(file, list, targetPaneId);
            } else {
                toast('不支持的文件类型: ' + file.name, 'warning');
            }
        });
    }

    function readFileContent(file, list, targetPaneId) {
        const reader = new FileReader();
        reader.onload = e => {
            const content = e.target.result;
            addFileToList(list, file, content);
            appendToInput(content, targetPaneId);
        };
        reader.onerror = () => toast('读取文件失败: ' + file.name, 'error');
        reader.readAsText(file);
    }

    function addFileToList(list, file, content) {
        const item = document.createElement('li');
        item.className = 'file-item';
        item.dataset.content = content;
        item.innerHTML = '<span><span class="file-name">' + escapeHtml(file.name) + '</span>' +
            '<span class="file-size">(' + formatFileSize(file.size) + ')</span></span>' +
            '<button class="file-remove" type="button" aria-label="移除">×</button>';
        item.querySelector('.file-remove').addEventListener('click', () => {
            const content = item.dataset.content;
            item.remove();
            const area = $('#' + targetOf(list.id));
            if (area && content && area.value.indexOf(content) > -1) {
                area.value = area.value.replace(content, '').replace(/\r\n\n+/g, '').trim();
                updatePane(area.id);
            }
        });
        list.appendChild(item);
    }

    function targetOf(listId) {
        return listId === 'uidFileList' ? 'uidInput' : 'groovyInput';
    }

    function appendToInput(content, targetPaneId) {
        const area = $('#' + targetPaneId);
        if (!area) return;
        area.value = area.value ? area.value + '\r\n\r\n' + content : content;
        updatePane(targetPaneId);
        toast('文件已添加到输入区域', 'success');
    }

    /* ---------------------------------------------------------
     * 13. XLSX 解析（浏览器端最小实现：ZIP + SheetML）
     * ------------------------------------------------------- */

    /** 解压 ZIP 条目（存储方式或 deflate） */
    async function unzip(buffer) {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);

        // 定位中央目录结束记录（EOCD）
        let eocd = -1;
        const minPos = Math.max(0, bytes.length - 22 - 65535);
        for (let i = bytes.length - 22; i >= minPos; i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('文件不是有效的 xlsx（未找到 ZIP 结构）');

        const count = view.getUint16(eocd + 10, true);
        let pointer = view.getUint32(eocd + 16, true);
        const decoder = new TextDecoder();
        const entries = [];

        for (let i = 0; i < count; i++) {
            if (view.getUint32(pointer, true) !== 0x02014b50) break;
            const method = view.getUint16(pointer + 10, true);
            const compressedSize = view.getUint32(pointer + 20, true);
            const nameLength = view.getUint16(pointer + 28, true);
            const extraLength = view.getUint16(pointer + 30, true);
            const commentLength = view.getUint16(pointer + 32, true);
            const localOffset = view.getUint32(pointer + 42, true);
            const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
            entries.push({ name, method, compressedSize, localOffset });
            pointer += 46 + nameLength + extraLength + commentLength;
        }

        const files = {};
        for (const entry of entries) {
            const local = entry.localOffset;
            const nameLength = view.getUint16(local + 26, true);
            const extraLength = view.getUint16(local + 28, true);
            const dataStart = local + 30 + nameLength + extraLength;
            const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);

            if (entry.method === 0) {
                files[entry.name] = raw;
            } else if (entry.method === 8) {
                files[entry.name] = await inflateRaw(raw);
            }
        }
        return files;
    }

    async function inflateRaw(data) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('当前浏览器不支持解压 xlsx，请升级到 Chrome 103+ / Edge 103+');
        }
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    function xmlTextOf(bytes) {
        if (!bytes) return '';
        return new TextDecoder('utf-8').decode(bytes);
    }

    function parseXml(text) {
        return new DOMParser().parseFromString(text, 'application/xml');
    }

    function columnIndexFromRef(ref) {
        const letters = String(ref || '').match(/^[A-Z]+/);
        if (!letters) return -1;
        let index = 0;
        for (const char of letters[0]) index = index * 26 + (char.charCodeAt(0) - 64);
        return index - 1;
    }

    function parseSharedStrings(xmlText) {
        if (!xmlText) return [];
        const doc = parseXml(xmlText);
        const nodes = doc.getElementsByTagName('si');
        const list = [];
        for (let i = 0; i < nodes.length; i++) {
            const texts = nodes[i].getElementsByTagName('t');
            let value = '';
            for (let j = 0; j < texts.length; j++) value += texts[j].textContent;
            list.push(value);
        }
        return list;
    }

    /** 找到第一个工作表对应的 XML 文本 */
    function firstSheetXml(files) {
        const workbook = files['xl/workbook.xml'];
        const rels = files['xl/_rels/workbook.xml.rels'];
        if (workbook && rels) {
            const relMap = {};
            const relDoc = parseXml(xmlTextOf(rels));
            const relationships = relDoc.getElementsByTagName('Relationship');
            for (let i = 0; i < relationships.length; i++) {
                relMap[relationships[i].getAttribute('Id')] = relationships[i].getAttribute('Target');
            }
            const workbookDoc = parseXml(xmlTextOf(workbook));
            const sheets = workbookDoc.getElementsByTagName('sheet');
            for (let i = 0; i < sheets.length; i++) {
                const relId = sheets[i].getAttribute('r:id') ||
                    sheets[i].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
                const target = relMap[relId];
                if (!target) continue;
                const path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
                if (files[path]) return xmlTextOf(files[path]);
            }
        }
        const fallback = Object.keys(files)
            .filter(name => /^xl\/worksheets\/.*\.xml$/.test(name))
            .sort()[0];
        return fallback ? xmlTextOf(files[fallback]) : '';
    }

    /** 解析工作表为二维数组 */
    function parseSheet(xmlText, sharedStrings) {
        const doc = parseXml(xmlText);
        const rowNodes = doc.getElementsByTagName('row');
        const rows = [];

        for (let i = 0; i < rowNodes.length; i++) {
            const rowNode = rowNodes[i];
            const cells = [];
            const cellNodes = rowNode.getElementsByTagName('c');
            let autoIndex = 0;

            for (let j = 0; j < cellNodes.length; j++) {
                const cell = cellNodes[j];
                let index = autoIndex;
                const ref = cell.getAttribute('r');
                if (ref) {
                    const parsed = columnIndexFromRef(ref);
                    if (parsed > -1) index = parsed;
                }
                cells[index] = readCell(cell, sharedStrings);
                autoIndex = index + 1;
            }
            rows.push(cells);
        }
        return rows;
    }

    function readCell(cell, sharedStrings) {
        const type = cell.getAttribute('t');
        if (type === 'inlineStr') {
            const inline = cell.getElementsByTagName('is')[0];
            if (!inline) return '';
            const texts = inline.getElementsByTagName('t');
            let value = '';
            for (let i = 0; i < texts.length; i++) value += texts[i].textContent;
            return value;
        }
        const valueNode = cell.getElementsByTagName('v')[0];
        const raw = valueNode ? valueNode.textContent : '';
        if (type === 's') {
            const index = parseInt(raw, 10);
            return isNaN(index) ? '' : (sharedStrings[index] || '');
        }
        if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
        if (type === 'e') return '';
        return raw;
    }

    /** 读取 xlsx 并整理成「表头 + 数据行」结构 */
    async function readBillRuleWorkbook(file) {
        const buffer = await file.arrayBuffer();
        const files = await unzip(buffer);
        const sharedStrings = parseSharedStrings(xmlTextOf(files['xl/sharedStrings.xml']));
        const sheetXml = firstSheetXml(files);
        if (!sheetXml) throw new Error('未在文件中找到工作表');
        const grid = parseSheet(sheetXml, sharedStrings);

        if (!grid.length) throw new Error('工作表是空的');

        const headerRow = grid[0] || [];
        const required = [];
        const columnIndex = {};

        headerRow.forEach((raw, index) => {
            const label = String(raw || '').trim();
            if (!label) return;
            const key = normalizeHeader(label);
            if (!key) return;
            if (label.charAt(0) === '*') required.push({ key, label: '*' + key });
            if (BILL_RULE_EXCEL_COLUMNS.indexOf(key) > -1 && columnIndex[key] === undefined) {
                columnIndex[key] = index;
            }
        });

        const missing = BILL_RULE_EXCEL_COLUMNS.filter(key => columnIndex[key] === undefined);
        if (missing.length) {
            throw new Error('模板缺少必需的列：' + missing.join('、'));
        }

        const rows = [];
        for (let i = 1; i < grid.length; i++) {
            const cells = grid[i] || [];
            const isEmpty = cells.every(cell => cell === undefined || String(cell).trim() === '');
            if (isEmpty) continue;

            const values = {};
            BILL_RULE_EXCEL_COLUMNS.forEach(key => {
                const cell = cells[columnIndex[key]];
                values[key] = cell === undefined || cell === null ? '' : String(cell).trim();
            });
            rows.push({ rowNumber: i + 1, values: values });
        }

        return { required: required, rows: rows };
    }

    function handleBillRuleFiles(files) {
        if (!files || !files.length) return;
        const file = files[0];
        if (!/\.xlsx$/i.test(file.name)) {
            toast('仅支持 .xlsx 格式的模板文件', 'warning');
            return;
        }

        const chip = $('#billRuleFileChip');
        if (chip) chip.textContent = '正在读取…';

        readBillRuleWorkbook(file)
            .then(sheet => {
                billRuleSheet = sheet;
                if (chip) chip.textContent = file.name;
                $('#billRuleStats').textContent = '已读取: ' + sheet.rows.length + ' 行';
                showBillRuleNotice([]);

                const list = $('#billRuleFileList');
                if (list) {
                    list.innerHTML = '';
                    const item = document.createElement('li');
                    item.className = 'file-item';
                    item.innerHTML = '<span><span class="file-name">' + escapeHtml(file.name) +
                        '</span><span class="file-size">(' + formatFileSize(file.size) + ')</span></span>' +
                        '<button class="file-remove" type="button" aria-label="移除">×</button>';
                    item.querySelector('.file-remove').addEventListener('click', () => {
                        item.remove();
                        billRuleSheet = null;
                        if (chip) chip.textContent = '未选择文件';
                        $('#billRuleStats').textContent = '已读取: 0 行';
                    });
                    list.appendChild(item);
                }
                toast('已读取 ' + sheet.rows.length + ' 行数据', 'success');
            })
            .catch(error => {
                console.error('读取 xlsx 失败:', error);
                billRuleSheet = null;
                if (chip) chip.textContent = '未选择文件';
                $('#billRuleStats').textContent = '已读取: 0 行';
                showBillRuleNotice([error.message || '读取文件失败']);
                toast(error.message || '读取文件失败', 'error');
            });
    }

    function setupBillRuleDropzone() {
        const dropzone = $('#billRuleDropzone');
        const fileInput = $('#billRuleFileInput');
        if (!dropzone || !fileInput) return;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
            dropzone.addEventListener(name, e => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        ['dragenter', 'dragover'].forEach(name => {
            dropzone.addEventListener(name, () => dropzone.classList.add('is-over'));
        });
        ['dragleave', 'drop'].forEach(name => {
            dropzone.addEventListener(name, () => dropzone.classList.remove('is-over'));
        });
        dropzone.addEventListener('drop', e => {
            handleBillRuleFiles(e.dataTransfer && e.dataTransfer.files);
        });
        fileInput.addEventListener('change', e => {
            handleBillRuleFiles(e.target.files);
            e.target.value = '';
        });
        dropzone.addEventListener('click', e => {
            if (e.target.closest('.link-btn')) return;
            fileInput.click();
        });
    }

    /** 模板下载入口：保留浏览器默认下载行为，仅提示用户 */
    function setupTemplateDownloads() {
        document.querySelectorAll('[data-template-download]').forEach(link => {
            link.addEventListener('click', () => {
                toast('模板下载已开始', 'success');
            });
        });
    }

    /* ---------------------------------------------------------
     * 14. 工具七：转单规则 SQL 生成
     * ------------------------------------------------------- */

    const BILL_RULE_TABLE = 'iuap_apcom_businesssflow.domain_make_bill_rule_detail';

    /** 参与生成的 Excel 列（表头去掉 * 与括号注释后的名字） */
    const BILL_RULE_EXCEL_COLUMNS = [
        'origin_field', 'target_field', 'mapped_relation', 'mapped_type',
        'child_key', 'parent_key', 'source_child_key', 'source_parent_key',
        'is_business_object', 'micro_service_code'
    ];

    /** 数值型字段：写入 SQL 时不加引号 */
    const BILL_RULE_NUMERIC_COLUMNS = ['mapped_relation', 'mapped_type', 'is_business_object'];

    /** Excel 中未填写时使用的默认值 */
    const BILL_RULE_DEFAULTS = {
        is_business_object: '0',
        micro_service_code: 'yonbip-mm-qms'
    };

    /** is_business_object 填此值时，字段类型列写入 Characteristics */
    const BILL_RULE_BUSINESS_FLAG = '6';
    const BILL_RULE_CHARACTERISTICS = 'Characteristics';

    /**
     * 明细表字段顺序与取值来源
     * row     —— 当前行主键（起始雪花 ID + 行序号）
     * shared  —— 所有行共用的 makebill_id
     * excel   —— 取自 Excel 对应列
     * now     —— 生成时的当前时间
     * const   —— 固定值
     */
    const BILL_RULE_COLUMNS = [
        ['id', 'row'],
        ['makebill_id', 'shared'],
        ['origin_field', 'excel'],
        ['target_field', 'excel'],
        ['mapped_relation', 'excel'],
        ['mapped_type', 'excel'],
        ['calculate_formulas', 'const', null],
        ['origin_key', 'const', 0],
        ['is_write_back', 'const', 0],
        ['write_back_type', 'const', null],
        ['write_back_str', 'const', null],
        ['is_comparefield', 'const', 0],
        ['compare_rule', 'const', null],
        ['is_edit', 'const', 0],
        ['create_time', 'const', null],
        ['modify_time', 'const', null],
        ['creator', 'const', null],
        ['modifier', 'const', null],
        ['is_deleted', 'const', 0],
        ['pubts', 'now'],
        ['sub_id', 'const', 'QMSQIT'],
        ['i_compute_type', 'const', null],
        ['child_key', 'excel'],
        ['is_sys', 'const', 1],
        ['source_child_key', 'excel'],
        ['fullname_ext', 'const', null],
        ['attribute_ext', 'const', null],
        ['field_ext', 'const', null],
        ['relation_key', 'const', null],
        ['ref_field_ext', 'const', null],
        ['is_hidden', 'const', 0],
        ['calculate_formulas_display', 'const', null],
        ['category', 'const', 'QMSQIT'],
        ['target_field_display', 'const', null],
        ['target_field_name', 'const', null],
        ['origin_field_display', 'const', null],
        ['origin_field_name', 'const', null],
        ['target_field_type', 'biztype'],
        ['origin_field_type', 'biztype'],
        ['seq', 'const', null],
        ['target_path', 'const', null],
        ['target_parent_path', 'const', null],
        ['parent_key', 'excel'],
        ['grand_parent_key', 'const', null],
        ['source_path', 'const', null],
        ['source_parent_path', 'const', null],
        ['source_parent_key', 'excel'],
        ['source_grand_parent_key', 'const', null],
        ['origin_field_option', 'const', null],
        ['target_field_option', 'const', null],
        ['is_business_object', 'excel'],
        ['origin_field_resid', 'const', null],
        ['micro_service_code', 'excel'],
        ['applicationCode', 'const', null],
        ['target_field_resid', 'const', null],
        ['target_fileld_resid', 'const', null]
    ];

    /** 当前读取到的模板数据 */
    let billRuleSheet = null;

    function formatNow() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function sqlLiteral(value, numeric) {
        if (value === null || value === undefined || value === '') return 'NULL';
        const text = String(value).trim();
        if (text === '') return 'NULL';
        if (numeric && /^-?\d+(\.\d+)?$/.test(text)) return text;
        return "'" + text.replace(/'/g, "''") + "'";
    }

    /** 去掉表头里的必填标记与括号说明，转成字段名 */
    function normalizeHeader(raw) {
        return String(raw || '')
            .replace(/^\*/, '')
            .replace(/[（(][^）)]*[）)]?$/, '')
            .trim()
            .toLowerCase();
    }

    /** 取单元格的有效值：空值时回落到默认配置 */
    function billRuleCellValue(row, column) {
        const raw = row.values[column];
        const text = (raw === null || raw === undefined) ? '' : String(raw).trim();
        if (text !== '') return text;
        const fallback = BILL_RULE_DEFAULTS[column];
        return fallback === undefined ? '' : fallback;
    }

    function buildBillRuleSql(dataRows, context) {
        const columnList = BILL_RULE_COLUMNS.map(item => item[0]).join(', ');
        const now = formatNow();
        const statements = [];

        dataRows.forEach((row, index) => {
            const isCharacteristics = billRuleCellValue(row, 'is_business_object') === BILL_RULE_BUSINESS_FLAG;

            const values = BILL_RULE_COLUMNS.map(item => {
                const column = item[0];
                const kind = item[1];

                if (kind === 'row') {
                    return sqlLiteral((context.startId + BigInt(index)).toString(), false);
                }
                if (kind === 'shared') {
                    return sqlLiteral(context.makebillId, false);
                }
                if (kind === 'now') {
                    return sqlLiteral(now, false);
                }
                if (kind === 'const') {
                    const constant = item[2];
                    return constant === null || constant === undefined
                        ? 'NULL'
                        : sqlLiteral(constant, typeof constant === 'number');
                }
                if (kind === 'biztype') {
                    // is_business_object 填 6 时，字段类型固定为 Characteristics
                    return isCharacteristics
                        ? sqlLiteral(BILL_RULE_CHARACTERISTICS, false)
                        : 'NULL';
                }

                // excel
                const text = billRuleCellValue(row, column);
                if (text === '') return 'NULL';
                return sqlLiteral(text, BILL_RULE_NUMERIC_COLUMNS.indexOf(column) > -1);
            });

            statements.push(
                'INSERT INTO ' + BILL_RULE_TABLE + '\n(' + columnList + ')\nVALUES(' + values.join(', ') + ');'
            );
        });

        return statements;
    }

    function showBillRuleNotice(messages) {
        const box = $('#billRuleNotice');
        if (!box) return;
        if (!messages || !messages.length) {
            box.textContent = '';
            box.classList.remove('is-show');
            return;
        }
        box.textContent = messages.join('\n');
        box.classList.add('is-show');
    }

    function runBillRule(button) {
        const errors = [];

        const startText = $('#billRuleStartId').value.trim();
        const makebillText = $('#billRuleMakebillId').value.trim();

        if (!startText) errors.push('请填写「起始雪花 ID」');
        else if (!/^\d+$/.test(startText)) errors.push('「起始雪花 ID」必须是数字');
        if (!makebillText) errors.push('请填写「makebill_id（转单规则主表 ID）」');
        else if (!/^\d+$/.test(makebillText)) errors.push('「makebill_id」必须是数字');

        if (!billRuleSheet) errors.push('请先选择转单规则配置模板（.xlsx）');

        if (errors.length) {
            showBillRuleNotice(errors);
            toast(errors[0], 'warning');
            return;
        }

        // 必填项校验：表头带 * 的列必须有值（按行序报告）
        billRuleSheet.rows.forEach(row => {
            billRuleSheet.required.forEach(item => {
                const value = row.values[item.key];
                if (value === null || value === undefined || String(value).trim() === '') {
                    errors.push('第 ' + row.rowNumber + ' 行：' + item.label + ' 为必填项，不能为空');
                }
            });
        });

        if (errors.length) {
            showBillRuleNotice(errors.slice(0, 20));
            toast('共 ' + errors.length + ' 处问题，请修正后再生成', 'error');
            return;
        }

        showBillRuleNotice([]);

        busy(button, true);
        try {
            const statements = buildBillRuleSql(billRuleSheet.rows, {
                startId: BigInt(startText),
                makebillId: makebillText
            });
            setPaneText('billRuleOutput', statements.join('\n\n'), {
                placeholder: '生成的 SQL 将在这里显示…'
            });
            $('#billRuleStats').textContent = '已生成: ' + statements.length + ' 条SQL';
            toast('成功生成 ' + statements.length + ' 条 SQL 语句', 'success');
        } catch (error) {
            console.error('转单规则 SQL 生成错误:', error);
            showBillRuleNotice([error.message || '生成失败']);
            toast('生成失败，请重试', 'error');
        } finally {
            busy(button, false);
        }
    }

    function clearBillRule() {
        $('#billRuleStartId').value = '';
        $('#billRuleMakebillId').value = '';
        $('#billRuleFileInput').value = '';
        $('#billRuleFileList').innerHTML = '';
        $('#billRuleFileChip').textContent = '未选择文件';
        $('#billRuleStats').textContent = '已读取: 0 行';
        setPaneText('billRuleOutput', '', { placeholder: '生成的 SQL 将在这里显示…' });
        billRuleSheet = null;
        showBillRuleNotice([]);
        toast('所有输入已清空', 'info');
    }

    /* ---------------------------------------------------------
     * 15. 事件绑定
     * ------------------------------------------------------- */

    const ACTIONS = {
        'palette.open': openPalette,
        'palette.close': closePalette,

        'format.run': runFormat,
        'format.sort': runFormatSort,
        'format.clear': clearFormat,
        'panel.fullscreen': trigger => {
            const target = trigger.dataset.fullscreenTarget;
            if (target) togglePanelFullscreen(target);
        },
        'format.copy': () => copyText(paneText('formatOutput')),
        'format.download': () => downloadFile('formatted.json', paneText('formatOutput'), 'application/json;charset=utf-8'),

        'compare.run': runCompare,
        'compare.clearHighlight': () => { clearHighlights(); toast('已清除高亮', 'info'); },
        'compare.clearAll': clearCompareInputs,
        'compare.example1': () => loadCompareExample(1),
        'compare.example2': () => loadCompareExample(2),

        'assert.run': runAssert,
        'assert.format': formatAssertJson,
        'assert.clear': clearAssert,
        'assert.copy': () => copyText(paneText('assertOutput')),

        'uid.run': runUid,
        'uid.clear': clearUid,
        'uid.copy': () => copyText(paneText('uidOutput')),
        'uid.download': () => downloadFile('extracted_uids.txt', paneText('uidOutput')),
        'uid.pickFile': () => $('#uidFileInput').click(),

        'idreplace.run': runIdReplace,
        'idreplace.clear': clearIdReplace,
        'idreplace.copy': () => copyText(paneText('idReplaceOutput')),
        'idreplace.download': () => downloadFile('replaced_sql.txt', paneText('idReplaceOutput')),

        'snowflake.pick': trigger => {
            const target = trigger.dataset.snowflakeTarget;
            if (target) pickSnowflakeId(target);
        },

        'groovy.run': runGroovy,
        'groovy.clear': clearGroovy,
        'groovy.copy': () => copyText(paneText('groovyOutput')),
        'groovy.download': () => downloadFile('extracted_sql.txt', paneText('groovyOutput')),
        'groovy.pickFile': () => $('#groovyFileInput').click(),

        'billrule.run': runBillRule,
        'billrule.clear': clearBillRule,
        'billrule.copy': () => copyText(paneText('billRuleOutput')),
        'billrule.download': () => downloadFile('bill_rule_detail.sql', paneText('billRuleOutput'), 'application/sql;charset=utf-8'),
        'billrule.pickFile': () => $('#billRuleFileInput').click()
    };

    function bindEvents() {
        // 通用动作
        document.addEventListener('click', e => {
            const trigger = e.target.closest('[data-action]');
            if (!trigger) return;
            const action = ACTIONS[trigger.dataset.action];
            if (action) {
                e.preventDefault();
                action(trigger);
            }
        });

        // 断言输入防抖自动生成
        $('#assertInput').addEventListener('input', () => {
            clearTimeout(assertDebounceTimer);
            assertDebounceTimer = setTimeout(runAssert, 500);
        });
        $('#assertInclude').addEventListener('input', () => runAssert());
        $('#assertExclude').addEventListener('input', () => runAssert());

        // 主题 / 换行
        $('#themeToggle').addEventListener('click', toggleTheme);
        $('#themeToggleTop').addEventListener('click', toggleTheme);
        $('#wrapToggle').addEventListener('click', () => {
            const next = !document.body.classList.contains('is-wrap');
            applyWrap(next);
            savePrefs({ wrap: next });
        });

        // 命令面板
        $('#paletteBtn').addEventListener('click', openPalette);
        $('#paletteInput').addEventListener('input', e => renderPalette(e.target.value));
        $('#paletteList').addEventListener('click', e => {
            const item = e.target.closest('[data-route]');
            if (!item) return;
            navigate(item.dataset.route);
            closePalette();
        });

        // 移动端侧边栏
        $('#menuBtn').addEventListener('click', openSidebar);
        $('#sidebarScrim').addEventListener('click', closeSidebar);

        // 路由
        window.addEventListener('hashchange', () => applyRoute(currentRoute()));

        // 窗口尺寸变化后折行宽度改变，需要重算行号
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(refreshPanes, 120);
        });

        // 快捷键
        document.addEventListener('keydown', e => {
            const tag = (e.target.tagName || '').toLowerCase();
            const typing = tag === 'input' || tag === 'textarea';

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                openPalette();
                return;
            }
            if (e.key === 'Escape') {
                if (!$('#palette').hidden) { closePalette(); return; }
                if ($('.panel.is-fullscreen')) { closeFullscreenPanel(); return; }
                closeSidebar();
                return;
            }
            if (!$('#palette').hidden) {
                if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); return; }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const item = paletteFiltered[paletteIndex];
                    if (item) { navigate(item.route); closePalette(); }
                    return;
                }
            }
            if (typing) return;
            if (e.ctrlKey && e.shiftKey && /^[1-7]$/.test(e.key)) {
                e.preventDefault();
                navigate(TOOL_ROUTES[Number(e.key) - 1]);
            }
        });

        // Ctrl + Enter 快速执行当前工具的主操作
        document.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
            const route = currentRoute();
            const map = {
                format: 'format.run', compare: 'compare.run', assert: 'assert.run',
                uid: 'uid.run', idreplace: 'idreplace.run', groovy: 'groovy.run',
                billrule: 'billrule.run'
            };
            const action = map[route];
            if (!action) return;
            e.preventDefault();
            const trigger = $('[data-action="' + action + '"]');
            if (trigger) ACTIONS[action](trigger);
        });
    }

    function openSidebar() {
        $('#sidebar').classList.add('is-open');
        $('#sidebarScrim').classList.add('is-open');
    }

    function closeSidebar() {
        const sidebar = $('#sidebar');
        if (!sidebar) return;
        sidebar.classList.remove('is-open');
        $('#sidebarScrim').classList.remove('is-open');
    }

    /* ---------------------------------------------------------
     * 16. 首页演示代码
     * ------------------------------------------------------- */

    const HERO_SAMPLE = {
        code: '1001',
        message: 'success',
        data: {
            inspectOrderId: '1443166316329340928',
            resourceId: 'ef016011-379d-47ef-8017-247c697fe9f4',
            status: 'AUDITED',
            items: [
                { code: 'INSP2026001', qty: 10, pass: true },
                { code: 'INSP2026002', qty: 5, pass: false }
            ]
        }
    };

    function renderHero() {
        const code = $('#heroCode');
        if (code) code.innerHTML = highlightJson(JSON.stringify(HERO_SAMPLE, null, 2));
    }

    /* ---------------------------------------------------------
     * 17. 启动
     * ------------------------------------------------------- */

    function init() {
        const prefs = loadPrefs();
        applyTheme(prefs.theme || 'light');
        applyWrap(!!prefs.wrap);

        initPanes();
        bindEvents();
        renderHero();

        setupDropzone('uidDropzone', 'uidFileInput', 'uidFileList', 'uidInput');
        setupDropzone('groovyDropzone', 'groovyFileInput', 'groovyFileList', 'groovyInput');
        setupBillRuleDropzone();
        setupTemplateDownloads();

        applyRoute(currentRoute());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
