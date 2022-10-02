const urlObj = new URL(location.href);
const sourceUrl = urlObj.searchParams.get('url');
const referrerUrl = urlObj.searchParams.get('ref');
const blockType = parseInt(urlObj.searchParams.get('type'), 10);

async function recheckBlock() {
  const isTempUnblocked = await browser.runtime.sendMessage({
    cmd: 'isTempUnblocked',
    args: {},
  });

  const blockType = isTempUnblocked ? 0 : await browser.runtime.sendMessage({
    cmd: 'getBlockType',
    args: {url: sourceUrl},
  });

  if (!blockType) {
    location.replace(sourceUrl);
  }
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

  if (countdown > 0) {
    let t = setInterval(() => {
      countdown -= 1000;
      if (countdown > 0) {
        elem.textContent = utils.lang("unblockBtnCountdown", [countdown / 1000]);
      } else {
        clearInterval(t);
        unblock();
      }
    }, 1000);
  } else {
    unblock();
  }

  function unblock() {
    elem.textContent = utils.lang("unblockBtn");
    elem.disabled = false;
  }
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

function initMessageListener() {
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
}

function updateBlockingUi(blockType) {
  const urlElem = document.querySelector('#warningUrl');
  let sourceUrlObj;
  try {
    sourceUrlObj = new URL(sourceUrl);
    if (!['http:', 'https:'].includes(sourceUrlObj.protocol)) {
      throw new Error('URL not under http(s) protocol.');
    }
  } catch (ex) {
    // sourceUrl is invalid, show raw sourceUrl
    // this should not happen unless the user manually enters the URL
    urlElem.textContent = sourceUrl;
    document.body.setAttribute('data-block-type', -1);
    return;
  }

  document.body.setAttribute('data-block-type', blockType);
  switch (blockType) {
    case 2:
      urlElem.textContent = utils.getNormalizedUrl(sourceUrlObj);
      urlElem.classList.add('regex');
      break;
    default:
      urlElem.textContent = punycode.toASCII(sourceUrlObj.hostname);
      break;
  }

  const detailsUrl = new URL(browser.runtime.getURL('options.html'));
  detailsUrl.searchParams.set('url', sourceUrl);
  if (referrerUrl) { detailsUrl.searchParams.set('ref', referrerUrl); }
  detailsUrl.searchParams.set('type', blockType);
  document.querySelector('#detailsLink').href = detailsUrl.href;
}

async function init(event) {
  // UI
  utils.loadLanguages(document);
  updateBlockingUi(blockType);

  // events
  document.querySelector('#view').addEventListener('click', onViewClick);
  document.querySelector('#unblock').addEventListener('click', onUnblockClick);
  document.querySelector('#back').addEventListener('click', onBackClick);

  // async tasks
  autoUpdateUnblockButton();

  // recheck in case that sourceUrl is already unblocked
  (async () => {
    await recheckBlock();
    initMessageListener();
  })();
}

document.addEventListener('DOMContentLoaded', init);
