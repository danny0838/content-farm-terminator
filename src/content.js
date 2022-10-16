const docUrlObj = new URL(location.href);
let docHref = docUrlObj.href;
let docHostname = docUrlObj.hostname;
let docPathname = docUrlObj.pathname;

const anchorMarkerMap = new Map();
let lastRightClickedElem;
let showLinkMarkers = true;

let loadOptionsPromiseResolver;
let loadOptionsPromise = new Promise((resolve) => {
  loadOptionsPromiseResolver = resolve;
});

let domLoadPromiseResolver;
let domLoadPromise = new Promise((resolve) => {
  domLoadPromiseResolver = resolve;
});

let updateLinkMarkerPromise = Promise.all([
  loadOptionsPromise,
  domLoadPromise,
]);

/**
 * @param urlChanged {boolean} a recent URL change has been presumed
 * @return {boolean} whether document URL changed
 */
async function recheckCurrentUrl(urlChanged = false) {
  try {
    // check for URL change of the address bar and update related global variables
    const href = location.href;
    if (href !== docHref) {
      docHref = docUrlObj.href = href;
      docHostname = docUrlObj.hostname;
      docPathname = docUrlObj.pathname;
      urlChanged = true;
    }

    // skip further check if document URL doesn't change
    if (!urlChanged) { return urlChanged; }

    const {tabId, tempUnblocked} = await browser.runtime.sendMessage({
      cmd: 'isTempUnblocked',
      args: {},
    });

    // skip further check if this tab is temporarily unblocked
    if (tempUnblocked) { return urlChanged; }

    // redirect if the current document URL is blocked
    const blockType = await browser.runtime.sendMessage({
      cmd: 'getBlockType',
      args: {url: docHref},
    });
    if (blockType) {
      const inFrame = (self !== top);
      const redirectUrl = utils.getBlockedPageUrl(docHref, {blockType, inFrame, tabId});
      location.replace(redirectUrl);
    }

    return urlChanged;
  } catch (ex) {
    console.error(ex);
  }
}

