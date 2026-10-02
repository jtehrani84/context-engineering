(function () {
  var idx = window.DOCS_INDEX || [];
  var q = document.getElementById('q'), ol = document.getElementById('results');
  if (!q || !ol) return;
  q.form.addEventListener('submit', function (e) { e.preventDefault(); var a = ol.querySelector('a'); if (a) location.href = a.href; });
  function snippet(text, term) {
    var i = text.toLowerCase().indexOf(term);
    if (i < 0) return text.slice(0, 110);
    var s = Math.max(0, i - 40);
    return (s ? '... ' : '') + text.slice(s, s + 110);
  }
  q.addEventListener('input', function () {
    var terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    ol.textContent = '';
    if (!terms.length) return;
    var hits = [];
    for (var i = 0; i < idx.length; i++) {
      var e = idx[i], t = e.t.toLowerCase(), x = e.x.toLowerCase(), score = 0, ok = true;
      for (var j = 0; j < terms.length; j++) {
        var inT = t.indexOf(terms[j]) >= 0, inX = x.indexOf(terms[j]) >= 0;
        if (!inT && !inX) { ok = false; break; }
        score += (inT ? 3 : 0) + (inX ? 1 : 0);
      }
      if (ok) hits.push([score, e]);
    }
    hits.sort(function (a, b) { return b[0] - a[0]; });
    hits.slice(0, 12).forEach(function (h) {
      var e = h[1], li = document.createElement('li'), a = document.createElement('a');
      a.href = e.u; a.textContent = e.t;
      var where = document.createElement('span'); where.className = 'where'; where.textContent = e.p;
      var snip = document.createElement('span'); snip.className = 'snip'; snip.textContent = snippet(e.x, terms[0]);
      li.appendChild(a); li.appendChild(where); li.appendChild(snip); ol.appendChild(li);
    });
    if (!hits.length) { var li = document.createElement('li'); li.textContent = 'No matches'; ol.appendChild(li); }
  });
})();
