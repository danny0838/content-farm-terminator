終結內容農場 (Content Farm Terminator)
======================================

「幾十億人都驚呆了！！！！」

常看到這種標題嗎？它們多半來自內容農場。

[內容農場](https://zh.wikipedia.org/wiki/%E5%85%A7%E5%AE%B9%E8%BE%B2%E5%A0%B4)（[Content Farm](https://en.wikipedia.org/wiki/Content_farm)）是為賺取廣告收益而不擇手段的網站，他們會雇用寫手或撰寫程式四處抄襲、剪貼、拼湊出大量品質不穩定的網路文章。他們用聳動而失真的標題吸引點閱，同時以人工和機器堆砌熱門關鍵詞欺騙搜尋引擎，久之搜尋結果前段塞滿了他們的垃圾，真正相關資訊則被埋沒。

內容農場對創作者有害，因為他們盜文、盜譯、盜圖、盜哏，且不附出處，使真正投注心力的原創者得不到應有報償。

內容農場對閱聽人有害，因為它們發布的內容粗製濫造、缺乏求證，甚至自行腦補、無中生有，內容錯誤也不負責，是謠言的大溫床。

抵制內容農場的唯一做法是不閱讀、不點連結、不點讚、不分享，不要讓他們賺到廣告收益、網站流量及搜尋引擎排名。然而內容農場乍看之下往往不易辨識，有時難免點錯，網頁打開才發現中計。

本瀏覽器套件就是為了解決以上問題而生，它有以下功能：
1. 自動偵測前往內容農場的連結並加以標示，讓你在第一時間避開內容農場，同時免於將點擊數回饋給搜尋引擎。
2. 在即將進入內容農場時予以封鎖，讓你能及時離開。
3. 若真的很想看一下被封鎖的頁面，可點擊「檢視」瀏覽去除廣告與程式碼的網頁內容，如此既能滿足好奇心又不致給對方收益。
4. 可自訂黑名單及白名單，也能從網路上取得黑名單。
5. 可透過右鍵選單將超連結或選取文字對應的網域快速加入黑名單。

本套件支援 Firefox 桌面版和手機版以及 Chromium 系瀏覽器，主要參考 [Chrome](https://chrome.google.com/webstore/detail/content-farm-blocker/opjaibbmmpldcncnbbglondckfnokfpm) 及 [Firefox](https://addons.mozilla.org/firefox/addon/block-content-farm) 的《封鎖內容農場》重製而成，並借鑑及整合了 [Personal Blocklist](https://chrome.google.com/webstore/detail/personal-blocklist-by-goo/nolijncfnkgaikbjbdaogikpmpbdcdef)、[Hide Unwanted Results of Google Search](https://addons.mozilla.org/firefox/addon/hide-unwanted-results-of-go/)、[Google Hit Hider by Domain](https://greasyfork.org/scripts/1682-google-hit-hider-by-domain-search-filter-block-sites)、[Web of Trust](https://chrome.google.com/webstore/detail/wot-web-of-trust-website/bhmmomiinigofkjcapegjjndpbikblnp)、[內容農場檢查器](https://play.google.com/store/apps/details?id=hk.collaction.contentfarmblocker)、[詐騙網站及內容農場評價系統](https://chrome.google.com/webstore/detail/mpeppilpojkpjkplhihbcfapmlnlkckb)、[OpenFact](https://chrome.google.com/webstore/detail/openfact/jbmgeongeghaeobkhibolfghncafeicp) 等類似工具的主要功能與封鎖名單。版本更新記錄詳見[這裡](https://github.com/danny0838/content-farm-terminator/blob/master/RELEASES.md)，預設及其他網路黑名單可參考[這裡](https://github.com/danny0838/content-farm-terminator/tree/gh-pages)。

## 下載及安裝

* [Chrome 擴充功能](https://chrome.google.com/webstore/detail/content-farm-terminator/lcghoajegeldpfkfaejegfobkapnemjl)

* [Firefox 附加元件](https://addons.mozilla.org/firefox/addon/content-farm-terminator/)

> 目前因 Chrome 商店突然要審核本擴充功能，導致暫時下架，審核通過前無法下載安裝。
> 
> 如要使用，可下載最新版原始碼，並以「載入未封裝擴充功能」的方式安裝：
>
> 1. 進入[版本庫的 Release 頁面](https://github.com/danny0838/content-farm-terminator/releases)，下載欲安裝版本的壓縮包（zip 或 tar.gz 皆可），解壓縮至任意資料夾。
>
> 2. 進入 **Chrome > [更多工具] > [擴充功能]**，勾選最上面的「**開發人員模式**」，之後會顯示幾個指令，點擊「**載入未封裝擴充功能**」，選擇方才**解壓縮之資料夾之 `src` 子資料夾**，即可載入及使用此擴充功能。
>
> * 以此方式安裝的擴充功能，功能與權限無任何差異，但**設定值會和由 Chrome 商店正式下載安裝的分開**，必須手動轉移。
>
> 要審核的原因可能是新版本增加了 unlimitedStorage 權限的要求，此權限是為了讓使用者可以儲存超過 5MB 的設定值。本程式不收集使用者資訊，不在背景建立網路連線（除了取得使用者指定之網路黑名單以外），原始程式碼也完全公開，如有疑慮可自行查證。
