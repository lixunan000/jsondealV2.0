# JsonDeal · 开发者效率工具箱

一个常用小工具集合：JSON 格式化、JSON 对比、断言代码生成、UID 提取、批量 ID 替换、Groovy SQL 提取、转单规则 SQL 生成。

- 无构建、无依赖、无后端 —— 双击 `index.html` 即可运行
- 所有处理在浏览器本地完成，数据不会离开你的机器
- 支持浅色 / 深色主题、响应式布局、命令面板与快捷键

---

## 快速开始

直接双击 `index.html`（或右键 →「用浏览器打开」）。

> 建议使用 Chrome / Edge 等现代浏览器。页面使用 `file://` 协议打开也可以正常工作（未使用 ES Module，因此不受跨域限制）。

目录结构：

```
jsondeal-main2/
├─ index.html          # 单页应用外壳：侧边栏、顶栏、7 个视图
├─ assets/
│  ├─ app.js           # 全部逻辑（IIFE，无全局污染）
│  ├─ styles.css       # 设计令牌 + 组件样式 + 响应式
│  ├─ favicon.svg      # 站点图标
│  └─ bill-rule-template.xlsx   # 转单规则配置模板（页面可下载）
└─ README.md
```

---

## 功能一览

| 工具 | 路由 | 说明 |
| --- | --- | --- |
| 总览 | `#/home` | 仪表盘：工具卡片、能力统计、实时预览 |
| JSON 格式化 | `#/format` | 校验并美化 JSON，输出 4 空格缩进的规范格式，语法高亮 |
| JSON 对比 | `#/compare` | 深度比较两个 JSON，差异按「新增 / 删除 / 修改」分组，行级高亮在原文上 |
| JSON 断言生成 | `#/assert` | 根据接口响应 JSON 生成 `assert(...)` 断言代码，支持只保留 / 只排除某些字段 |
| UID 提取 | `#/uid` | 提取以 `UID:` 开头的唯一标识符，自动去重排序 |
| 批量 ID 替换 | `#/idreplace` | 把 SQL 中的数字 ID 替换为连续的雪花 ID（起始值可指定） |
| Groovy 提取 SQL | `#/groovy` | 从 Groovy 代码中提取 Update / Delete 语句 |
| 转单规则 SQL | `#/billrule` | 读取转单规则配置 Excel，逐行生成可直接执行的 INSERT 语句 |

### JSON 格式化
粘贴 JSON 后点击「格式化」即可。输出区带 JSON 语法着色（键名 / 字符串 / 数字 / 布尔 / null 各自配色），可直接复制或下载。JSON 不合法时会在提示条中给出错误信息。

### JSON 对比
左右各粘贴一份 JSON，点击「对比」：

- 差异按类型分组统计（新增字段 / 删除字段 / 值修改），两侧面板头部实时显示计数
- 每一处差异都会在对应文本行上以背景色高亮，修改类差异高亮到**双方**文本
- 下方「对比结果详情」按类型分组列出每一处差异，并可一键载入示例对比

### JSON 断言生成
输入接口响应 JSON，自动生成断言代码：

```js
assert("张三", resBody.name, "断言name");
assert(25, resBody.age, "断言age");
```

- 只断言**字段值**，不会生成 `length` 断言
- 数组按 `resBody[0].field` 形式逐项展开
- 内置跳过 `pubts`、`tenant` 以及以 `id` 结尾的字段
- 支持「只保留某些字段」与「排除某些字段」两种过滤模式（逗号分隔）

### UID 提取
从日志或文件中提取 UID：

```
InspectOrderRes.java@line[1739]@resId[UID:P_QMSQIT-BE_2487BBFA04880035]=@exit[资源ID不存在]
```

提取结果为 `UID:P_QMSQIT-BE_2487BBFA04880035` —— 遇到空白、引号、逗号、括号、`=`、`@`、`|`、`;` 等分隔符即结束，不会把尾随日志内容带进来。结果自动去重并排序。

结果区**一行一个 UID** 展示，方便逐条核对；点「复制」或「下载」得到的仍是**逗号分隔**的原始格式。

### 批量 ID 替换
输入起始雪花 ID 与 SQL 文本，工具会把 SQL 中的数字 ID 按出现顺序替换为 `起始值 + 1`、`+ 2`…… 结果可复制或下载为 `.sql` 文件。

