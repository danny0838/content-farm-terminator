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

  // Google Search (no JavaScript)
  addHandler([
    // add known common cases for faster lookup and regex for potential leaks
    // https://www.google.com/supported_domains
    "www.google.com",
    "www.google.ad",
    "www.google.ae",
    "www.google.com.af",
    "www.google.com.ag",
    "www.google.com.ai",
    "www.google.al",
    "www.google.am",
    "www.google.co.ao",
    "www.google.com.ar",
    "www.google.as",
    "www.google.at",
    "www.google.com.au",
    "www.google.az",
    "www.google.ba",
    "www.google.com.bd",
    "www.google.be",
    "www.google.bf",
    "www.google.bg",
    "www.google.com.bh",
    "www.google.bi",
    "www.google.bj",
    "www.google.com.bn",
    "www.google.com.bo",
    "www.google.com.br",
    "www.google.bs",
    "www.google.bt",
    "www.google.co.bw",
    "www.google.by",
    "www.google.com.bz",
    "www.google.ca",
    "www.google.cd",
    "www.google.cf",
    "www.google.cg",
    "www.google.ch",
    "www.google.ci",
    "www.google.co.ck",
    "www.google.cl",
    "www.google.cm",
    "www.google.cn",
    "www.google.com.co",
    "www.google.co.cr",
    "www.google.com.cu",
    "www.google.cv",
    "www.google.com.cy",
    "www.google.cz",
    "www.google.de",
    "www.google.dj",
    "www.google.dk",
    "www.google.dm",
    "www.google.com.do",
    "www.google.dz",
    "www.google.com.ec",
    "www.google.ee",
    "www.google.com.eg",
    "www.google.es",
    "www.google.com.et",
    "www.google.fi",
    "www.google.com.fj",
    "www.google.fm",
    "www.google.fr",
    "www.google.ga",
    "www.google.ge",
    "www.google.gg",
    "www.google.com.gh",
    "www.google.com.gi",
    "www.google.gl",
    "www.google.gm",
    "www.google.gr",
    "www.google.com.gt",
    "www.google.gy",
    "www.google.com.hk",
    "www.google.hn",
    "www.google.hr",
    "www.google.ht",
    "www.google.hu",
    "www.google.co.id",
    "www.google.ie",
    "www.google.co.il",
    "www.google.im",
    "www.google.co.in",
    "www.google.iq",
    "www.google.is",
    "www.google.it",
    "www.google.je",
    "www.google.com.jm",
    "www.google.jo",
    "www.google.co.jp",
    "www.google.co.ke",
    "www.google.com.kh",
    "www.google.ki",
    "www.google.kg",
    "www.google.co.kr",
    "www.google.com.kw",
    "www.google.kz",
    "www.google.la",
    "www.google.com.lb",
    "www.google.li",
    "www.google.lk",
    "www.google.co.ls",
    "www.google.lt",
    "www.google.lu",
    "www.google.lv",
    "www.google.com.ly",
    "www.google.co.ma",
    "www.google.md",
    "www.google.me",
    "www.google.mg",
    "www.google.mk",
    "www.google.ml",
    "www.google.com.mm",
    "www.google.mn",
    "www.google.ms",
    "www.google.com.mt",
    "www.google.mu",
    "www.google.mv",
    "www.google.mw",
    "www.google.com.mx",
    "www.google.com.my",
    "www.google.co.mz",
    "www.google.com.na",
    "www.google.com.ng",
    "www.google.com.ni",
    "www.google.ne",
    "www.google.nl",
    "www.google.no",
    "www.google.com.np",
    "www.google.nr",
    "www.google.nu",
    "www.google.co.nz",
    "www.google.com.om",
    "www.google.com.pa",
    "www.google.com.pe",
    "www.google.com.pg",
    "www.google.com.ph",
    "www.google.com.pk",
    "www.google.pl",
    "www.google.pn",
    "www.google.com.pr",
    "www.google.ps",
    "www.google.pt",
    "www.google.com.py",
    "www.google.com.qa",
    "www.google.ro",
    "www.google.ru",
    "www.google.rw",
    "www.google.com.sa",
    "www.google.com.sb",
    "www.google.sc",
    "www.google.se",
    "www.google.com.sg",
    "www.google.sh",
    "www.google.si",
    "www.google.sk",
    "www.google.com.sl",
    "www.google.sn",
    "www.google.so",
    "www.google.sm",
    "www.google.sr",
    "www.google.st",
    "www.google.com.sv",
    "www.google.td",
    "www.google.tg",
    "www.google.co.th",
    "www.google.com.tj",
    "www.google.tl",
    "www.google.tm",
    "www.google.tn",
    "www.google.to",
    "www.google.com.tr",
    "www.google.tt",
    "www.google.com.tw",
    "www.google.co.tz",
    "www.google.com.ua",
    "www.google.co.ug",
    "www.google.co.uk",
    "www.google.com.uy",
    "www.google.co.uz",
    "www.google.com.vc",
    "www.google.co.ve",
    "www.google.vg",
    "www.google.co.vi",
    "www.google.com.vn",
    "www.google.vu",
    "www.google.ws",
    "www.google.rs",
    "www.google.co.za",
    "www.google.co.zm",
    "www.google.co.zw",
    "www.google.cat",
    {
      type: 'regex',
      value: /^(www\.|encrypted\.)?(google)\.([a-z]{2,3})(\.[a-z]{2,3})?$/,
    },
  ], () => {
    if (p === "/url" || p === "/interstitial") {
      return s.get("url") || s.get("q");
    }
  });

  // YouTube
  addHandler("www.youtube.com", () => {
    if (p === "/redirect") {
      return s.get("q");
    }
  });

  // Facebook / Facebook mobile
  addHandler(["l.facebook.com", "lm.facebook.com"], () => {
    if (p === "/l.php") {
      return s.get("u");
    }
  });

  addHandler(["www.facebook.com", "m.facebook.com"], () => {
    if (p === "/flx/warn/") {
      return s.get("u");
    }
  });

  // Bing (used rarely, e.g. in Egerin)
  addHandler("www.bing.com", () => {
    if (p === "/cr") {
      return s.get("r");
    }
  });

  // Yahoo search (JavaScript disabled)
  addHandler("r.search.yahoo.com", () => {
    const m = p.match(/\/RU=([^\/]*)\//);
    if (m) {
      return decodeURIComponent(m[1]);
    }
  });

  // Yandex (www.yandex.com)
  // 2022-10-16 - No more provide redirected URL.

  // WebCrawler (www.webcrawler.com)
  // 2022-10-16 - No more provide redirected URL.

  // Dogpile
  addHandler("ccs.dogpile.com", () => {
    if (p === "/ClickHandler.ashx") {
      return new URLSearchParams(s.get("encp")).get("ru");
    }
  });

  // info.com / msxml.excite.com
  addHandler("ccs.infospace.com", () => {
    if (p === "/ClickHandler.ashx") {
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
    if (p === "/b.php" || p === "/bnjs.php") {
      return s.get("as");
    }
  });

  // 百度
  addHandler("www.baidu.com", () => {
    // desktop or iPad, search from baidu.com
    if (docHostname === "www.baidu.com" && docPathname === "/s") {
      if (p === "/link") {
        if (elem.matches('.result[mu] h3 a, .result-op[mu] h3 a')) {
          const refNode = elem.closest('.result[mu], .result-op[mu]');
          if (refNode) {
            return refNode.getAttribute('mu');
          }
        }
      } else if (p === "/baidu.php") {
        return elem.getAttribute('data-landurl');
      }
    }
  });

  // 百度 mobile
  addHandler("m.baidu.com", () => {
    if (
      // iPhone or Android, JavaScript enabled, search from baidu.com
      (docHostname === "www.baidu.com" && docPathname === "/from=844b/s" && p.startsWith("/from=844b/")) ||
      // JavaScript enabled, search from m.baidu.com
      // (docHostname === "m.baidu.com" && docPathname === "/s" && p.startsWith("/from=0/")) ||
      // desktop or iPad, JavaScript disabled, search from m.baidu.com
      (docHostname === "m.baidu.com" && (docPathname === "/s" || docPathname.startsWith('/pu=sz')) && p.startsWith("/from=0/")) ||
      // iPhone or Android, JavaScript disabled, search from m.baidu.com (baidu.com auto-redirects to m.baidu.com)
      (docHostname === "m.baidu.com" && (docPathname === "/s" || docPathname.startsWith('/from=844b/pu=sz')) && p.startsWith("/from=844b/"))
    ) {
      // JavaScript enabled
      if (elem.matches('#results .result[data-log] a.c-blocka')) {
        const refNode = elem.closest('.result[data-log]');
        if (refNode) {
          return JSON.parse(refNode.getAttribute('data-log')).mu;
        }
      }

      // JavaScript disabled
      if (elem.matches('#page-res .resitem a.result_title')) {
        const refNode = elem.closest('.resitem').querySelector('.site');
        if (refNode) {
          return refNode.textContent;
        }
      }
    }
  });

  // 知乎
  addHandler("link.zhihu.com", () => {
    if (p === "/") {
      return s.get("target");
    }
  });

  // 搜狗
  addHandler("www.sogou.com", () => {
    if (docHostname === "www.sogou.com" && (docPathname === "/web" || docPathname === "/sogou" )) {
      if (p.startsWith("/link")) {
        if (elem.matches('div.vrwrap h3 a')) {
          const refNode = elem.closest('div.vrwrap').querySelector('div.r-sech[data-url]');
          if (refNode) {
            return refNode.getAttribute('data-url');
          }
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
    if (docHostname === "www.so.com" && docPathname === "/s") {
      if (p === "/link") {
        if (elem.matches('a[data-mdurl]')) {
          return elem.getAttribute('data-mdurl');
        }
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
    if (docHostname === "twitter.com" || docHostname === "mobile.twitter.com") {
      let url = elem.textContent;
      const lastSpan = elem.querySelector('span[aria-hidden="true"]:last-child');
      if (lastSpan && lastSpan.textContent === "…") {
        url = url.slice(0, -1);
      }
      return url;
    }
  });

  // Disqus
  addHandler("disq.us", () => {
    if (p === "/url") {
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

  // Slack
  addHandler("slack-redir.net", () => {
    if (p === "/link") {
      return s.get("url");
    }
  });

  // Steam Community
  addHandler("steamcommunity.com", () => {
    if (p === "/linkfilter/") {
      return s.get("url");
    }
  });

  // VK
  addHandler("vk.com", () => {
    if (p === "/away.php") {
      return s.get("to");
    }
  });

  // 2022-01-02 - https://c212.net/c/link/?t=0&l=en&o=2997076-1&h=288952320&u=http%3A%2F%2Fcreatorkit.com%2Ftop-nine-best-of-2020&a=CreatorKit.com%2FTopNine
  addHandler("c212.net", () => {
    if (p === "/c/link/") {
      return s.get("u");
    }
  });

  return getRedirectedUrlOrHostname;
})();

async function updateLinkMarker(elem) {
  // console.warn("updateLinkMarker", elem);
  return updateLinkMarkerPromise = updateLinkMarkerPromise.then(async () => {
    if (!showLinkMarkers) { return 0; }

    if (!elem.isConnected || !elem.href) { return 0; }

    const u = new URL(elem.href);
    const c = u.protocol;
    if (!(c === "http:" || c === "https:")) { return 0; }

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