const getRedirectedUrlOrHostname = (() => {
  // Short-lived registers, valid during evaluation.
  // Requires extra care for async tasks.
  let elem;
  let u;
  let h;
  let p;
  let s;

  const handlers = {
    match: {},
    regexes: new Map(),
  };

  function addHandler(hostnames, handler) {
    for (const hostname of (Array.isArray(hostnames) ? hostnames : [hostnames])) {
      if (typeof hostname === 'string') {
        handlers.match[hostname] = handler;
      } else {
        switch (hostname.type) {
          case 'match': {
            handlers.match[hostname] = handler;
            break;
          }
          case 'regex': {
            handlers.regexes.set(hostname.value, handler);
            break;
          }
        }
      }
    }
  }

  async function getRedirectedUrlOrHostname(anchorElem) {
    try {
      elem = anchorElem;
      u = new URL(elem.href);
      h = u.hostname;
      p = u.pathname;
      s = u.searchParams;

      // dispath handler according to hostname
      {
        const handler = handlers.match[h];
        if (handler) { return handler(); }
      }

      for (const [regex, handler] of handlers.regexes) {
        if (regex.test(h)) {
          return handler();
        }
      }
    } catch (ex) {
      console.error(ex);
    }
  }

  // Google
  addHandler({
    type: 'regex',
    // adopted from WOT: http://static-cdn.mywot.com/settings/extensions/serps.json
    value: /^(www\.|encrypted\.)?(google)\.([a-z]{2,3})(\.[a-z]{2,3})?$/,
  }, () => {
    if (p === "/url" || p === "/interstitial") {
      return s.get("url") || s.get("q");
    }
  });

  // Facebook / Facebook mobile
  addHandler(["l.facebook.com", "lm.facebook.com"], () => {
    if (p === "/l.php") {
      return s.get("u");
    }
  });

  // Bing (used rarely, e.g. in Egerin)
  addHandler("www.bing.com", () => {
    if (p === "/cr") {
      return s.get("r");
    }
  });

  // Yahoo search (no javascript)
  addHandler("r.search.yahoo.com", () => {
    return decodeURIComponent(p.match(/\/RU=(.*?)\//)[1]);
  });

  // Sina search
  addHandler({
    type: 'regex',
    value: /^find\.sina\.com\./,
  }, () => {
    if (p === "/sina_redirector.php") {
      return s.get("url");
    }
  });

  // Yandex search
  addHandler("www.yandex.com", () => {
    if (p === "/clck/jsredir") {
      if (elem.matches('li.serp-item > div > h2 > a')) {
        const refNode = elem.closest('li.serp-item').querySelector('div > h2+div a > b');
        return refNode.textContent;
      }
    }
  });

  // WebCrawler mobile
  addHandler("cs.webcrawler.com", () => {
    if (p === "/ClickHandler.ashx") {
      u.search = s.get("encp");
      return s.get("ru");
    }
  });

  // Dogpile
  addHandler("ccs.dogpile.com", () => {
    if (p === "/ClickHandler.ashx") {
      u.search = s.get("encp");
      return s.get("ru");
    }
  });

  // info.com / msxml.excite.com
  addHandler("ccs.infospace.com", () => {
    if (p === "/ClickHandler.ashx") {
      u.search = s.get("encp");
      return s.get("ru");
    }
  });

  // Search
  addHandler("www.search.com", () => {
    if (p === "/wr_clk") {
      return s.get("surl");
    }
  });

  // Lycos
  addHandler("search.lycos.com", () => {
    if (p === "/b.php") {
      return u.protocol + "//" + s.get("as");
    } else if (p === "/bnjs.php") {
      return s.get("as");
    }
  });

  // Qwant
  addHandler("lite.qwant.com", () => {
    if (p.startsWith("/redirect/")) {
      return decodeURIComponent(p.match(/\/redirect\/[^\/]+\/(.*)$/)[1]);
    }
  });

  // Qwant Ads
  addHandler({
    type: 'regex',
    value: /^\d+\.r\.bat\.bing\.com$/,
  }, () => {
    if (p === "/") {
      if (docHostname === "lite.qwant.com" && docPathname === "/") {
        if (elem.matches('div.result a')) {
          const refNode = elem.closest('div.result').querySelector('p.url').cloneNode(true);
          refNode.querySelector('span').remove();
          return u.protocol + "//" + refNode.textContent.trim();
        }
      }
    }
  });

  // 百度
  addHandler("www.baidu.com", () => {
    if (p === "/link") {
      if (docHostname === "www.baidu.com" && docPathname === "/s") {
        if (elem.matches('div.result > h3 > a, div.result div.general_image_pic a, div.result a.c-showurl')) {
          const refNode = elem.closest('div.result').querySelector('a.c-showurl');
          return refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
        }
      }
    }
  });

  // 百度 mobile
  addHandler("m.baidu.com", () => {
    if (p.startsWith("/from=0/")) {
      if (docHostname === "m.baidu.com" && docPathname === "/s") {
        if (elem.matches(':not(.koubei-a)')) {
          const refNode = elem.closest('div.c-container').querySelector('div.c-showurl span.c-showurl');
          return refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
        }
      }
    }
  });

  // 搜狗
  addHandler("www.sogou.com", () => {
    if (p.startsWith("/link")) {
      if (docHostname === "www.sogou.com") {
        if (docPathname === "/web" || docPathname === "/sogou" ) {
          const refNode = elem.closest('div.vrwrap, div.rb').querySelector('cite');
          return refNode.textContent.replace(/^.*? - /, "").replace(/[\/ \xA0][\s\S]*$/, "");
        }
      }
    }
  });

  // 搜狗 mobile
  addHandler("m.sogou.com", () => {
    if (p.startsWith("/web/")) {
      return s.get("url");
    }
  });

  // 360搜索
  addHandler("www.so.com", () => {
    if (p === "/link") {
      if (docHostname === "www.so.com" && docPathname === "/s") {
        return elem.getAttribute('data-url');
      }
    }
  });

  // 360搜索 mobile
  addHandler("m.so.com", () => {
    if (p === "/jump") {
      return s.get("u");
    }
  });

  // Twitter / Twitter mobile
  addHandler("t.co", () => {
    if (docHostname === "twitter.com") {
      return elem.getAttribute("data-expanded-url");
    } else if (docHostname === "mobile.twitter.com") {
      const refNode = elem.querySelector('span');
      return refNode.textContent.match(/\(link: (.*?)\)/)[1];
    }
  });

  // Disqus
  addHandler("disq.us", () => {
    if (p === "/") {
      return s.get("url");
    }
  });

  // Instagram
  addHandler("l.instagram.com", () => {
    if (p === "/") {
      return s.get("u");
    }
  });

  // Tumblr
  addHandler("t.umblr.com", () => {
    if (p === "/redirect") {
      return s.get("z");
    }
  });

  // Pocket
  addHandler("getpocket.com", () => {
    if (p === "/redirect") {
      return s.get("url");
    }
  });

  // 巴哈姆特
  addHandler("ref.gamer.com.tw", () => {
    if (p === "/redir.php") {
      return s.get("url");
    }
  });

  return getRedirectedUrlOrHostname;
})();

async function updateLinkMarker(elem) {
  // console.warn("updateLinkMarker", elem);
  return updateLinkMarkerPromise = updateLinkMarkerPromise.then(async () => {
    if (!showLinkMarkers) { return false; }

    if (!elem.isConnected || !elem.href) { return false; }

    const u = new URL(elem.href);
    const c = u.protocol;
    if (!(c === "http:" || c === "https:")) { return false; }

    // check whether the URL is blocked
    return await browser.runtime.sendMessage({
      cmd: 'getBlockType',
      args: {
        url: u.href,
        urlRedirected: await getRedirectedUrlOrHostname(elem),
      },
    });
  }).then((blockType) => {
    let marker = anchorMarkerMap.get(elem);
    if (blockType > 0 /* BLOCK_TYPE_NONE */) {
      if (!marker) {
        marker = elem.ownerDocument.createElement('img');
        marker.src = browser.runtime.getURL('img/content-farm-marker.svg');
        marker.style = 'display: inline-block !important;' +
          'visibility: visible !important;' +
          'position: relative !important;' +
          'float: none !important;' +
          'margin: 0 !important;' +
          'outline: 0 !important;' +
          'border: 0 !important;' +
          'padding: 0 !important;' +
          'width: 1em !important; min-width: 12px !important; max-width: none !important;' +
          'height: 1em !important; min-height: 12px !important; max-height: none !important;' +
          'vertical-align: text-top !important;';
        marker.title = marker.alt = utils.lang('markTitle');
        marker.setAttribute("data-content-farm-terminator-marker", 1);
        anchorMarkerMap.set(elem, marker);
      }
      if (!marker.isConnected) {
        // insert before a non-blank text node preceeding all element nodes
        for (const node of elem.childNodes) {
          if (node.nodeType === 3 && node.nodeValue.trim()) {
            elem.insertBefore(marker, node);
            return;
          } else if (node.nodeType === 1) {
            break;
          }
        }

        // insert in the first header descendant
        for (const node of elem.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
          if (node.offsetParent && node.textContent.trim()) {
            node.insertBefore(marker, node.firstChild);
            return;
          }
        }

        // insert in the first span-like descendant
        for (const node of elem.querySelectorAll('span, div, b')) {
          if (node.offsetParent) {
            const firstChild = node.firstChild;
            if (firstChild && firstChild.nodeType === 3 && firstChild.nodeValue.trim()) {
              node.insertBefore(marker, firstChild);
              return;
            }
          }
        }

        // insert as the first anchor child
        elem.insertBefore(marker, elem.firstChild);
      }
    } else {
      if (marker && marker.isConnected) { marker.remove(); }
    }
  }).catch((ex) => {
    console.error(ex);
  });
}

async function updateLinkMarkersAll(root = document) {
  for (const elem of root.querySelectorAll('a[href], area[href]')) {
    updateLinkMarker(elem); // async
  }
  return updateLinkMarkerPromise;
}

function observeDomUpdates() {
  const isAnchor = (node) => {
    let n = node.nodeName.toLowerCase();
    return n === "a" || n === "area";
  };

  const docObserver = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      // console.warn("DOM update", mutation);
      for (let node of mutation.addedNodes) {
        if (isAnchor(node)) {
          updateLinkMarker(node); // async
          ancObserver.observe(node, ancObserverConf);
        }
        if (node.nodeType === 1) {
          for (const elem of node.querySelectorAll("a, area")) {
            updateLinkMarker(elem); // async
            ancObserver.observe(elem, ancObserverConf);
          }
        }
      }
      for (let node of mutation.removedNodes) {
        if (isAnchor(node)) {
          updateLinkMarker(node); // async
        }
        if (node.nodeType === 1) {
          for (const elem of node.querySelectorAll("a, area")) {
            updateLinkMarker(elem); // async
          }
        }
      }
    }
  });
  const docObserverConf = {childList: true, subtree: true};

  const ancObserver = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      // console.warn("Anchor update", mutation);
      const node = mutation.target;
      updateLinkMarker(node); // async
    }
  });
  const ancObserverConf = {attributes: true, attributeFilter: ["href"]};

  docObserver.observe(document.documentElement, docObserverConf);
  for (const elem of document.querySelectorAll("a, area")) {
    ancObserver.observe(elem, ancObserverConf);
  }
}

