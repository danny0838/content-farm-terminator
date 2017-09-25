var docUrlObj = new URL(document.location.href);
var docHostname = docUrlObj.hostname;
var docPathname = docUrlObj.pathname;
var anchorMarkerMap = new Map();

function updateLinkMarker(elem) {
  // console.warn("updateLinkMarker", elem);
  return Promise.resolve().then(() => {
    if (!elem.parentNode || !elem.href) { return false; }

    let u = new URL(elem.href);
    let h = u.hostname;

    // check whether the hostname is blocked
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        cmd: 'isUrlBlocked',
        args: {url: h}
      }, resolve);
    }).then((isBlocked) => {
      if (isBlocked) { return true; }

      // check for a potential redirect by the current site (e.g. search engine or social network)
      return Promise.resolve().then(() => {
        let p = u.pathname;
        let s = u.searchParams;
        
        // Google
        // adopted from WOT: http://static-cdn.mywot.com/settings/extensions/serps.json
        if (/^(www\.)?(google)\.([a-z]{2,3})(\.[a-z]{2,3})?$/.test(h)) {
          if (p === "/url" || p === "/interstitial") {
            return s.get("url") || s.get("q");
          }
        }
        // Yahoo search
        else if (h === "r.search.yahoo.com") {
          return decodeURIComponent(p.match(/\/RU=(.*?)\//)[1]);
        }
        // Sina search
        else if (h.startsWith("find.sina.com.")) {
          if (p === "/sina_redirector.php") {
            return s.get("url");
          }
        }
        // 百度
        else if (h === "www.baidu.com") {
          if (p === "/link") {
            if (docHostname === "www.baidu.com" && docPathname === "/s") {
              try {
                let refNode = elem.closest('div.result').querySelector('a.c-showurl');
                return refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
              } catch (ex) {}
            }
          }
        }
        // 百度 mobile
        else if (h === "m.baidu.com") {
          if (p.startsWith("/from=0/")) {
            if (docHostname === "m.baidu.com" && docPathname === "/s") {
              try {
                let refNode = elem.closest('div.c-container').querySelector('div.c-showurl span.c-showurl');
                return refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
              } catch (ex) {}
            }
          }
        }
        // 搜狗
        else if (h === "www.sogou.com") {
          if (p.startsWith("/link")) {
            if (docHostname === "www.sogou.com") {
              if (docPathname === "/web" || docPathname === "/sogou" ) {
                try {
                  let refNode = elem.closest('div.vrwrap, div.rb').querySelector('cite');
                  return refNode.textContent.replace(/^.*? - /, "").replace(/[\/ \xA0][\s\S]*$/, "");
                } catch (ex) {}
              }
            }
          }
        }
        // 搜狗 mobile
        else if (h === "m.sogou.com") {
          if (p.startsWith("/web/")) {
            return s.get("url");
          }
        }
        // Facebook / Facebook mobile
        else if (h === "l.facebook.com" || h === "lm.facebook.com") {
          if (p === "/l.php") {
            return s.get("u");
          }
        }
        // Twitter / Twitter mobile
        else if (h === "t.co") {
          if (docHostname === "twitter.com") {
            return elem.getAttribute("data-expanded-url");
          } else if (docHostname === "mobile.twitter.com") {
            try {
              let refNode = elem.querySelector('span');
              return refNode.textContent.match(/\(link: (.*?)\)/)[1];
            } catch (ex) {}
          }
        }
        // Disqus
        else if (h === "disq.us") {
          if (p === "/") {
            return s.get("url");
          }
        }
        // Instagram
        else if (h === "l.instagram.com") {
          if (p === "/") {
            return s.get("u");
          }
        }
        // Tumblr
        else if (h === "t.umblr.com") {
          if (p === "/redirect") {
            return s.get("z");
          }
        }
        // Pocket
        else if (h === "getpocket.com") {
          if (p === "/redirect") {
            return s.get("url");
          }
        }
        // 巴哈姆特
        else if (h === "ref.gamer.com.tw") {
          if (p === "/redir.php") {
            return s.get("url");
          }
        }
      }).then((urlOrHostname) => {
        if (urlOrHostname) {
          return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              cmd: 'isUrlBlocked',
              args: {url: urlOrHostname}
            }, resolve);
          });
        }
        return false;
      }).catch((ex) => {
        return false;
      });
    });
  }).then((willBlock) => {
    let marker = anchorMarkerMap.get(elem);
    if (willBlock) {
      if (!marker) {
        marker = elem.ownerDocument.createElement('img');
        marker.src = chrome.runtime.getURL('img/content-farm-marker.svg');
        marker.style = 'display: inline-block !important;' + 
          'visibility: visible !important;' + 
          'position: relative !important;' + 
          'float: none !important;' + 
          'margin: 0 !important;' + 
          'outline: 0 !important;' + 
          'border: 0 !important;' + 
          'padding: 0 !important;' + 
          'width: 1em !important; min-width: 0 !important; max-width: none !important;' + 
          'height: 1em !important; min-height: 0 !important; max-height: none !important;' + 
          'vertical-align: text-top !important;';
        marker.title = marker.alt = utils.lang('markTitle');
        marker.setAttribute("data-content-farm-terminator-marker", 1);
        anchorMarkerMap.set(elem, marker);
      }
      if (!marker.parentNode) {
        elem.insertBefore(marker, elem.firstChild);
      }
    } else {
      if (marker && marker.parentNode) { marker.remove(); }
    }
  });
}

function updateLinkMarkersAll(root = document) {
  var tasks = Array.from(root.querySelectorAll('a[href], area[href]')).map((elem) => {
    return updateLinkMarker(elem);
  });
  return Promise.all(tasks);
}

function observeDomUpdates() {
  var isAnchor = function (node) {
    let n = node.nodeName.toLowerCase();
    return n === "a" || n === "area";
  };

  var docObserver = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      // console.warn("DOM update", mutation);
      for (let node of mutation.addedNodes) {
        if (isAnchor(node)) {
          updateLinkMarker(node);
          ancObserver.observe(node, ancObserverConf);
        }
        if (node.nodeType === 1) {
          Array.prototype.forEach.call(node.querySelectorAll("a, area"), (elem) => {
            updateLinkMarker(elem);
            ancObserver.observe(elem, ancObserverConf);
          });
        }
      }
      for (let node of mutation.removedNodes) {
        if (isAnchor(node)) {
          updateLinkMarker(node);
        }
        if (node.nodeType === 1) {
          Array.prototype.forEach.call(node.querySelectorAll("a, area"), (elem) => {
            updateLinkMarker(elem);
          });
        }
      }
    }
  });
  var docObserverConf = {childList: true, subtree: true};

  var ancObserver = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      // console.warn("Anchor update", mutation);
      let node = mutation.target;
      updateLinkMarker(node);
    }
  });
  var ancObserverConf = {attributes: true, attributeFilter: ["href"]};

  docObserver.observe(document.documentElement, docObserverConf);
  Array.prototype.forEach.call(document.querySelectorAll("a, area"), (elem) => {
    ancObserver.observe(elem, ancObserverConf);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  //console.warn("omMessage", message);
  var {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      updateLinkMarkersAll();
      sendResponse(true);
      break;
    }
  }
});

// Remove stale link markers when the addon is re-enabled
Array.prototype.forEach.call(document.querySelectorAll('img[data-content-farm-terminator-marker]'), (elem) => {
  elem.remove();
});
observeDomUpdates();
updateLinkMarkersAll();
