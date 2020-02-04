let filter = new ContentFarmFilter();
let updateFilterPromise;
let tempUnblockTabs = new Set();

function updateFilter() {
  return updateFilterPromise = utils.getDefaultOptions().then((options) => {
    const newFilter = new ContentFarmFilter();
    newFilter.addTransformRules(options.transformRules);
    newFilter.addBlackList(options.userBlacklist);
    newFilter.addWhiteList(options.userWhitelist);
    const tasks = newFilter
      .urlsTextToLines(options.webBlacklists)
      .map(u => newFilter.addBlackListFromUrl(u, options.webBlacklistsCacheDuration));
    return Promise.all(tasks).then(() => {
      filter = newFilter;
    });
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

function blockSite(rule, tabId, frameId, quickMode) {
  return new Promise((resolve, reject) => {
    rule = (rule || "").trim();
    rule = filter.parseRuleLine(rule, {validate: true, transform: 'standard', asString: true});

    if (quickMode) {
      resolve(rule);
      return;
    }

    chrome.tabs.sendMessage(tabId, {
      cmd: 'blockSite',
      args: {rule}
    }, {frameId}, resolve);
  }).then((rule) => {
    if (!rule) { return; }

    rule = filter.parseRuleLine(rule, {validate: true, asString: true});

    if (rule && filter.isInBlacklist(rule)) {
      if (quickMode) {
        return;
      }

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
          cmd: 'alert',
          args: {msg: utils.lang("blockSiteDuplicated", rule)}
        }, {frameId}, resolve);
      });
    }

    return utils.getOptions({
      userBlacklist: ""
    }).then((options) => {
      let text = options.userBlacklist;
      if (text) { text += "\n"; }
      text = text + rule;
      return utils.setOptions({
        userBlacklist: text
      });
    }).then(() => {
      if (quickMode) {
        return;
      }

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
          cmd: 'alert',
          args: {msg: utils.lang("blockSiteSuccess", rule)}
        }, {frameId}, resolve);
      });
    });
  });
}

function updateContextMenus() {
  if (!chrome.contextMenus) { return; }

  let quickMode = false;

  const createContextMenuCommands = function () {
    try {
      chrome.contextMenus.create({
        title: utils.lang("blockTab"),
        contexts: ["tab"],
        documentUrlPatterns: ["http://*/*", "https://*/*"],
        onclick: (info, tab) => {
          return blockSite(info.pageUrl, tab.id, 0, quickMode);
        }
      });
    } catch (ex) {
      // Available only in Firefox >= 53. Otherwise ignore the error.
    }

    chrome.contextMenus.create({
      title: utils.lang("blockPage"),
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      onclick: (info, tab) => {
        return blockSite(info.pageUrl, tab.id, info.frameId, quickMode);
      }
    });

    chrome.contextMenus.create({
      title: utils.lang("blockLink"),
      contexts: ["link"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      onclick: (info, tab) => {
        return new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, {
            cmd: 'getRedirectedLinkUrl'
          }, {frameId: info.frameId}, resolve);
        }).then((redirectedUrl) => {
          const rule = redirectedUrl || info.linkUrl;
          return blockSite(rule, tab.id, info.frameId, quickMode);
        });
      }
    });

    chrome.contextMenus.create({
      title: utils.lang("blockSelection"),
      contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      onclick: (info, tab) => {
        return blockSite(info.selectionText, tab.id, info.frameId, quickMode);
      }
    });
  };

  chrome.contextMenus.removeAll(() => {
    utils.getDefaultOptions().then((options) => {
      if (options.showContextMenuCommands) {
        createContextMenuCommands();
      }
      quickMode = options.quickContextMenuCommands;
    });
  });
}

function onBeforeRequestBlocker(details) {
  // check if this tab is temporarily unblocked
  if (tempUnblockTabs.has(details.tabId)) {
    return;
  }

  const url = details.url;
  const blockType = filter.isBlocked(url);
  if (!blockType) { return; }

  if (details.type === "main_frame") {
    const redirectUrl = utils.getBlockedPageUrl(url, blockType, false);

    // Firefox < 56 does not allow redirecting to an extension page
    // even if it is listed in web_accessible_resources.
    // Using data URI with meta or script refresh works but generates
    // an extra history entry.
    if (utils.userAgent.soup.has('firefox') && utils.userAgent.major < 56) {
      chrome.tabs.update(details.tabId, {url: redirectUrl});
      return {cancel: true};
    }

    return {redirectUrl: redirectUrl};
  } else {
    const redirectUrl = utils.getBlockedPageUrl(url, blockType, true);
    return {redirectUrl: redirectUrl};
  }
};

/**
 * Return a Promise to defer web requests until updateFilter is done so that
 * they are filtered properly for supported browsers.
 * (Firefox >= 52, but not Firefox Android <= 64.* (and upper?))
 *
 * This will be replaced by onBeforeRequestBlocker as long as updateFilter
 * is done.
 */
let onBeforeRequestCallback = function (details) {
  return updateFilterPromise.then(() => {
    return onBeforeRequestBlocker(details);
  });
};

