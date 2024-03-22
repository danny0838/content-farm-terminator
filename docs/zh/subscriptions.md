---
lang: zh
---
終結內容農場後台資料庫
======================

## 內容農場網路黑名單

使用方法：複製黑名單的連結網址，貼到[「終結內容農場」瀏覽器套件](./)選項的網路黑名單列表。

* [標準內容農場清單](../files/blocklist/content-farms.txt)：「終結內容農場」的預設網路黑名單。收錄網站以「大量盜用原創內容」及「堆砌關鍵詞欺騙搜尋引擎」為主要判定原則，其他如「未妥善標示來源的大量轉載」、「無篩選編輯的大量轉載」、「大量網站複本」、「大量社群導流」、「過去有內容農場行為」、「隱匿作者及經營者的資訊」、「缺乏完整文章列表、RSS 等正常內容網站應有的索引功能」等等，也作為輔助判定原則。我們也會參考 [Google 對垃圾網站的描述](https://support.google.com/webmasters/answer/35769?hl=zh-Hant) 調整判斷原則。

* [類內容農場清單](../files/blocklist/nearly-content-farms.txt)：類似內容農場的網站，例如疑似大量盜用圖文但尚未找到明確證據，或者有相當比例主題性或原創性的網站。這些網站通常品質良莠不齊、常見誇大的標題與貧乏的內容，或曾被一些評論者認定為內容農場。此清單篩選較主觀且可能包含從其他角度來看正常的網站，請參見清單中的註解並擅用灰名單、白名單去除不想要的規則或網站，不建議無篩選及除錯能力者使用。

* [擴充內容農場清單](../files/blocklist/extra-content-farms.txt)：擴充內容農場網站。此清單主要聚合自外部來源，可能較激進或包含從其他角度來看正常的網站，部分規則可能與其他清單重疊，不建議無篩選及除錯能力者使用。

* [劣質複製農場清單](../files/blocklist/bad-cloners.txt)：使用機器爬取維基百科、Stack Overflow、GitHub 等網站資料重製而成。此類網站爬取的資料多符合開放授權，但只提供了機器、劣質翻譯或些微介面變化，缺少附加價值，某方面可視為垃圾網站。

* [社群內容農場清單](../files/blocklist/sns-content-farms.txt)：內容農場相關的社群網站頁面，例如大量分享、導流內容農場的臉書粉絲團，或盜用他人文章剪輯成影片的 Youtube 帳號等。由於社群網站架構因素，可能無法涵蓋所有相關頁面。

* [詐騙網站清單](../files/blocklist/scam-sites.txt): 詐騙網站清單。此清單主要聚合自政府資料，如數位發展部及165全民防騙網整理的詐騙網站名單。

* [假新聞網站清單](../files/blocklist/fake-news.txt): 假新聞網站清單，整併自 [<s>Fake News Alert</s>](https://github.com/bfeldman/fake-site-alert)、[<s>Fake News Guard</s>](https://www.fakenewsguard.com/)、[Fake news detector](https://chrome.google.com/webstore/detail/fake-news-detector/aebaikmeedenaijgjcfmndfknoobahep)、[Real or Satire](https://realorsatire.com/)。（目前未積極維護，僅供備查，不建議無篩選及除錯能力者使用。）

上述黑名單亦提供 [uBlock Origin](./subscriptions-ubo)、[uBlacklist](./subscriptions-ublacklist)、及 [hosts 檔案](./subscriptions-hosts)版本。

## 網址轉換規則清單

使用方法：進入清單，複製想用的轉換規則，貼到[「終結內容農場」瀏覽器套件](./)選項的網址轉換規則。

* [標準內容農場規則清單](../files/url-transform-rules/content-farms.txt)

* [社群內容農場規則清單](../files/url-transform-rules/sns-content-farms.txt)