### Groovy 提取 SQL
从 Groovy 源码中提取 `UPDATE` / `DELETE` 语句，支持三引号、多行与单行写法。

### 转单规则 SQL
上传转单规则配置 Excel（`.xlsx`），工具会读取表头与数据行，为**每一行**生成一条可直接执行的 `INSERT` 语句：

```sql
INSERT INTO iuap_apcom_businesssflow.domain_make_bill_rule_detail
(id, makebill_id, ..., target_fileld_resid)
VALUES('2664164640452771946', '2664164073513418780', 'define20', ..., NULL);
```

生成规则：

| 项 | 规则 |
| --- | --- |
| `id` | 界面上填写「起始雪花 ID」，逐行自增（起始值、起始值 + 1、第 N 行 = 起始值 + N - 1），用 `BigInt` 计算不丢精度 |
| `makebill_id` | 界面上填写一次，所有行共用 |
| 首行带红色 `*` 的列 | **必填**，为空时生成前逐行提示「第 N 行：xxx 为必填项，不能为空」，不会产出半成品 SQL |
| 其他非必填列 | 为空时写入 `NULL` |
| `is_business_object`（J 列） | 默认 `0`，用户填写则用用户的值；**填 `6` 时**，`target_field_type` 与 `origin_field_type` 自动写入字符串 `Characteristics` |
| `micro_service_code`（K 列） | 默认 `yonbip-mm-qms`，用户填写则用用户的值 |
| `pubts` | 生成时刻的 `yyyy-MM-dd HH:mm:ss` |
| 「target 字段中文」列 | 仅供人阅读，**不写入** SQL |

- Excel 在浏览器内解析（不依赖任何第三方库），支持拖拽或点击选择文件
- 页面右上角「下载模板」可获取官方模板 `转单规则配置模板.xlsx`（位于 `assets/bill-rule-template.xlsx`），下载后直接填写再上传即可
- 生成的 SQL 可复制或下载为 `.sql` 文件，逐条独立执行

---

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl` + `K` | 打开命令面板（输入关键字搜索工具，回车跳转） |
| `Ctrl` + `Shift` + `1` ~ `7` | 快速切换到第 1~7 个工具 |
| `Ctrl` + `Enter` | 执行当前页面的主操作（格式化 / 对比 / 断言 / 提取 / 替换 / 生成 SQL） |
| `Esc` | 关闭命令面板 |

---

## 界面说明

- **侧边栏**：工具导航 + `⇧1`~`⇧7` 快捷键角标；窄屏下自动收起为顶栏菜单按钮
- **顶栏**：当前工具标题与说明、换行开关、命令面板入口、主题切换
- **工作区**：左侧输入、右侧输出，两侧独立滚动；输入区带行号栏
- **结果区始终自动换行**：长 SQL / 长 JSON 不用横向滚动即可读完；行号会按折行后的实际行数自动对齐
- **顶栏「自动换行」**：控制输入区的折行（结果区始终换行）
- **主题**：右上角一键切换，选择结果记在 `localStorage`，下次打开自动恢复
- **提示条**：右下角浮出，成功 / 失败 / 警告各有配色

---

## 技术说明

- 纯 HTML + CSS + JavaScript，classic `<script>` 引入，**不使用 ES Module / 打包器**，保证 `file://` 直开可用
- 路由基于 `location.hash`（`#/format` 等），刷新后停留在当前工具
- 样式基于 CSS 自定义属性（设计令牌），深色主题通过 `<html data-theme="dark">` 覆盖令牌实现
- JSON 语法高亮由一个轻量分词器完成（`tok-key` / `tok-str` / `tok-num` / `tok-bool` / `tok-null`）
- 行号栏绝对定位，不参与容器高度计算 —— 左侧内容再多也不会把右侧面板和下方按钮撑出屏幕
- 对比高亮采用「透明 textarea 覆盖层 + 同步滚动」方案，保留原生编辑体验
- 雪花 ID 使用 `BigInt` 计算，避免大整数精度丢失
- Excel 解析为自研实现：读取 ZIP 中央目录 → `DecompressionStream('deflate-raw')` 解压 → `DOMParser` 解析 `workbook.xml` / `sharedStrings.xml` / `sheet1.xml`，不引入任何第三方库

---

## 浏览器要求

Chrome / Edge / Firefox / Safari 近两年版本均可。仅使用 `matchAll`、`BigInt`、`localStorage`、`FileReader` 等标准特性。