chrome.webRequest.onBeforeRequest.addListener((details) => {
  return onBeforeRequestCallback(details);
}, {urls: ["*://*/*"], types: ["main_frame", "sub_frame"]}, ["blocking"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.warn("omMessage", message);
  const {cmd, args} = message;
  switch (cmd) {
    case 'isUrlBlocked': {
      updateFilterPromise.then(() => {
        const blockType = filter.isBlocked(args.url);
        sendResponse(blockType);
      });
      return true; // async response
      break;
    }
    case 'isTempUnblocked': {
      sendResponse(tempUnblockTabs.has(sender.tab.id));
      break;
    }
    case 'tempUnblock': {
      const tabId = sender.tab.id;
      utils.getOptions([
        "tempUnblockDuration",
        "tempUnblockCountdownBase",
        "tempUnblockCountdownIncrement",
        "tempUnblockCountdownReset",
        "tempUnblockCountdown",
        "tempUnblockLastAccess",
      ]).then((options) => {
        // temporarily unblock the tab
        tempUnblockTabs.add(tabId);
        setTimeout(() => {
          tempUnblockTabs.delete(tabId);
        }, options.tempUnblockDuration);
        sendResponse(true);

        // update countdown
        if (options.tempUnblockLastAccess < 0 ||
            Date.now() - options.tempUnblockLastAccess > options.tempUnblockCountdownReset) {
          options.tempUnblockCountdown = -1;
        }

        if (options.tempUnblockCountdown === -1) {
          options.tempUnblockCountdown = options.tempUnblockCountdownBase;
        }

        options.tempUnblockCountdown += options.tempUnblockCountdownIncrement;
        options.tempUnblockLastAccess = Date.now();

        return utils.setOptions({
          tempUnblockCountdown: options.tempUnblockCountdown,
          tempUnblockLastAccess: options.tempUnblockLastAccess,
        });
      });
      return true; // async response
      break;
    }
    case 'getMergedBlacklist': {
      updateFilterPromise.then(() => {
        sendResponse(filter.getMergedBlacklist());
      });
      return true; // async response
      break;
    }
    case 'updateOptions': {
      const validator = new ContentFarmFilter();
      args.transformRules = validator.validateTransformRulesText(args.transformRules);
      validator.addTransformRules(args.transformRules);
      args.userBlacklist = validator.validateRulesText(args.userBlacklist, 'url');
      args.userWhitelist = validator.validateRulesText(args.userWhitelist, 'url');
      utils.setOptions(args).then(() => {
        sendResponse(true);
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
  // We only take action when at least one config key is changed.
  if (areaName !== "sync") {
    // skip if it's a storage.local.remove() rather than a real user modification
    for (let key in changes) {
      if (!("newValue" in changes[key])) { return; }
      break;
    }

    // skip if no config key is changed
    try {
      for (let key in changes) { JSON.parse(key); }
      return;
    } catch(ex) {}
  }

  if ("showContextMenuCommands" in changes || "quickContextMenuCommands" in changes) {
    updateContextMenus();
  }

  updateFilter().then(() => {
    // @TODO:
    // Say we have a shift from local to sync:
    //
    //     local {webBlacklists: "list1\nlist2"} => sync {webBlacklists: "list1"}
    //     sync  {webBlacklists: ""}
    //
    // We get a change of sync: "" => "list1" and a change of local: "list1\nlist2" => undefined,
    // and the cache of list2 is not cleared, while it should be, leaving staled cache not cleared.
    if (changes.webBlacklists) {
      filter.clearStaleWebListCache(changes.webBlacklists);
    }
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  const {reason, previousVersion} = details;

  if (reason === "update" && utils.versionCompare(previousVersion, "2.1.2") === -1) {
    return Promise.resolve().then(() => {
      console.warn("Migrating options from < 2.1.2");
      return utils.getOptions({
        "webBlacklist": undefined,
        "webBlacklists": undefined,
      }).then((options) => {
        if (options.webBlacklist && (typeof options.webBlacklists === "undefined")) {
          let newWebBlacklists = utils.defaultOptions.webBlacklists + "\n" + options.webBlacklist;
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

if (chrome.history) {
  chrome.history.onVisited.addListener((result) => {
    // suppress extension pages from generating a history entry
    if (result.url.startsWith(chrome.runtime.getURL(""))) {
      chrome.history.deleteUrl({url: result.url});
    }
  });
}

if (chrome.browserAction) {
  chrome.browserAction.onClicked.addListener((tab) => {
    let url;
    try {
      const refUrlObj = new URL(tab.url);
      if (!(refUrlObj.protocol === 'http:' || refUrlObj.protocol === 'https:')) {
        throw new Error('URL not under http(s) protocol.');
      }
      const refUrl = utils.getNormalizedUrl(refUrlObj);
      url = chrome.runtime.getURL("options.html") + `?from=${encodeURIComponent(refUrl)}`;
    } catch (ex) {
      url = chrome.runtime.getURL("options.html");
    }
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

updateContextMenus();

updateFilter().then(() => {
  onBeforeRequestCallback = onBeforeRequestBlocker;
  return utils.getOptions([
    "webBlacklistsUpdateInterval",
  ]).then((options) => {
    setInterval(updateFilter, options.webBlacklistsUpdateInterval);
  });
});
