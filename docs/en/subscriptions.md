---
lang: en
---
Database of Content Farm Terminator
===================================

## Web blacklists

Usage: Copy the link of a blacklist and paste into the web blacklists field in the option page of [Content Farm Terminator browser extension](./).

* [Content farm list](../files/blocklist/content-farms.txt): The blacklist subscribed by default. This includes most general content farms characterized mainly by massive plagiarism and keyword stuffing. The criteria may also be updated with regard to [Google's description of spam sites](https://support.google.com/webmasters/answer/35769?hl=en).

* [Nearly content farm list](../files/blocklist/nearly-content-farms.txt): Sites that look like a content farm. This includes suspected and borderline content farms and may be rather subjective. Check the comments in the list and exclude unwanted rules/sites using the graylist/whitelist on demand. Not recommended for a user without debugging capability.

* [Extra content farm list](../files/blocklist/extra-content-farms.txt): Extra sites that look like a content farm. This list is mainly aggregated from third-party sources and may be subjective, and some rules may duplicate other lists. Not recommended for a user without debugging capability.

* [Bad cloner list](../files/blocklist/bad-cloners.txt): Sites that clones data from Wikipedia, Stack Overflow, GitHub, etc. Although the contents are mostly licensed, these sites do not add any value for them, and are thus considered spams in some point of view.

* [SNS content farm list](../files/blocklist/sns-content-farms.txt): Content farm related social network system (SNS) pages. Which may share content farm contents extensively. Due to the nature of SNS, this may not cover all related pages.

* [Fake news list](../files/blocklist/fake-news.txt): A list of fake news sites organized from [<s>Fake News Alert</s>](https://github.com/bfeldman/fake-site-alert), [<s>Fake News Guard</s>](https://www.fakenewsguard.com/), [Fake news detector](https://chrome.google.com/webstore/detail/fake-news-detector/aebaikmeedenaijgjcfmndfknoobahep), [Real or Satire](https://realorsatire.com/). (NOT actively maintained. For reference. Not recommended for a user without debugging capability.)

* [Scam sites list](../files/blocklist/scam-sites.txt): A list of scam sites organized from the database of [Scam Web and Content Farm Filter and Critic](https://chrome.google.com/webstore/detail/%E8%A9%90%E9%A8%99%E7%B6%B2%E7%AB%99%E5%8F%8A%E5%85%A7%E5%AE%B9%E8%BE%B2%E5%A0%B4%E8%A9%95%E5%83%B9%E7%B3%BB%E7%B5%B1/mpeppilpojkpjkplhihbcfapmlnlkckb) Chrome extension. (NOT actively maintained. For reference. Not recommended for a user without debugging capability.)

There are also [uBlock Origin](./subscriptions-ubo), [uBlacklist](./subscriptions-ublacklist), and [hosts file](./subscriptions-hosts) version of the above blacklists.

## URL transformation rules

Usage: Copy the desired rules from a list and paste into the URL transformation rules field in the option page of [Content Farm Terminator browser extension](./).

* [Content farm rules](../files/url-transform-rules/content-farms.txt)

* [SNS content farm rules](../files/url-transform-rules/sns-content-farms.txt)
