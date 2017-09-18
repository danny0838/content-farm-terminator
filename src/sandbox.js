document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  var url = new URL(location.href).searchParams.get('src');

  fetch(url, {credentials: 'include'}).then((response) => {
    return response.text();
  }).then((text) => {
    return new DOMParser().parseFromString(text, 'text/html');
  }).then((doc) => {
    document.title = doc.title;
    Array.prototype.forEach.call(doc.querySelectorAll('img, iframe, applet, object, embed, audio, video, canvas, base'), (elem) => {
      elem.remove();
    });
    let baseElem = doc.createElement('base');
    baseElem.href = url;
    baseElem.target = '_top';
    doc.querySelector('head').appendChild(baseElem);
    return utils.doctypeToString(doc.doctype) + doc.documentElement.outerHTML;
  }).then((text) => {
    let blob = new Blob([text], {type: 'text/html'});
    let blobUrl = URL.createObjectURL(blob);
    let frame = document.querySelector('#viewer');
    let parent = frame.parentNode;
    let next = frame.nextSibling;
    parent.removeChild(frame);
    frame.src = blobUrl;
    parent.insertBefore(frame, next);
  });
});
