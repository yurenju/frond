# monorepo，以及 frond-react 這個 unstyled 元件層

> **Status: superseded（2026-07-30）** —— `@yurenju/frond-react` 收掉，repo 塌回單一
> 套件。取代它的是 [ADR-0008](0008-distribution-and-license.md) 的修訂與
> [ADR-0002](0002-frond-owns-facts-spine-owns-policy.md) 的修訂。
>
> 這份 ADR 的立論靠兩個前提，兩個都不成立了：一是「frond 不只服務 spine」（現在的前提是
> frond 就是為 spine 而做），二是「frond-react 是出貨面而不是消費端」——出貨面的價值在於
> 有人收貨，而唯一的消費端 spine 從來沒有 import 過它一行。1137 行沒有真實使用者在守，
> 而它的 `paging.ts` 與 spine 的 `navigator.ts` + `touch.ts` 是同一件事的兩份實作。
>
> 原文保留在下面，因為它記錄的那個推論本身是對的：**出貨面該跟核心住在一起，消費端不該。**
> 錯的是把 frond-react 判給了前者。
>
> **〈兩個套件的邊界，機器守得住〉那一節仍然有效**，不在作廢範圍內。零相依的三道機制
> （`"types": []`、`"paths": {}`、`finish-build.ts` 從宣告推導放行清單）守的是核心套件
> 本身，塌回單一套件之後照樣要守——只有路徑會變。

repo 改成 **npm workspaces 的 monorepo**，`packages/` 底下兩個套件：

```
packages/frond/         @yurenju/frond         零相依，原樣不動
packages/frond-react/   @yurenju/frond-react   React 元件，peer 相依 react 與 frond
```

`tests/`、`scripts/`、`site/`、`docs/` 留在根目錄，兩個 test runner 也留在根目錄
（ADR-0009 不變，仍然是兩個）。

## 為什麼是 monorepo，而 ADR-0008 拒絕的那個不是

ADR-0008 有一句「明確拒絕併入 spine 的 monorepo」，理由是 frond 的設計前提是「它不只
服務 spine」，而住在一起會讓抄近路變得太容易。

**這一次的方向相反。** frond-react 不是另一個消費端，它是 frond 的一個**出貨面**：
它沒有自己的領域知識，沒有自己的正確性標準，它的每一次改動都是為了把 frond 已經有
的能力接到 React 上。放在別的 repo 只會讓兩件事發生——版本要對版（`0.4.0` 的
frond-react 要不要跟 `0.4.0` 的 frond 一起發？），以及 frond 的公開面缺口要跨 repo
才發現得了。

那個缺口是具體的：接 frond-react 的第一天就逼出 `RendererListeners` 沒有從
`renderer/index.ts` 出去——`RendererOptions.on` 用了它，消費端卻叫不出它的名字。同一
個 repo 裡那是一行修改，跨 repo 是一次發版。

## 兩個套件的邊界，機器守得住

`packages/frond` 的零相依不是靠 review 維持的，有三道：

1. `packages/frond/tsconfig.build.json` 的 `"types": []`——import 了 `node:*` 就紅。
2. 同一份設定的 `"paths": {}`——清掉根 `tsconfig.json` 那個 dev-time 的對應，於是這個
   套件的模組圖裡**沒有任何 bare specifier 解析得開**，連一條只在 repo 內成立的捷徑
   都沒有。
3. `scripts/finish-build.ts` 掃 `dist/`，放行清單**從該套件的 `dependencies` 與
   `peerDependencies` 推導**，不是手寫的。frond 兩者皆空，所以規則對它讀作「一個
   bare specifier 都不行」——與這條檢查原本的樣子完全相同。

第三道的形狀是這次唯一實質改過的東西，而改法值得記下來：手寫的放行清單會腐爛，而且
腐爛的方向永遠是「放太寬」——沒有人會在移除一個相依之後回來收窄它。從宣告推導之後，
「出貨產物 import 的東西」與「package.json 說它相依的東西」被綁成同一件事。

frond-react 那一邊，同一條規則讀作「只能 import 你宣告過的東西」：偷偷長出第三個相依
一樣紅在 build。目前它的出貨模組圖裡只有 `react`（含 `react/jsx-runtime`）與
`@yurenju/frond`，兩者都是 peer。

## frond-react 是什麼形狀

**Radix / base-ui 那一種**：一組可以自由組合的 unstyled 零件，外觀完全由 CSS 決定。

```tsx
import * as Reader from "@yurenju/frond-react";

<Reader.Root book={book} settings={{ fontSize: 18 }}>
  <Reader.Viewport className="page" />
  <Reader.PreviousTrigger>前一頁</Reader.PreviousTrigger>
  <Reader.Progress className="bar" />
  <Reader.NextTrigger>下一頁</Reader.NextTrigger>
</Reader.Root>
```

