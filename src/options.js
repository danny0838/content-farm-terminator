function loadOptions() {
  return utils.getOptions().then((options) => {
    document.querySelector('#userBlacklist textarea').value = options.userBlacklist;
    document.querySelector('#userWhitelist textarea').value = options.userWhitelist;
    document.querySelector('#webBlacklists textarea').value = options.webBlacklists;
    document.querySelector('#transformRules textarea').value = options.transformRules;
    document.querySelector('#suppressHistory input').checked = options.suppressHistory;
    document.querySelector('#showLinkMarkers input').checked = options.showLinkMarkers;
    document.querySelector('#showContextMenuCommands input').checked = options.showContextMenuCommands;
    document.querySelector('#quickContextMenuCommands input').checked = options.quickContextMenuCommands;
    document.querySelector('#showUnblockButton input').checked = options.showUnblockButton;

    return browser.runtime.sendMessage({
      cmd: 'getMergedBlacklist',
    }).then((blacklist) => {
      document.querySelector('#allBlacklist textarea').value = blacklist;
    });
  });
}

function saveOptions() {
  const userBlacklist = document.querySelector('#userBlacklist textarea').value;
  const userWhitelist = document.querySelector('#userWhitelist textarea').value;
  const webBlacklists = document.querySelector('#webBlacklists textarea').value;
  const transformRules = document.querySelector('#transformRules textarea').value;
  let suppressHistory = document.querySelector('#suppressHistory input').checked;
  const showLinkMarkers = document.querySelector('#showLinkMarkers input').checked;
  const showContextMenuCommands = document.querySelector('#showContextMenuCommands input').checked;
  const quickContextMenuCommands = document.querySelector('#quickContextMenuCommands input').checked;
  const showUnblockButton = document.querySelector('#showUnblockButton input').checked;

  // @TODO:
  // On Firefox 55 (and upwards?) the request prompts repeatedly even if the
  // permissions are already granted.
  return Promise.resolve().then(() => {
    if (!suppressHistory || !browser.permissions) {
      return false;
    }

    return browser.permissions.request({permissions: ['history']});
  }).catch((ex) => {
    return false;
  }).then((response) => {
    if (!response) {
      suppressHistory = document.querySelector('#suppressHistory input').checked = false;
    }
  }).then(() => {
    return browser.runtime.sendMessage({
      cmd: 'updateOptions',
      args: {
        userBlacklist,
        userWhitelist,
        webBlacklists,
        transformRules,
        suppressHistory,
        showLinkMarkers,
        showContextMenuCommands,
        quickContextMenuCommands,
        showUnblockButton,
      },
    });
  });
}

document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  // hide some options if contextMenus is not available
  // (e.g. Firefox for Android)
  if (!browser.contextMenus) {
    document.querySelector('#transformRules').hidden = true;
    document.querySelector('#showContextMenuCommands').hidden = true;
    document.querySelector('#quickContextMenuCommands').hidden = true;
  }

  // hide some options if browser.history is not available
  // Firefox supports browser.permissions since >= 55. In prior versions
  // permissions listed in "optional_permissions" are ignored.
  // Firefox for Android does not support browser.history. Unfortunately,
  // we cannot detect whether browser.history is supported by testing
  // whether browser.history is defined.
  if (!browser.permissions && !browser.history) {
    document.querySelector('#suppressHistory').hidden = true;
  }

  loadOptions();

  try {
    const url = new URL(location.href).searchParams.get('from');
    if (url) {
      const urlRegex = `/^${utils.escapeRegExp(url, true)}$/`;
      document.querySelector('#urlInfo').textContent = utils.lang('urlInfo', [url, urlRegex]);
    }
  } catch (ex) {
    console.error(ex);
  }

  document.querySelector('#resetButton').addEventListener('click', (event) => {
    event.preventDefault();
    if (!confirm(utils.lang("resetConfirm"))) {
      return;
    }
    return utils.clearOptions().then(() => {
      return loadOptions();
    });
  });

  document.querySelector('#submitButton').addEventListener('click', (event) => {
    event.preventDefault();
    return saveOptions().then(() => {
      return utils.back();
    });
  });
});
