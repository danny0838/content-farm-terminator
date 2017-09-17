var sourceUrl = new URL(location.href).searchParams.get('to');
var sourceUrlObj = new URL(sourceUrl);

document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  document.querySelector('#warningUrl').textContent = sourceUrlObj.hostname;

  /**
   * Events
   */
  document.querySelector('#continue').addEventListener('click', (event) => {
    chrome.runtime.sendMessage({
      cmd: 'unblockTemp',
      args: {hostname: sourceUrlObj.hostname}
    }, (response) => {
      if (response) {
        location.replace(sourceUrl);
      }
    });
  });

  document.querySelector('#continueNoAds').addEventListener('click', (event) => {
    let newUrl = `https://webcache.googleusercontent.com/search?strip=1&q=cache:${encodeURI(sourceUrl)}`;
    location.replace(newUrl);
  });

  document.querySelector('#back').addEventListener('click', (event) => {
    console.warn(history.length);
    if (history.length > 1) {
      history.go(-1);
    } else {
      chrome.runtime.sendMessage({
        cmd: 'closeTab'
      });
    }
  });
});
