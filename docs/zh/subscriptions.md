---
lang: zh
---
終結內容農場後台資料庫
======================

## 內容農場網路黑名單

使用方法：複製黑名單的連結網址，貼到[「終結內容農場」瀏覽器套件](./)選項的網路黑名單列表。

* [標準內容農場清單](../files/blocklist/content-farms.txt)：「終結內容農場」的預設網路黑名單。收錄網站以「大量盜用原創內容」及「堆砌關鍵詞欺騙搜尋引擎」為主要判定原則，其他如「未妥善標示來源的大量轉載」、「無篩選編輯的大量轉載」、「大量網站複本」、「大量社群導流」、「過去有內容農場行為」、「隱匿作者及經營者的資訊」、「缺乏完整文章列表、RSS 等正常內容網站應有的索引功能」等等，也作為輔助判定原則。我們也會參考 [Google 對垃圾網站的描述](https://support.google.com/webmasters/answer/35769?hl=zh-Hant) 調整判斷原則。

* [類內容農場清單](../files/blocklist/nearly-content-farms.txt)：類似內容農場的網站，例如疑似大量盜用圖文但尚未找到明確證據，或者有相當比例主題性或原創性的網站。這些網站通常品質良莠不齊、常見誇大的標題與貧乏的內容，也可能曾被一些評論者認定為內容農場。此清單篩選較為主觀且可能有爭議，請自行甄酌使用，有疑惑可先參見清單中的註解。

* [社群內容農場清單](../files/blocklist/sns-content-farms.txt)：內容農場相關的社群網站頁面，例如大量分享、導流內容農場的臉書粉絲團，或盜用他人文章剪輯成影片的 Youtube 帳號等。由於社群網站架構因素，可能無法涵蓋所有相關頁面。

* [假新聞網站清單](../files/blocklist/fake-news.txt): 假新聞網站清單，整併自 [<s>Fake News Alert</s>](https://github.com/bfeldman/fake-site-alert)、[<s>Fake News Guard</s>](https://www.fakenewsguard.com/)、[Fake news detector](https://chrome.google.com/webstore/detail/fake-news-detector/aebaikmeedenaijgjcfmndfknoobahep)、[Real or Satire](https://realorsatire.com/)。備查。

* [詐騙網站清單](../files/blocklist/scam-sites.txt): 詐騙網站清單，取自 Chrome 擴充功能「[詐騙網站及內容農場評價系統](https://chrome.google.com/webstore/detail/%E8%A9%90%E9%A8%99%E7%B6%B2%E7%AB%99%E5%8F%8A%E5%85%A7%E5%AE%B9%E8%BE%B2%E5%A0%B4%E8%A9%95%E5%83%B9%E7%B3%BB%E7%B5%B1/mpeppilpojkpjkplhihbcfapmlnlkckb)」。備查。

上述黑名單亦提供 [uBlock Origin](./subscriptions-ubo)、[uBlacklist](./subscriptions-ublacklist)、及 [hosts 檔案](./subscriptions-hosts)版本。

## 網址轉換規則清單

使用方法：進入清單，複製想用的轉換規則，貼到[「終結內容農場」瀏覽器套件](./)選項的網址轉換規則。

* [標準內容農場規則清單](../files/url-transform-rules/content-farms.txt)

* [社群內容農場規則清單](../files/url-transform-rules/sns-content-farms.txt)
