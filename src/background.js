let filter;
let updateFilterPromise;

let _isFxBelow56;
Promise.resolve().then(() => {
  return browser.runtime.getBrowserInfo();
}).then((info) => {
  _isFxBelow56 =
      (info.name === 'Firefox' || info.name === 'Fennec') &&
      parseInt(info.version.match(/^(\d+)\./)[1], 10) < 56;
}).catch((ex) => {
  _isFxBelow56 = false;
});

function updateFilter() {
  return updateFilterPromise = utils.getDefaultOptions().then((options) => {
    filter = new ContentFarmFilter();
    filter.addBlackList(options.userBlacklist);
    filter.addWhiteList(options.userWhitelist);
    const tasks = filter.urlsTextToLines(options.webBlacklists).map(u => filter.addBlackListFromUrl(u));
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

function updateContextMenus() {
  const blockDomain = function (urlOrHostname, tabId, frameId) {
    return new Promise((resolve, reject) => {
      const h = filter.validateRuleLine(urlOrHostname.trim().replace(/\s[\s\S]*$/g, ""));
      chrome.tabs.sendMessage(tabId, {
        cmd: 'blockDomain',
        args: {hostname: h}
      }, {frameId}, resolve);
    }).then((hostname) => {
      if (!hostname) { return; }
      hostname = filter.validateRuleLine(hostname);
      return utils.getOptions({
        userBlacklist: ""
      }).then((options) => {
        let text = options.userBlacklist;
        if (text) { text += "\n"; }
        text = text + hostname;
        return utils.setOptions({
          userBlacklist: text
        });
      });
    });
  };

  utils.getOptions().then(options => {
    const names = options.contextMenusOptions;
    if (names.includes('page')) {
      chrome.contextMenus.create({
        title: utils.lang("blockPage"),
        contexts: ["page"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
        onclick: (info, tab) => {
          return blockDomain(info.pageUrl, tab.id, info.frameId);
        }
      });
    }

    if (names.includes('tab')) {
      try {
        chrome.contextMenus.create({
          title: utils.lang("blockTab"),
          contexts: ["tab"],
          documentUrlPatterns: ["http://*/*", "https://*/*"],
          onclick: (info, tab) => {
            return blockDomain(info.pageUrl, tab.id, 0);
          }
        });
      } catch (ex) {
        // Available only in Firefox >= 53. Otherwise ignore the error.
      }
    }

    if (names.includes('link')) {
      chrome.contextMenus.create({
        title: utils.lang("blockLink"),
        contexts: ["link"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
        onclick: (info, tab) => {
          return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, {
              cmd: 'getLinkHostname'
            }, {frameId: info.frameId}, resolve);
          }).then((redirectedUrl) => {
            const urlOrHostname = redirectedUrl || info.linkUrl;
            return blockDomain(urlOrHostname, tab.id, info.frameId);
          });
        }
      });
    }

    if (names.includes('selection')) {
      chrome.contextMenus.create({
        title: utils.lang("blockSelection"),
        contexts: ["selection"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
        onclick: (info, tab) => {
          return blockDomain(info.selectionText, tab.id, info.frameId);
        }
      });
    }
  })
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  const url = details.url;
  if (filter.isBlocked(url)) {
    const redirectUrl = `${chrome.runtime.getURL('blocked.html')}?to=${encodeURIComponent(url)}`;
    if (details.type === "main_frame") {
      if (!_isFxBelow56) {
        return {redirectUrl: redirectUrl};
      } else {
        // fix for bug in Firefox < 56
        chrome.tabs.update(details.tabId, {url: redirectUrl});
        return {cancel: true};
      }
    } else {
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body>
<img src="${utils.escapeHtml(chrome.runtime.getURL("img/content-farm-marker.svg"))}" alt="" style="width: 1em;"><a href="${utils.escapeHtml(redirectUrl, false)}" target="_blank">${utils.lang("viewBlockedFrame")}</a>
</body>
</html>
`;
      const dataUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent(html);
      return {redirectUrl: dataUrl};
    }
  }
}, {urls: ["*://*/*"], types: ["main_frame", "sub_frame"]}, ["blocking"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.warn("omMessage", message);
  const {cmd, args} = message;
  switch (cmd) {
    case 'isUrlBlocked': {
      const blocked = filter.isBlocked(args.url);
      sendResponse(blocked);
      break;
    }
    case 'getMergedBlacklist': {
      updateFilterPromise.then(() => {
        sendResponse(filter.getMergedBlacklist());
      });
      return true; // async response
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

chrome.storage.onChanged.addListener((changes, areaName) => {
  // Config keys are stored in storage.sync and fallbacks to storage.local;
  // cache keys are stored in storage.local and are valid JSON format.
  // We only update when a config key is changed.
  if (areaName !== "sync") {
    try {
      for (let key in changes) { JSON.parse(key); }
      return;
    } catch(ex) {}
  }
  updateFilter().then(() => {
    if (changes.webBlacklists) {
      filter.clearStaleWebListCache(changes.webBlacklists);
    }
  });
  updateContextMenus();
});

chrome.runtime.onInstalled.addListener((details) => {
  const {reason, previousVersion} = details;

  if (reason === "update" && utils.versionCompare(previousVersion, "2.1.2") === -1) {
    return Promise.resolve().then(() => {
      console.warn("Migrating options from < 2.1.2");
      return utils.getOptions(["webBlacklist", "webBlacklists"]).then((options) => {
        if (options.webBlacklist && (typeof options.webBlacklists === "undefined")) {
          let newWebBlacklists = "https://danny0838.github.io/content-farm-terminator/files/blocklist/content-farms.txt" +
              "\n" + options.webBlacklist;
          return utils.setOptions({webBlacklists: newWebBlacklists}).then(() => {
            updateFilter();
          });
        }
      });
    }).then(() => {
      console.warn("Migrated successfully.");
    });
  }
});

if (chrome.browserAction) {
  chrome.browserAction.onClicked.addListener((tab) => {
    const url = chrome.runtime.getURL("options.html");
    chrome.tabs.create({url: url, active: true});
  });
} else {
  // Firefox Android < 55: no browserAction
  // Fallback to pageAction.
  // Firefox Android ignores the tabId parameter and
  // shows the pageAction for all tabs
  chrome.pageAction.onClicked.addListener((tab) => {
    const url = chrome.runtime.getURL("options.html");
    chrome.tabs.create({url: url, active: true});
  });
  chrome.pageAction.show(0);
}

if (chrome.contextMenus) {
  updateContextMenus();
}

updateFilter();