function initMessageListener() {
  browser.runtime.onMessage.addListener((message, sender) => {
    //console.warn("omMessage", message);
    const {cmd, args} = message;
    switch (cmd) {
      case 'updateContent': {
        // async update to prevent block
        utils.getOptions([
          "showLinkMarkers",
        ]).then((options) => {
          showLinkMarkers = options.showLinkMarkers;
          return updateLinkMarkersAll();
        });

        return Promise.resolve(true);
      }
      case 'blockSite': {
        const rule = prompt(utils.lang("blockSite"), args.rule);
        return Promise.resolve(rule);
      }
      case 'blockSites': {
        const comment = prompt(utils.lang("blockSites", args.rules.join('\n')));
        return Promise.resolve(comment);
      }
      case 'blockSelectedLinks': {
        const rv = [];
        const sel = document.getSelection();
        const nodeRange = document.createRange();
        for(let i = 0, I = sel.rangeCount; i < I; i++) {
          const range = sel.getRangeAt(i);
          if (range.collapsed) {
            continue;
          }
          const walker = document.createTreeWalker(range.commonAncestorContainer, 1, {
            acceptNode: (node) => {
              nodeRange.selectNode(node);
              if (nodeRange.compareBoundaryPoints(Range.START_TO_START, range) >= 0
                  && nodeRange.compareBoundaryPoints(Range.END_TO_END, range) <= 0) {
                if (node.matches('a[href], area[href]')) {
                  return NodeFilter.FILTER_ACCEPT;
                }
              }
              return NodeFilter.FILTER_SKIP;
            },
          });
          let node;
          while (node = walker.nextNode()) {
            const a = node;
            const p = getRedirectedUrlOrHostname(a)
              .then((redirected) => redirected || a.href)
              .catch((ex) => {});
            rv.push(p);
          }
        }
        return Promise.all(rv).then(rv => rv.filter(x => x));
      }
      case 'getRedirectedLinkUrl': {
        const anchor = lastRightClickedElem.closest('a[href], area[href]');
        return getRedirectedUrlOrHostname(anchor);
      }
      case 'alert': {
        alert(args.msg);
        return Promise.resolve(true);
      }
    }
  });
}

