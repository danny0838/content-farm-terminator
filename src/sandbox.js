document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  var url = new URL(location.href).searchParams.get('src');

  fetch(url, {credentials: 'include'}).then((response) => {
    return response.text();
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
