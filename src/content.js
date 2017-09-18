function markContentFarmLink(elem) {
  let doc = elem.ownerDocument;

  // The document is currently viewing and thus allowed expicitly by the user.
  // Do not mark links targeting the same domain.
  if (new URL(elem.href).hostname === new URL(doc.location.href).hostname) {
    return;
  }

  chrome.runtime.sendMessage({
    cmd: 'isUrlBlocked',
    args: {url: elem.href, ignoreTemp: true}
  }, (isBlocked) => {
    if (isBlocked) {
      let img = doc.createElement('img');
      img.src = chrome.runtime.getURL('img/content-farm-marker.svg');
      img.style.margin = '0';
      img.style.border = '0';
      img.style.padding = '0';
      img.style.width = '1em';
      img.style.height = '1em';
      img.style.display = 'inline';
      img.style.position = 'relative';
      img.title = img.alt = utils.lang('markTitle');
      img.setAttribute("data-content-farm-terminator-marker", 1);
      elem.parentNode.insertBefore(img, elem);
    }
  });
}

function markContentFarmLinks(root = document) {
  Array.prototype.forEach.call(root.querySelectorAll('img[data-content-farm-terminator-marker]'), (elem) => {
    elem.remove();
  });
  Array.prototype.forEach.call(root.querySelectorAll('a[href], area[href]'), (elem) => {
    markContentFarmLink(elem);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  //console.warn("omMessage", message);
  var {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      markContentFarmLinks();
      sendResponse(true);
      break;
    }
  }
});

markContentFarmLinks();
