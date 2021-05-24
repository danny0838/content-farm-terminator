const urlObj = new URL(location.href);
const sourceUrl = urlObj.searchParams.get('to');

function recheckBlock() {
  return browser.runtime.sendMessage({
    cmd: 'isTempUnblocked',
    args: {},
  }).then((isTempUnblocked) => {
    // skip further check if this tab is temporarily unblocked
    if (isTempUnblocked) { return false; }

    return browser.runtime.sendMessage({
      cmd: 'isUrlBlocked',
      args: {url: sourceUrl},
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
    if (!(sourceUrlObj.protocol === 'http:' || sourceUrlObj.protocol === 'https:')) {
      throw new Error('URL not under http(s) protocol.');
    }
    if (urlObj.searchParams.get('type') == 2) {
      const url = utils.getNormalizedUrl(sourceUrlObj);
      const elem = document.createElement('span');
      elem.textContent = url;
      elem.style.fontSize = '0.8em';
      document.querySelector('#warningUrl').appendChild(elem);
    } else {
      document.querySelector('#warningUrl').textContent = punycode.toASCII(sourceUrlObj.hostname);
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

  // Firefox might record status and make it non-disabled
  document.querySelector('#unblock').disabled = true;

  document.querySelector('#unblock').addEventListener('click', (event) => {
    const key = Math.random().toString().slice(2, 6);
    if (prompt(utils.lang("unblockBtnPrompt", key)) !== key) {
      return;
    }

    return browser.runtime.sendMessage({
      cmd: 'tempUnblock',
      args: {},
    })
      .then((response) => {
        if (response) {
          location.replace(sourceUrl);
        }
      });
  });

  document.querySelector('#back').addEventListener('click', (event) => {
    return utils.back();
  });
});

browser.runtime.onMessage.addListener((message, sender) => {
  // console.warn("omMessage", message);
  const {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      recheckBlock();
      return Promise.resolve(true);
    }
  }
});

// in case that sourceUrl is alreally unblocked
recheckBlock().then(() => {
  return utils.getOptions([
    "showUnblockButton",
    "tempUnblockCountdownBase",
    "tempUnblockCountdownReset",
    "tempUnblockCountdown",
    "tempUnblockLastAccess",
  ]).then((options) => {
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
