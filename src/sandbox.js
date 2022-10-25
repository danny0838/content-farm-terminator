async function rewriteDocumentBlob(blob, u) {
  const doc = await utils.readFileAsDocument(blob);
  if (!doc) { return blob; }

  const headElem = doc.querySelector('head');

  // according to spec, only the first base element takes effect
  let baseElem = doc.querySelector('base');
  if (baseElem) {
    // respect the original base but redirect links to the parent frame
    baseElem.target = '_parent';
  } else {
    // generate a base element
    baseElem = doc.createElement('base');
    baseElem.href = u.href;
    baseElem.target = '_parent';
    headElem.insertBefore(baseElem, headElem.firstChild);
  }

  // remove original meta charset and content security policy
  for (const elem of doc.querySelectorAll('meta[charset], meta[http-equiv="content-type"], meta[http-equiv="content-security-policy"]')) {
    elem.remove();
  }

  // add content security policy to block offensive contents
  // the iframe cannot be loaded without "frame-src blob:"
  const host = utils.getNormalizedHostname(u.host);
  const hostSubdomains = "*." + host.replace(/^www[.]/, '');
  const hostSources = `http://${host} https://${host} http://${hostSubdomains} https://${hostSubdomains}`;
  const metaCspElem = doc.createElement("meta");
  metaCspElem.setAttribute("http-equiv", "Content-Security-Policy");
  metaCspElem.setAttribute("content", `img-src ${hostSources} data:; media-src ${hostSources} data:; frame-src 'self' blob:; object-src 'none'; script-src 'none';`);
  headElem.insertBefore(metaCspElem, headElem.firstChild);

  // add meta charset to force UTF-8 encoding
  const metaCharsetElem = doc.createElement("meta");
  metaCharsetElem.setAttribute("charset", "UTF-8");
  headElem.insertBefore(metaCharsetElem, headElem.firstChild);

  // remove "target" attribute for all anchors to honor base
  // anchor opened in a new tab may cause a confusion for the extension
  for (const elem of doc.querySelectorAll('a[target], area[target]')) {
    elem.removeAttribute('target');
  }

  // pass document title to top frame
  if (doc.title) { document.title = doc.title; }

  const html = utils.doctypeToString(doc.doctype) + doc.documentElement.outerHTML;
  return new Blob([html], {type: 'text/html'});
}

async function onDomContentLoaded(event) {
  utils.loadLanguages(document);

  const frame = document.querySelector('#viewer');
  const loading = document.querySelector('#loading');

  try {
    const u = new URL(new URL(location.href).searchParams.get('src'));

    const response = await fetch(u, {credentials: 'include'});
    const blob = await response.blob();
    const newBlob = await rewriteDocumentBlob(blob, u);

    const blobUrl = URL.createObjectURL(newBlob) + u.hash;
    const parent = frame.parentNode;
    const next = frame.nextSibling;
    parent.removeChild(frame);
    frame.src = blobUrl;
    parent.insertBefore(frame, next);
  } catch (ex) {
    console.error(ex);
  }

  loading.style.display = "none";
  frame.style.display = "block";
}

document.addEventListener('DOMContentLoaded', onDomContentLoaded);
