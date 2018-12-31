const urlObj = new URL(location.href);
const sourceUrl = urlObj.searchParams.get('to');

function recheckBlock() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      cmd: 'isTempUnblocked',
      args: {},
    }, resolve);
  }).then((isTempUnblocked) => {
    // skip further check if this tab is temporarily unblocked
    if (isTempUnblocked) { return false; }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        cmd: 'isUrlBlocked',
        args: {url: sourceUrl}
      }, resolve);
    });
  }).then((isBlocked) => {
    if (!isBlocked) {
      location.replace(sourceUrl);
    }
  });
}

document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  try {
    const sourceUrlObj = new URL(sourceUrl);
    if (urlObj.searchParams.get('type') == 2) {
      const url = utils.getNormalizedUrl(sourceUrlObj);
      const elem = document.createElement('span');
      elem.textContent = url;
      elem.style.fontSize = '0.8em';
      document.querySelector('#warningUrl').appendChild(elem);
    } else {
      document.querySelector('#warningUrl').textContent = punycode.toUnicode(sourceUrlObj.hostname);
    }
  } catch (ex) {
    // sourceUrl is invalid, show raw sourceUrl
    // this should not happen unless the user manually enters the URL
    const elem = document.createElement('span');
    elem.textContent = sourceUrl;
    elem.style.fontSize = '0.8em';
    document.querySelector('#warningUrl').appendChild(elem);
  }

  document.querySelector('#detailsLink').href = `options.html?from=${encodeURIComponent(sourceUrl)}`;

  /**
   * Events
   */
  document.querySelector('#view').addEventListener('click', (event) => {
    const newUrl = `sandbox.html?src=${encodeURIComponent(sourceUrl)}`;
    location.assign(newUrl);
  });

  document.querySelector('#unblock').addEventListener('click', (event) => {
    const key = Math.random().toString().slice(2, 6);
    if (prompt(utils.lang("unblockBtnPrompt", key)) !== key) {
      return;
    }
    chrome.runtime.sendMessage({
      cmd: 'tempUnblock',
      args: {},
    }, (response) => {
      if (response) {
        location.replace(sourceUrl);
      }
    });
  });

  document.querySelector('#back').addEventListener('click', (event) => {
    if (history.length > 1) {
      history.go(-1);
    } else {
      chrome.tabs.getCurrent((tab) => {
        chrome.runtime.sendMessage({
          cmd: 'closeTab',
          args: {tabId: tab.id}
        });
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.warn("omMessage", message);
  const {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      recheckBlock();
      sendResponse(true);
      break;
    }
  }
});

// in case that sourceUrl is alreally unblocked
recheckBlock().then(() => {
  return utils.getOptions({
    showUnblockButton: utils.defaultOptions.showUnblockButton,
    tempUnblockCountdownBase: utils.defaultOptions.tempUnblockCountdownBase,
    tempUnblockCountdownReset: utils.defaultOptions.tempUnblockCountdownReset,
    tempUnblockCountdown: utils.defaultOptions.tempUnblockCountdown,
    tempUnblockLastAccess: utils.defaultOptions.tempUnblockLastAccess,
  }).then((options) => {
    if (!options.showUnblockButton) {
      return;
    }

    if (options.tempUnblockLastAccess < 0 ||
        Date.now() - options.tempUnblockLastAccess > options.tempUnblockCountdownReset) {
      options.tempUnblockCountdown = -1;
    }

    if (options.tempUnblockCountdown === -1) {
      options.tempUnblockCountdown = options.tempUnblockCountdownBase;
    }

    let countdown = options.tempUnblockCountdown;
    const elem = document.querySelector('#unblock');
    elem.hidden = false;
    elem.textContent = utils.lang("unblockBtnCountdown", [countdown / 1000]);

    let t = setInterval(() => {
      countdown -= 1000;
      if (countdown > 0) {
        elem.textContent = utils.lang("unblockBtnCountdown", [countdown / 1000]);
      } else {
        clearInterval(t);
        elem.textContent = utils.lang("unblockBtn");
        elem.disabled = false;
      }
    }, 1000);
  });
});
