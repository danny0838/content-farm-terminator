const urlObj = new URL(location.href);
const sourceUrl = urlObj.searchParams.get('to');
const referrerUrl = urlObj.searchParams.get('ref');

async function recheckBlock() {
  const isTempUnblocked = await browser.runtime.sendMessage({
    cmd: 'isTempUnblocked',
    args: {},
  });

  const isBlocked = isTempUnblocked ? false : await browser.runtime.sendMessage({
    cmd: 'isUrlBlocked',
    args: {url: sourceUrl},
  });

  if (!isBlocked) {
    location.replace(sourceUrl);
  }
  return isBlocked;
}

async function autoUpdateUnblockButton() {
  let {
    showUnblockButton,
    tempUnblockCountdownBase,
    tempUnblockCountdownReset,
    tempUnblockCountdown,
    tempUnblockLastAccess,
  } = await utils.getOptions([
    "showUnblockButton",
    "tempUnblockCountdownBase",
    "tempUnblockCountdownReset",
    "tempUnblockCountdown",
    "tempUnblockLastAccess",
  ]);

  if (!showUnblockButton) {
    return;
  }

  if (tempUnblockLastAccess < 0 ||
      Date.now() - tempUnblockLastAccess > tempUnblockCountdownReset) {
    tempUnblockCountdown = -1;
  }

  if (tempUnblockCountdown === -1) {
    tempUnblockCountdown = tempUnblockCountdownBase;
  }

  let countdown = tempUnblockCountdown;
  const elem = document.querySelector('#unblock');
  elem.hidden = false;
  elem.disabled = true; // Firefox might record status causing non-disabled
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
}

async function onViewClick(event) {
  const newUrl = `sandbox.html?src=${encodeURIComponent(sourceUrl)}`;
  location.assign(newUrl);
}

async function onUnblockClick(event) {
  const key = Math.random().toString().slice(2, 6);
  if (prompt(utils.lang("unblockBtnPrompt", key)) !== key) {
    return;
  }

  const isTempUnblocked = await browser.runtime.sendMessage({
    cmd: 'tempUnblock',
    args: {},
  });

  if (isTempUnblocked) {
    location.replace(sourceUrl);
  }
}

async function onBackClick(event) {
  return utils.back();
}

async function init(event) {
  utils.loadLanguages(document);

  // recheck in case that sourceUrl is already unblocked
  if (!await recheckBlock()) {
    return;
  }

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

  const detailsUrl = new URL(browser.runtime.getURL('options.html'));
  detailsUrl.searchParams.set('from', sourceUrl);
  if (referrerUrl) { detailsUrl.searchParams.set('ref', referrerUrl); }
  document.querySelector('#detailsLink').href = detailsUrl.href;

  /**
   * Events
   */
  document.querySelector('#view').addEventListener('click', onViewClick);
  document.querySelector('#unblock').addEventListener('click', onUnblockClick);
  document.querySelector('#back').addEventListener('click', onBackClick);

  autoUpdateUnblockButton(); // async
}

document.addEventListener('DOMContentLoaded', init);

browser.runtime.onMessage.addListener((message, sender) => {
  // console.warn("omMessage", message);
  const {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      // async update to prevent block
      recheckBlock();
      return Promise.resolve(true);
    }
  }
});