`Root` **不渲染任何元素**，連一個 `<div>` 都沒有——它只擁有 `Renderer` 的生命週期並
把狀態放進 context。多一層 wrapper 就多一個消費端要對付的 box，而 grid 與 flex 的版
面對「中間多一層」特別敏感。

真正的公開面因此是 `useReader()`：另外四個零件都只是「它回傳的東西 + 一個元素 + 一
組 `data-*` 屬性」。要畫一個這裡沒有的東西（自訂的定位軸、章名列、書籤按鈕）時走那
條路，不必等我們多出一個零件。

### CSS 只到 iframe 為止，而那條界線是硬的

書渲染在 iframe 內（ADR-0006），**外面的 CSS 進不去**。所以「unstyled、用 CSS 改外觀」
在這裡天然被切成兩半：

| 改什麼 | 走哪裡 |
| --- | --- |
| viewport 的尺寸形狀、工具列、按鈕、進度條 | `className` + `data-*` 屬性 |
| 字級、行高、邊界、單欄雙欄、主題 | `<Root settings={…}>` |

第二列上面壓著 ADR-0003 的權威順序（讀者設定 > frond 修正 > 書的宣告），而**繞過它
就等於繞過那個順序**。所以這一層刻意不開「把任意 CSS 注入 iframe」的口子：那會在
ADR-0003 的封閉介入清單旁邊開一條沒有清單的通道，而之後「書為什麼長這樣」會變得查
不出來。

`Viewport` 因此是一個**盒子**，不是一張紙。

### 預設樣式：出，但整份包在 `:where()` 裡

`@yurenju/frond-react/styles.css` 是可選的。不 import 的話零件一條宣告都不帶。

它整份包在 `:where()` 裡，優先權是 0——消費端最普通的一條 class 規則就蓋得過去，不必
`!important`，也不必在意兩份 stylesheet 誰先載入。**那是它能夠叫做「可選」的技術條
件**：優先權不是 0 的預設樣式，實際上是一份你得先對付掉才能開始的東西。

這件事由 `tests/browser/react/styles.spec.ts` 釘住，因為它是靠選擇器寫法維持的，而
CSS 不會為破功報任何錯。

## 政策：預設關，可選開

ADR-0002 劃的是「frond 核心不做政策」。frond-react 提供 `useKeyboardPaging()` 與
`useSwipePaging()`，**要顯式 import 才會生效**——`Root` 不會偷偷幫你叫，沒有叫它們的
reader 一個手勢都不吃。

那一節的完整理由寫在 ADR-0002 的〈React 層的政策〉。

## 代價

**`npm install github:yurenju/frond#<tag>` 這條路死了。** git dependency 指的是 repo
根目錄，而根目錄現在是一個 `private: true` 的 workspace 容器，裝不出東西來。npm 是唯
一的安裝方式了。

這個代價可以接受，因為 ADR-0008 已經把 git dependency 從「建議的安裝方式」降級成「還
走得通的舊路」。但它從「還走得通」變成「不通」是這次的實質變化，所以寫在這裡。

**必須先 build frond 才 build 得了 frond-react。** 所以根 `package.json` 的 `build` 把
順序寫死，沒有用 `npm run build --workspaces`——那個旗標不保證拓樸順序。

**frond-react 需要打包器。** `react` 在 npm 上出的是 CommonJS，瀏覽器載不動，所以
`tests/browser/react/support/harness.ts` 與展示站的第二頁都用了 esbuild
（devDependency，不進任何一個套件的出貨面）。

這不是把「不需要打包器」那個性質弄丟了——那個性質從來只屬於 frond，而展示站的兩頁
現在各自守著一件事：

| 頁面 | 建置方式 | 它證明什麼 |
| --- | --- | --- |
| `site/index.html` | 複製 `dist/`，**沒有打包步驟** | frond 的產物瀏覽器直接 import 得動 |
| `site/react/index.html` | esbuild，零設定 | frond-react 出貨的那包東西，被一個一般的打包器吃下去跑得動 |

第二列不是第一列的弱化版，它問的是另一個問題。frond-react 的消費端一定有打包器，所
以對它該問的不是「能不能不打包」。而那一頁**走 node_modules 解析**（不像測試 harness
那樣 alias 回 `src/`），所以它抓得到只在出貨產物上成立的錯——`exports` 路徑打錯、
`files` 漏東西、emit 少一個副檔名。理由完整寫在 `scripts/bundle-site-react.ts` 的
檔頭。

那一頁還把兩個設計主張做成了現場可切的開關（預設樣式、政策 hook），各自有測試守著
（`tests/browser/site/react-demo.spec.ts`）——一句「樣式是可選的」讀起來像場面話，一
個切下去就變樣的開關不是。
