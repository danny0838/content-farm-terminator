var filter;

var _isFxBelow56;
Promise.resolve().then(() => {
  return browser.runtime.getBrowserInfo();
}).then((info) => {
  _isFxBelow56 = (info.name === 'Firefox' || info.name === 'Fennec') &&
      parseInt(info.version.match(/^(\d+)\./)[1], 10) < 56;
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
    let tasks = filter.rulesTextToLines(lists.webBlacklist).map((url) => {
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
    if (details.type === "main_frame") {
      if (!_isFxBelow56) {
        return {redirectUrl: redirectUrl};
      } else {
        // fix for bug in Firefox < 56
        chrome.tabs.update(details.tabId, {url: redirectUrl});
        return {cancel: true};
      }
    } else {
      let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body>
<img src="${utils.escapeHtml(chrome.runtime.getURL("img/content-farm-marker.svg"))}" alt="" style="width: 1em;"><a href="${utils.escapeHtml(redirectUrl, false)}" target="_blank">${utils.lang("viewBlockedFrame")}</a>
</body>
</html>
`;
      let dataUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent(html);
      return {redirectUrl: dataUrl};
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
    case 'closeTab': {
      Promise.resolve().then(() => {
        if (args.tabId) { return [args.tabId]; }
        return new Promise((resolve, reject) => {
          chrome.tabs.query({
            active: true,
            currentWindow: true
          }, resolve);
        }).then((tabs) => {
          return tabs.map(x => x.id);
        });
      }).then((tabIds) => {
        return new Promise((resolve, reject) => {
          chrome.tabs.remove(tabIds, resolve);
        });
      });
      sendResponse(true);
      break;
    }
  }
});

if (chrome.browserAction) {
  chrome.browserAction.onClicked.addListener((tab) => {
    var url = chrome.runtime.getURL("options.html");
    chrome.tabs.create({url: url, active: true});
  });
} else {
  // Firefox Android < 55: no browserAction
  // Fallback to pageAction.
  // Firefox Android ignores the tabId parameter and
  // shows the pageAction for all tabs
  chrome.pageAction.onClicked.addListener((tab) => {
    var url = chrome.runtime.getURL("options.html");
    chrome.tabs.create({url: url, active: true});
  });
  chrome.pageAction.show(0);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  updateFilter();
});

updateFilter();
