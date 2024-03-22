---
lang: zh
---
hosts 黑名單
============

使用方法：將黑名單內容複製貼到 [hosts 檔案](https://zh.wikipedia.org/wiki/Hosts%E6%96%87%E4%BB%B6)（需要系統管理員權限）。
- Windows 系統路徑： `%SystemRoot%\System32\drivers\etc\hosts`。
- 類 Unix 系統路徑： `/etc/hosts`。

也可以考慮使用 [hosts 工具](https://github.com/StevenBlack/hosts) 以便從多個來源更新 hosts 檔案。

由於 hosts 檔案只能封鎖網域（及子網域），這些黑名單不含其他封鎖規則。

各名單之詳細說明請見[後台資料庫主頁](./subscriptions)。

## 黑名單列表
* [標準內容農場清單](../files/blocklist-hosts/content-farms.txt)
* [類內容農場清單](../files/blocklist-hosts/nearly-content-farms.txt)
* [擴充內容農場清單](../files/blocklist-hosts/extra-content-farms.txt)
* [劣質複製農場清單](../files/blocklist-hosts/bad-cloners.txt)
* [詐騙網站清單](../files/blocklist-hosts/scam-sites.txt)
* [假新聞網站清單](../files/blocklist-hosts/fake-news.txt)
