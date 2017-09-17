var filter;

function updateFilter() {
  return utils.getOptions({
    userBlacklist: "",
    userWhitelist: ""
  }).then((lists) => {
    filter = new ContentFarmFilter();
    filter.addBlackList(lists.userBlacklist);
    filter.addWhiteList(lists.userWhitelist);
    return filter.addBuiltinBlackList();
  }).catch((ex) => {
    console.error(ex);
  });
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  var url = details.url;
  if (filter.isBlocked(url)) {
    let redirectUrl = `${chrome.runtime.getURL('blocked.html')}?to=${encodeURIComponent(url)}`;
    return {redirectUrl: redirectUrl};
  }
}, {urls: ["*://*/*"], types: ["main_frame", "sub_frame"]}, ["blocking"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.warn("omMessage", message);
  var {cmd, args} = message;
  switch (cmd) {
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
