# 十字路口 Crossing — Design System

> AI 可读的设计规范文档。将此文件放入项目根目录，AI agent 即可按照此规范生成一致风格的 UI。

## Visual Theme

**风格**: 清新自然、专业工具感。以森林绿为主色，白色卡片 + 浅灰背景，追求简洁有序。  
**调性**: 专业但不冰冷，紧凑但不拥挤，功能优先但注重细节。  
**品牌**: 十字路口 Crossing — 内容工具产品线。

---

## Color Palette

### Primary (Green)

| Token | Value | Usage |
|-------|-------|-------|
| `--green` | `#407600` | 主色、按钮、激活态、链接 |
| `--green-dark` | `#356200` | 按钮 hover、渐变深色端 |
| `--green-light` | `#f4f9ed` | 成功背景、选中态背景 |
| `--green-border` | `#c5e0a5` | 选中边框、hover 边框 |
| 渐变（按钮） | `linear-gradient(135deg, #407600, #4a8800)` | 主要按钮 |
| 渐变（Header） | `linear-gradient(135deg, #356200, #407600, #4a8800)` | 顶部导航栏 |

### Neutral

| Token | Value | Usage |
|-------|-------|-------|
| `--dark` | `#1a1a1a` | 正文文字 |
| `--gray` | `#666` | 次要文字、标签 |
| `--gray-light` | `#f7f7f7` | 浅灰背景、hover 态 |
| `--border` | `#e5e5e5` | 边框、分割线 |
| 页面背景 | `#f0f2f5` | body 背景 |
| 卡片背景 | `#fff` | 卡片、弹窗 |

### Semantic

| Color | Value | Usage |
|-------|-------|-------|
| 错误/危险 | `#d32` / `#ff4d4f` | 错误文字 / 危险按钮 |
| 错误背景 | `#fff0f0` / `#fef2f2` | 错误提示背景 |
| 成功 | `#16a34a` | 成功文字 |
| 成功背景 | `#ecfdf5` | 成功标签背景 |
| 信息/加载 | `#1a6` | 加载态文字 |
| 信息背景 | `#f0f7ff` | 加载态背景 |

---

## Typography

### Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
/* 代码/日志 */
font-family: 'SF Mono', Monaco, Consolas, monospace;
```

### Scale

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| H1 | 22px | 700 | 页面主标题 |
| H2 | 17px | 700 | 卡片标题 |
| H3 | 14px | 700 | 卡片子标题 |
| Body | 14px | 400 | 正文 |
| Button | 15px | 600 | 主要按钮 |
| Label | 12px | 600 | 表单标签（uppercase, letter-spacing: .5px） |
| Small | 13px | 400 | 辅助文字、状态栏 |
| Table Header | 11px | 600 | 表头（uppercase, letter-spacing: .3px） |
| Tag | 11px | 500 | 标签、徽章 |
| Tiny | 10px | 400 | 移动端底栏文字 |

### Mobile Overrides

| Level | Desktop | Mobile (≤640px) |
|-------|---------|-----------------|
| H1 | 22px | 19px |
| H2 | 17px | 16px |
| H3 | 14px | 13px |
| Input | 14px | 15-16px（防 iOS 缩放） |
| Button | 15px | 16px |

---

## Spacing

### Scale（常用值）

`2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 32 · 40 · 48 · 56 · 80`

### Component Spacing

| Component | Padding | Gap |
|-----------|---------|-----|
| 卡片（桌面） | 28px | — |
| 卡片（移动） | 18px 16px | — |
| 按钮 | 14px（主按钮），8px 16px（小按钮） | 4-6px（icon+text） |
| 输入框 | 10px 14px | — |
| Header | 0 24px（桌面），0 16px（移动） | 16px（桌面），10px（移动） |
| 列表项 | 10px 14px | 10px |
| 弹窗 | 32px 28px 24px | 10px（按钮间） |
| 标签页 | 0 20px | 6px（icon+text） |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `8px` | 默认（按钮、输入框、状态栏） |
| Small | `4px` | 小元素（代码块、分页按钮） |
| Medium | `10-12px` | 卡片、标签、移动端元素 |
| Large | `14-16px` | 弹窗、登录卡片 |
| XL | `20px` | 移动端底部弹窗 |
| Circle | `50%` | 圆形元素（步骤点、头像） |

---

## Shadows

| Level | Value | Usage |
|-------|-------|-------|
| 1 — Subtle | `0 1px 4px rgba(0,0,0,.06)` | 卡片默认 |
| 2 — Medium | `0 2px 8px rgba(64,118,0,.25)` | 按钮、Header |
| 3 — Large | `0 4px 20px rgba(64,118,0,.3)` | 按钮 hover |
| 4 — XL | `0 8px 32px rgba(64,118,0,.1)` | 登录卡片 |
| 5 — Modal | `0 12px 48px rgba(0,0,0,.15)` | 弹窗 |

---

## Components

### Buttons

**主要按钮（Primary）**
```css
background: linear-gradient(135deg, #407600, #4a8800);
color: #fff; padding: 14px; font-size: 15px; font-weight: 600;
border: none; border-radius: 8px; cursor: pointer;
box-shadow: 0 2px 8px rgba(64,118,0,.25);
/* Hover */ background: linear-gradient(135deg, #356200, #407600);
/* Icon + text */ display: inline-flex; align-items: center; gap: 6px;
```

**文字按钮（Text）**
```css
background: none; border: none; color: rgba(255,255,255,.5);
font-size: 13px; cursor: pointer; display: inline-flex; gap: 4px;
/* Hover */ color: #fff;
```

**危险按钮（Danger）**
```css
background: #ff4d4f; color: #fff; padding: 10px;
border: none; border-radius: 8px; font-weight: 600;
/* Hover */ background: #e03e3e;
```

**删除按钮（Delete/Outline）**
```css
padding: 4px 10px; border: 1px solid #ddd; border-radius: 4px;
background: #fff; color: var(--gray); font-size: 12px;
display: inline-flex; gap: 4px;
/* Hover */ border-color: #d32; color: #d32; background: #fff5f5;
```

**所有按钮共有**：`transition: all .2s`，icon 在 text 前面，使用 Lucide 风格 SVG（16px）。

### Inputs

```css
width: 100%; padding: 10px 14px; border: 1px solid var(--border);
border-radius: 8px; font-size: 14px; font-family: inherit; outline: none;
transition: border .2s;
/* Focus */ border-color: var(--green);
/* URL 输入框加强版 */ border: 2px solid; border-radius: 10px; padding: 14px 16px;
/* Focus */ box-shadow: 0 0 0 3px rgba(64,118,0,.1);
```

### Labels

```css
display: block; font-size: 12px; font-weight: 600;
color: var(--gray); margin-bottom: 5px;
text-transform: uppercase; letter-spacing: .5px;
```

### Cards

```css
background: #fff; border-radius: 12px; padding: 28px;
box-shadow: 0 1px 4px rgba(0,0,0,.06);
/* Mobile */ padding: 18px 16px; border-radius: 10px;
```

### Tags / Badges

```css
padding: 2px 10px; border-radius: 12px; font-size: 11px;
font-weight: 500; display: inline-flex; gap: 4px;
/* 成功 */ background: #ecfdf5; color: #16a34a;
/* 错误 */ background: #fef2f2; color: #dc2626;
/* 中性 */ background: #f5f5f5; color: #888;
```

### Status Bar

```css
padding: 12px 16px; border-radius: 8px; font-size: 13px;
/* 加载 */ background: #f0f7ff; color: #1a6;
/* 成功 */ background: var(--green-light); color: var(--green);
/* 错误 */ background: #fff0f0; color: #c00;
```

### Modal

```css
/* Overlay */ position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 8000;
/* Box */ background: #fff; border-radius: 14px; padding: 32px 28px 24px;
box-shadow: 0 12px 48px rgba(0,0,0,.15); max-width: 360px; width: 90%;
/* 入场动画 */ transform: scale(.9) → scale(1); transition: transform .2s;
```

### Tables

```css
width: 100%; border-collapse: collapse; font-size: 12px;
/* th */ padding: 8px; border-bottom: 2px solid var(--border);
        font-size: 11px; font-weight: 600; text-transform: uppercase;
/* td */ padding: 8px; border-bottom: 1px solid var(--gray-light);
/* Row hover */ background: #fafffe;
```

### List Items

```css
display: flex; align-items: center; justify-content: space-between;
padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px;
margin-bottom: 8px; transition: border .2s;
/* Hover */ border-color: var(--green-border);
```

---

## Header / Navigation

### Desktop Header
```css
height: 56px; position: sticky; top: 0; z-index: 100;
background: linear-gradient(135deg, #356200, #407600, #4a8800);
box-shadow: 0 2px 8px rgba(64,118,0,.2);
padding: 0 24px; display: flex; align-items: center; justify-content: space-between;
color: #fff;
```

### Logo
```css
width: 32px; height: 32px; border-radius: 8px;
/* 品牌名 */ font-size: 16px; font-weight: 700; color: #fff;
```

### Tab Navigation
```css
display: flex; margin-left: 32px; height: 56px;
/* Tab button */ padding: 0 20px; font-size: 14px;
color: rgba(255,255,255,.5); border-bottom: 3px solid transparent;
display: flex; align-items: center; gap: 6px;
/* Active */ color: #fff; border-bottom-color: #fff; font-weight: 600;
/* Hover */ color: rgba(255,255,255,.8);
```

### Mobile Bottom Tab Bar
```css
position: fixed; bottom: 0; left: 0; right: 0;
height: calc(56px + env(safe-area-inset-bottom));
padding-bottom: env(safe-area-inset-bottom);
background: #fff; border-top: 1px solid var(--border); z-index: 200;
display: flex;
/* Tab */ flex: 1; flex-direction: column; align-items: center;
color: #999; font-size: 10px; gap: 2px;
/* Active */ color: var(--green); font-weight: 600;
/* Icon */ width: 22px; height: 22px;
```

---

## Layout

### Desktop
```css
max-width: 1200px; margin: 24px auto; padding: 0 24px;
display: flex; gap: 20px;
/* 左栏 */ flex: 0 0 420px;
/* 右栏 */ flex: 1;
```

### Grid (Preview Cards)
```css
display: grid; gap: 20px;
grid-template-columns: repeat(3, 1fr);   /* Desktop */
grid-template-columns: repeat(2, 1fr);   /* ≤1100px */
grid-template-columns: 1fr;              /* ≤640px */
```

### Mobile (≤640px)
- 内容改为纵向堆叠
- 底部预留 80px 空间（给 Tab Bar）
- 所有内边距减小（28px → 16px）
- 隐藏桌面 Tab，显示底部 Tab Bar
- 表格切换为卡片列表

---

## Animations

### Transitions
```css
/* 默认 */ transition: all .2s;
/* 按钮 */ transition: all .25s;
/* 弹窗 */ transition: transform .2s;
/* 进度条 */ transition: width .4s ease;
/* 输入框 */ transition: border .2s;
```

### Keyframes

```css
/* 浮动动画（装饰用） */
@keyframes plg-float {
  0%,100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
/* 3s ease-in-out infinite */

/* 移动端底部弹窗 */
@keyframes sheetUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
/* .3s ease */
```

---

## Icons

使用 **Lucide** 图标库（SVG inline），通过 `data-lucide` 属性引用。

- 标准尺寸：16px（按钮内）、22px（移动端 Tab）、40px（弹窗图标）
- 颜色继承父元素 `color`
- stroke-width: 2（默认）
- 放在文字前面，gap: 4-6px

---

## Design Guardrails

### DO
- 按钮必须有 icon + 文字，icon 在前
- 所有可交互元素有 hover/focus 态
- 表单输入框 focus 时绿色边框
- 使用 CSS 变量保持一致性
- 卡片内容分区用 H2/H3 标题 + 底部分割线
- 移动端最小可点击区域 44px
- 输入框移动端 font-size ≥ 16px（防 iOS 缩放）

### DON'T
- 不使用纯文字按钮（除链接外，按钮都要带 icon）
- 不使用圆角超过 16px 的桌面元素
- 不使用深色/暗色主题
- 不使用阴影大于 Level 5
- 不使用非系统字体（保持加载速度）
- 不在 Header 使用纯色背景（必须用渐变）
- 不省略移动端底部安全区域 padding

---

## Agent Prompt Guide

当使用此设计系统构建 UI 时：

1. **配色**：主色 `#407600`，所有交互元素使用绿色系。背景用 `#f0f2f5`，卡片用白色。
2. **按钮**：渐变绿底 + 白色 icon/文字，hover 时加深。所有按钮 icon 在前。
3. **卡片**：白底、12px 圆角、极轻阴影 `rgba(0,0,0,.06)`。
4. **输入框**：灰色边框 8px 圆角，focus 时边框变绿。
5. **标签文字**：12px、大写、灰色、600 weight、letter-spacing .5px。
6. **Header**：三色渐变绿、白色文字/图标、56px 高、sticky 定位。
7. **移动端**：底部 Tab Bar 替代顶部 Tab，卡片缩小内边距，表格变卡片列表。
8. **状态**：成功=绿色系，错误=红色系，加载=蓝色系，中性=灰色系。
9. **动效**：所有过渡 .2s，按钮 hover 轻微上移，弹窗 scale 入场。
10. **间距**：遵循 4px 倍数，常用 8/12/16/20/24/28。
