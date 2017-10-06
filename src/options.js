const validator = new ContentFarmFilter();

function loadOptions() {
  return utils.getDefaultOptions().then((options) => {
    document.querySelector('#userBlacklist textarea').value = options.userBlacklist;
    document.querySelector('#userWhitelist textarea').value = options.userWhitelist;
    document.querySelector('#webBlacklists textarea').value = options.webBlacklists;
    for(const checkbox of document.querySelectorAll('#contextMenusOptions input[type="checkbox"]')) {
      checkbox.checked = false;
      if(options.contextMenusOptions.includes(checkbox.name)) {
        checkbox.checked = true;
      }
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        cmd: 'getMergedBlacklist',
      }, resolve);
    }).then((blacklist) => {
      document.querySelector('#allBlacklist textarea').value = blacklist;
    });
  }).catch((ex) => {
    console.error(ex);
  });
}

document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  loadOptions();

  document.querySelector('#resetButton').addEventListener('click', (event) => {
    event.preventDefault();
    utils.clearOptions().then(() => {
      return loadOptions();
    });
  });

  document.querySelector('#submitButton').addEventListener('click', (event) => {
    event.preventDefault();
    const userBlacklist = document.querySelector('#userBlacklist textarea').value;
    const userWhitelist = document.querySelector('#userWhitelist textarea').value;
    const webBlacklists = document.querySelector('#webBlacklists textarea').value;
    const contextMenusChecked = document.querySelectorAll('#contextMenusOptions input[type="checkbox"]:checked');
    const contextMenusOptions = Array.prototype.map.call(contextMenusChecked, el => el.name);

    utils.setOptions({
      userBlacklist: validator.validateRulesText(userBlacklist),
      userWhitelist: validator.validateRulesText(userWhitelist),
      webBlacklists: webBlacklists,
      contextMenusOptions: contextMenusOptions
    }).then(() => {
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
    }).catch((ex) => {
      console.error(ex);
    });
  });
});