/**
 * Check for a potential document URL change
 */
function initUrlChangeListener() {
  async function onPotentialUrlChange() {
    if (checkingUrl) { return; }
    checkingUrl = true;
    await recheckCurrentUrl();
    checkingUrl = false;
  }

  let checkingUrl = false;

  // There is no event handler for a URL change made by history.pushState
  // or history.replaceState. Use a perioridic recheck to do this.
  setInterval(onPotentialUrlChange, 750);

  // address bar, click link, location.assign() with only hash change
  window.addEventListener("hashchange", onPotentialUrlChange, true);

  // history.back(), history.go()
  window.addEventListener("popstate", onPotentialUrlChange, true);
}

async function onDomContentLoaded() {
  // Check whether the current page is blocked, as a supplement
  // for content farm pages not blocked by background onBeforeRequest.
  // This could happen when the page is loaded before the extension
  // is loaded or before updateFilter is completed in the background script.
  //
  // @TODO: Some ads are still loaded even if we block the page here.
  await recheckCurrentUrl(true);

  // Remove stale link markers when the add-on is re-enabled
  for (const elem of document.querySelectorAll('img[data-content-farm-terminator-marker]')) {
    elem.remove();
  }

  observeDomUpdates();

  domLoadPromiseResolver();

  await updateLinkMarkersAll();
}

function init() {
  initUrlChangeListener();
  initMessageListener();

  // async
  utils.getOptions([
    "showLinkMarkers",
  ]).then((options) => {
    showLinkMarkers = options.showLinkMarkers;
    loadOptionsPromiseResolver();
  });

  window.addEventListener("contextmenu", (event) => {
    lastRightClickedElem = event.target;
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onDomContentLoaded, true);
  } else {
    onDomContentLoaded(); // async
  }
}

init(); // async
