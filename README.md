Content Farm Terminator (終結內容農場)
======================================

*Content Farm Terminator* is a cross-platform browser extension that helps the user identify and repel [content farms](https://en.wikipedia.org/wiki/Content_farm), through marking hyperlinks that targets a content farm in any web page and blocking web requests that targets a content farm.

[Homepage with more detailed introduction](https://danny0838.github.io/content-farm-terminator/).

## Download
* [Firefox](https://addons.mozilla.org/firefox/addon/content-farm-terminator/) (also: Firefox for Android, Tor Browser, etc.)
* [Google Chrome](https://chrome.google.com/webstore/detail/lcghoajegeldpfkfaejegfobkapnemjl) (also: Opera, Vilvadi, Brave, Kiwi Browser, etc.)
* [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/fgckcfkpckemdnnejbbfkkchanedbeje)

## For content farm reporters
To report a content farm to be included in our blacklist, fill the form through the hyerlink at the bottom of the option page of the browser extension, or through [this link](https://danny0838.github.io/content-farm-terminator/report).

## For web blacklist providers
To publish a web blacklist for subscription, host a plain text file encoded using UTF-8 at a public accessible URL. You can also help us improve [our web blacklists](https://danny0838.github.io/content-farm-terminator/subscriptions) at the `src/` directory of the `gh_pages` branch.

## For developers
The source code of the browser extension is placed at the `src/` directory of the `master` branch. Simply change the code and run a building script under `build/`, and the packed extension files will be generated under `dist/`.

## License
Content Farm Terminator is licensed under [GNU General Public License v3.0](https://github.com/danny0838/content-farm-terminator/blob/master/LICENSE.txt).
