const validator = new ContentFarmFilter();

document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  fetch(chrome.runtime.getURL('blacklist.txt')).then((response) => {
    return response.text();
  }).then((text) => {
    document.querySelector('#systemBlacklist textarea').value = text.trim();
  });

  utils.getOptions({
    userBlacklist: "",
    userWhitelist: "",
    webBlacklist: ""
  }).then((options) => {
    document.querySelector('#userBlacklist textarea').value = options.userBlacklist;
    document.querySelector('#userWhitelist textarea').value = options.userWhitelist;
    document.querySelector('#webBlacklist textarea').value = options.webBlacklist;
  }).catch((ex) => {
    console.error(ex);
  });

  document.querySelector('#submitButton').addEventListener('click', (event) => {
    event.preventDefault();
    const userBlacklist = document.querySelector('#userBlacklist textarea').value;
    const userWhitelist = document.querySelector('#userWhitelist textarea').value;
    const webBlacklist = document.querySelector('#webBlacklist textarea').value;

    utils.setOptions({
      userBlacklist: validator.validateRulesText(userBlacklist),
      userWhitelist: validator.validateRulesText(userWhitelist),
      webBlacklist: webBlacklist
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
