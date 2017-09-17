var filter;

var _isFxBelow56;
Promise.resolve().then(() => {
  return browser.runtime.getBrowserInfo();
}).then((info) => {
  if (info.name === 'Firefox') {
    /^(\d+)\./.test(info.version);
    _isFxBelow56 = parseInt(RegExp.$1, 10) < 56;
  } else {
    throw new Error('invalid');
  }
}).catch((ex) => {
  _isFxBelow56 = false;
});

function updateFilter() {
  return utils.getOptions({
    userBlacklist: "",
    userWhitelist: "",
    webBlacklist: ""
  }).then((lists) => {
    filter = new ContentFarmFilter();
    filter.addBlackList(lists.userBlacklist);
    filter.addWhiteList(lists.userWhitelist);
    let tasks = filter.parseRulesText(lists.webBlacklist).map((url) => {
      return filter.addBlackListFromUrl(url);
    });
    tasks.push(filter.addBuiltinBlackList());
    return Promise.all(tasks);
  }).then(() => {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({}, resolve);
    }).then((tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          cmd: 'updateContent'
        });
      });
    });
  }).catch((ex) => {
    console.error(ex);
  });
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  var url = details.url;
  if (filter.isBlocked(url)) {
    let redirectUrl = `${chrome.runtime.getURL('blocked.html')}?to=${encodeURIComponent(url)}`;
    if (!_isFxBelow56) {
      return {redirectUrl: redirectUrl};
    } else {
      // fix for bug in Firefox < 56
      if (details.type === "main_frame") {
        chrome.tabs.update(details.tabId, {url: redirectUrl});
        return {cancel: true};
      } else {
        let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
a {
  background: no-repeat left/1em url("${utils.escapeHtml(chrome.runtime.getURL("img/content-farm-marker.svg"))}");
  padding-left: 1em;
}
</style>
</head>
<body>
<a href="${utils.escapeHtml(redirectUrl, false)}" target="_blank">View blocked page</a>
</body>
</html>
`;
        let dataUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent(html);
        return {redirectUrl: dataUrl};
      }
    }
  }
}, {urls: ["*://*/*"], types: ["main_frame", "sub_frame"]}, ["blocking"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.warn("omMessage", message);
  var {cmd, args} = message;
  switch (cmd) {
    case 'isUrlBlocked': {
      let blocked = filter.isBlocked(args.url);
      sendResponse(blocked);
      break;
    }
    case 'unblockTemp': {
      filter.unblockTemp(args.hostname);
      sendResponse(true);
      break;
    }
    case 'closeTab': {
      new Promise((resolve, reject) => {
        chrome.tabs.query({
          active: true,
          currentWindow: true
        }, resolve);
      }).then((tabs) => {
        return new Promise((resolve, reject) => {
          chrome.tabs.remove(tabs.map(x => x.id), resolve);
        });
      });
      sendResponse(true);
      break;
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    updateFilter();
  }
});

updateFilter();
