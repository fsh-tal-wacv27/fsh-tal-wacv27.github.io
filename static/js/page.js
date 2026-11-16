// Page behavior:
//  - Marks slides as .is-shown as soon as they scroll a little way into view,
//    which plays their .reveal transitions (CSS), starts their videos and clip
//    wall, and counts up their [data-count] numbers. All of that resets once
//    the slide has left the screen entirely, so it replays on return.
//  - Marks the slide crossing the middle of the viewport as .is-active, which
//    sets the nav's theme and current link. Scrolling itself is the browser's own.
//  - The two results charts, built from the data below.
//  - Raw/masks/tracks switch on the Dataset slide.
//  - Copy-to-clipboard for the BibTeX.
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var nav = document.querySelector('.globalnav');
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.globalnav-links a'));

  // Stagger each slide's text reveals in document order.
  slides.forEach(function (slide) {
    slide.querySelectorAll('.copy .reveal').forEach(function (el, i) {
      el.style.setProperty('--i', i);
    });
  });

  // Slides grouped under another slide's nav link.
  var NAV_GROUP = { model: 'tracking', perbehavior: 'results' };
  var activeSlide = null;

  function activate(slide) {
    if (slide === activeSlide) return;
    activeSlide = slide;
    slides.forEach(function (s) { s.classList.toggle('is-active', s === slide); });
    nav.dataset.theme = slide.classList.contains('theme-dark') ? 'dark' : 'light';
    var id = NAV_GROUP[slide.id] || slide.id;
    navLinks.forEach(function (a) {
      a.setAttribute('aria-current', a.getAttribute('href') === '#' + id ? 'true' : 'false');
    });
  }

  function show(slide) {
    if (slide.classList.contains('is-shown')) return;
    slide.classList.add('is-shown');
    var wall = slide.querySelector('.clip-wall');
    if (wall) showWall(wall);
    playVideos(slide);
    countUp(slide);
  }

  function hide(slide) {
    if (!slide.classList.contains('is-shown')) return;
    slide.classList.remove('is-shown');
    var wall = slide.querySelector('.clip-wall');
    if (wall) hideWall(wall);
    slide.querySelectorAll('video').forEach(function (v) { v.pause(); });
  }

  function shownSlides() {
    return slides.filter(function (s) { return s.classList.contains('is-shown'); });
  }

  // ---------- Videos: only the shown slides' clips play ----------
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function playVideos(slide) {
    slide.querySelectorAll('video').forEach(function (v) {
      // decorative background loops stay still for reduced motion
      if (reduceMotion.matches && v.classList.contains('bg')) return;
      // wall clips keep their own place in the loop; the rest start over
      if (!v.classList.contains('bg')) {
        try { v.currentTime = 0; } catch (e) {}
      }
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    });
  }

  // ---------- Clip walls (title and links slides) ----------
  // Dataset clips (static/media/wall/, 480×270 copies; the title wall uses the
  // SAM3-mask versions, the links wall the raw ones) tiled across the
  // slide in a random order, each started at a random point in its loop. Browsers cap how many video players a page may
  // hold (~75 desktop, fewer on phones), so a wall only exists while its slide
  // is shown, with about 30 tiles at most.
  var WALL_CLIPS = [
    '00006', '00019', '00020', '00039', '00053', '00527', '00528', '00585', '00663', '00843', '00844',
    '00852', '02308', '02362', '02363', '02471', '02474', '04371', '07414', '08877', '08984'
  ];
  var MAX_TILES = 30;
  var TILES_PER_FRAME = 3;    // players started per animation frame
  var SEEK_EVENTS = ['canplaythrough', 'playing', 'timeupdate'];

  function buildWall(wall) {
    clearWall(wall);
    var w = wall.clientWidth, h = wall.clientHeight;
    if (!w || !h) return;
    var cols = Math.max(2, Math.round(w / Math.sqrt(w * h * 16 / 9 / MAX_TILES)));
    var rows = function () { return Math.ceil(h / (w / cols * 9 / 16)); };
    while (cols > 2 && cols * rows() > MAX_TILES) cols--;
    wall.style.setProperty('--cols', cols);
    wall.style.visibility = '';
    // data-view="masks" picks the SAM3-mask copies (clip_<id>_masks.mp4)
    var suffix = wall.dataset.view ? '_' + wall.dataset.view : '';
    var order = WALL_CLIPS.slice().sort(function () { return Math.random() - 0.5; });
    var tiles = [];
    for (var i = 0, n = cols * rows(); i < n; i++) {
      var v = document.createElement('video');
      v.className = 'bg';
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.wallSrc = './static/media/wall/clip_' + order[i % order.length] + suffix + '.mp4';
      // seek only once the (small) clip is fully buffered: an earlier seek
      // can stall on servers without range requests, or be dropped mid-play()
      v.wallOffset = Math.random();
      SEEK_EVENTS.forEach(function (type) { v.addEventListener(type, seekToOffset); });
      tiles.push(v);
    }
    // All tiles go in at once so the grid never reflows, but their players
    // start a few per frame: creating ~30 decoders (and their first seeks) in
    // one frame stalls the scrolling and reveal transitions running meanwhile.
    tiles.forEach(function (v) { wall.appendChild(v); });
    var run = wall.buildRun = (wall.buildRun || 0) + 1;
    (function startSome() {
      if (wall.buildRun !== run) return;
      tiles.splice(0, TILES_PER_FRAME).forEach(function (v) {
        v.src = v.wallSrc;
        if (wall.closest('.slide').classList.contains('is-shown') && !reduceMotion.matches && !document.hidden) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        }
      });
      if (tiles.length) requestAnimationFrame(startSome);
    })();
  }

  function seekToOffset() {
    if (this.seeded || this.readyState < 4 || !this.duration) return;
    this.currentTime = this.wallOffset * this.duration;
    if (this.currentTime > 0.05 || this.wallOffset < 0.02) {
      this.seeded = true;
      var v = this;
      SEEK_EVENTS.forEach(function (type) { v.removeEventListener(type, seekToOffset); });
    }
  }

  function clearWall(wall) {
    clearTimeout(wall.clearTimer);
    wall.clearTimer = null;
    wall.buildRun = (wall.buildRun || 0) + 1;
    wall.querySelectorAll('video').forEach(function (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();   // releases the player
      wall.removeChild(v);
    });
  }

  // Leaving a wall's slide hides and pauses it at once (as removing it did),
  // but releasing ~30 players is itself slow, so that waits until the slide
  // has scrolled away.
  var WALL_CLEAR_DELAY = 1200;   // ms

  function showWall(wall) {
    if (wall.clearTimer) clearWall(wall);   // rebuilt fresh, as before
    if (!wall.firstChild) buildWall(wall);
  }

  function hideWall(wall) {
    if (!wall.firstChild || wall.clearTimer) return;
    wall.style.visibility = 'hidden';
    wall.querySelectorAll('video').forEach(function (v) { v.pause(); });
    wall.clearTimer = setTimeout(function () {
      wall.clearTimer = null;
      clearWall(wall);
    }, WALL_CLEAR_DELAY);
  }

  var wallTimer;
  window.addEventListener('resize', function () {
    clearTimeout(wallTimer);
    wallTimer = setTimeout(function () {
      shownSlides().forEach(function (slide) {
        var wall = slide.querySelector('.clip-wall');
        if (wall) { buildWall(wall); playVideos(slide); }
      });
    }, 200);
  });

  // Clips in a [data-sync] row show the same moment through different stages,
  // so the others follow the first one whenever they drift apart.
  setInterval(function () {
    if (document.hidden) return;
    shownSlides().forEach(function (slide) {
      slide.querySelectorAll('[data-sync]').forEach(syncRow);
    });
  }, 250);

  function syncRow(row) {
    var vids = row.querySelectorAll('video');
    var master = vids[0];
    if (!master || master.paused) return;
    for (var i = 1; i < vids.length; i++) {
      if (!vids[i].seeking && Math.abs(vids[i].currentTime - master.currentTime) > 0.08) {
        vids[i].currentTime = master.currentTime;
      }
    }
  }

  // Nothing plays in a background tab; coming back resumes the shown slides'
  // clips where they were.
  document.addEventListener('visibilitychange', function () {
    shownSlides().forEach(function (slide) {
      slide.querySelectorAll('video').forEach(function (v) {
        if (document.hidden) { v.pause(); return; }
        if (!v.getAttribute('src') || (reduceMotion.matches && v.classList.contains('bg'))) return;
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      });
    });
  });

  // ---------- Count-ups: [data-count] numbers tick up as they appear ----------
  function format(n, el) {
    if (el.dataset.sep) return Math.round(n).toLocaleString('en-US');
    return n.toFixed(+(el.dataset.decimals || 0));
  }

  function countUp(slide) {
    slide.querySelectorAll('[data-count]').forEach(function (el) {
      var target = +el.dataset.count;
      if (reduceMotion.matches) { el.textContent = format(target, el); return; }
      var start = performance.now() + 350;
      var run = el.countRun = (el.countRun || 0) + 1;
      el.textContent = format(0, el);
      requestAnimationFrame(function tick(now) {
        if (el.countRun !== run) return;
        var t = Math.min(1, Math.max(0, (now - start) / 900));
        el.textContent = format(target * (1 - Math.pow(1 - t, 3)), el);
        if (t < 1) requestAnimationFrame(tick);
      });
    });
  }

  if ('IntersectionObserver' in window) {
    // A thin band across the middle of the screen decides the active slide
    // (nav state), which also works for slides taller than the viewport on
    // small screens.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) activate(entry.target);
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    // A slide is shown once its top is 15% of the way up the screen, and
    // stays shown until it is completely off screen, so nothing resets or
    // replays while any of it is still visible.
    var showIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) show(entry.target);
      });
    }, { rootMargin: '0px 0px -15% 0px' });
    var hideIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) hide(entry.target);
      });
    });
    slides.forEach(function (s) { io.observe(s); showIO.observe(s); hideIO.observe(s); });
  } else {
    slides.forEach(function (s) { s.classList.add('is-active', 'is-shown'); });
  }

  // ---------- Charts ----------
  var NS = 'http://www.w3.org/2000/svg';

  function el(svg, name, attrs, text) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    svg.appendChild(e);
    return e;
  }

  function delay(e, seconds) {
    e.style.setProperty('--d', seconds + 's');
    return e;
  }

  // mAP@IoU (%) from the paper's main results table, IoU 0.1–0.9 (the
  // averages, IoU 0.1–0.7, are in the legend in index.html)
  var IOU = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  var SERIES = [
    { name: 'MIL classifier',  cls: 's-mil',   v: [29.9, 23.5, 14.7, 9.6, 5.4, 2.2, 0.2, 0.1, 0.0] },
    { name: 'MIL + post-proc', cls: 's-milpp', v: [44.3, 33.3, 20.7, 10.2, 2.6, 0.6, 0.2, 0.1, 0.1] },
    { name: 'ASM-Loc',         cls: 's-asm',   v: [18.2, 14.6, 10.9, 7.0, 4.1, 2.3, 1.2, 0.3, 0.0] },
    { name: 'HR-Pro',          cls: 's-hrpro', v: [30.6, 26.1, 19.2, 10.9, 6.7, 3.7, 1.2, 0.4, 0.1] },
    { name: 'ActionFormer',    cls: 's-af',    v: [29.2, 28.2, 26.6, 25.4, 22.7, 19.0, 14.4, 8.6, 3.1] },
    { name: 'FSH-TAL (ours)',  cls: 's-ours',  v: [51.7, 49.3, 47.0, 43.2, 38.7, 32.8, 24.1, 13.7, 3.9] }
  ];

  // Per-behavior AP (%), IoU 0.1–0.7, with annotated events and recordings
  // containing it, from the paper's per-behavior table; sorted by AP
  var BEHAVIORS = [
    { name: 'Tilt',   ap: 49.4, events: '594',   recs: 11, color: 'var(--c6)' },
    { name: 'Peck',   ap: 48.3, events: '529',   recs: 11, color: 'var(--c4)' },
    { name: 'Lead',   ap: 43.4, events: '1,455', recs: 16, color: 'var(--c3)' },
    { name: 'Quiver', ap: 42.6, events: '1,262', recs: 17, color: 'var(--c5)' },
    { name: 'Bite',   ap: 35.9, events: '3,516', recs: 15, color: 'var(--c1)' },
    { name: 'Chase',  ap: 35.2, events: '846',   recs: 12, color: 'var(--c2)' }
  ];

  function buildMapChart(svg) {
    var L = 58, R = 706, T = 18, B = 346;
    function X(i) { return L + (IOU[i] - 0.1) / 0.8 * (R - L); }
    function Y(v) { return B - v / 60 * (B - T); }
    for (var v = 0; v <= 60; v += 10) {
      el(svg, 'line', { x1: L, x2: R, y1: Y(v), y2: Y(v), class: 'grid' });
      el(svg, 'text', { x: L - 10, y: Y(v) + 5, 'text-anchor': 'end', class: 'tick' }, v);
    }
    IOU.forEach(function (t, i) {
      el(svg, 'text', { x: X(i), y: B + 22, 'text-anchor': 'middle', class: 'tick' }, t.toFixed(1));
    });
    el(svg, 'text', { x: (L + R) / 2, y: B + 48, 'text-anchor': 'middle', class: 'axis' }, 'IoU threshold');
    el(svg, 'text', { x: 14, y: (T + B) / 2, 'text-anchor': 'middle', class: 'axis',
                      transform: 'rotate(-90 14 ' + (T + B) / 2 + ')' }, 'mAP (%)');
    SERIES.forEach(function (s, k) {
      var d = s.v.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
      var ours = s.cls === 's-ours';
      var path = el(svg, 'path', { d: d, class: 'line ' + s.cls + (ours ? ' draw' : ' pop') });
      el(path, 'title', {}, s.name + ': ' + s.v.map(function (v, i) {
        return 'IoU ' + IOU[i].toFixed(1) + ' ' + v.toFixed(1) + '%';
      }).join(', '));
      if (ours) {
        path.style.setProperty('--len', Math.ceil(path.getTotalLength() + 2));
        path.style.setProperty('--dur', '1.4s');
        delay(path, 1.4);
      } else {
        delay(path, 0.4 + k * 0.15);
      }
    });
    SERIES[5].v.forEach(function (v, i) {
      var dot = delay(el(svg, 'circle', { cx: X(i), cy: Y(v), r: 5, class: 'dot pop' }), 1.5 + i * 0.16);
      el(dot, 'title', {}, 'FSH-TAL, IoU ' + IOU[i].toFixed(1) + ': ' + v.toFixed(1) + '% mAP');
    });
    delay(el(svg, 'text', { x: X(0) + 10, y: Y(51.7) - 12, class: 'dlabel ours pop' }, 'FSH-TAL (ours)'), 2.6);
    delay(el(svg, 'text', { x: X(2) + 10, y: Y(26.6) - 12, class: 'dlabel pop' }, 'ActionFormer'), 1.3);
  }

  function buildApChart(svg) {
    var L = 60, R = 710, T = 30, B = 320, MAX = 60;
    var band = (R - L) / BEHAVIORS.length, w = 76;
    function Y(v) { return B - v / MAX * (B - T); }
    for (var v = 0; v <= MAX; v += 20) {
      el(svg, 'line', { x1: L, x2: R, y1: Y(v), y2: Y(v), class: 'grid' });
      el(svg, 'text', { x: L - 10, y: Y(v) + 5, 'text-anchor': 'end', class: 'tick' }, v);
    }
    el(svg, 'text', { x: 16, y: (T + B) / 2, 'text-anchor': 'middle', class: 'axis',
                      transform: 'rotate(-90 16 ' + (T + B) / 2 + ')' }, 'AP (%)');
    BEHAVIORS.forEach(function (b, i) {
      var cx = L + band * (i + 0.5), x = cx - w / 2, y = Y(b.ap), r = 4;
      // rounded top corners only; the bar sits square on the baseline
      var d = 'M' + x + ',' + B + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
              'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + B + 'Z';
      var bar = delay(el(svg, 'path', { d: d, fill: b.color, class: 'grow' }), 0.4 + i * 0.12);
      el(bar, 'title', {}, b.name + ': ' + b.ap.toFixed(1) + '% AP, ' + b.events + ' events in ' + b.recs + ' recordings');
      delay(el(svg, 'text', { x: cx, y: y - 10, 'text-anchor': 'middle', class: 'bar-val pop' }, b.ap.toFixed(1)), 1.2 + i * 0.08);
      el(svg, 'text', { x: cx, y: B + 28, 'text-anchor': 'middle', class: 'bar-name' }, b.name);
      el(svg, 'text', { x: cx, y: B + 50, 'text-anchor': 'middle', class: 'tick' }, b.events + ' · ' + b.recs);
    });
    el(svg, 'line', { x1: L, x2: R, y1: B, y2: B, class: 'base' });
    el(svg, 'text', { x: (L + R) / 2, y: B + 88, 'text-anchor': 'middle', class: 'sub' },
       'annotated events · recordings containing the behavior');
  }

  var mapChart = document.getElementById('map-chart');
  var apChart = document.getElementById('ap-chart');
  if (mapChart) buildMapChart(mapChart);
  if (apChart) buildApChart(apChart);

  // ---------- Dataset: raw / masks / tracks ----------
  var segmented = document.querySelector('#dataset .segmented');
  if (segmented) {
    var tiles = Array.prototype.slice.call(document.querySelectorAll('#dataset .tile'));
    segmented.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.getAttribute('aria-pressed') === 'true') return;
      segmented.querySelectorAll('button').forEach(function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      tiles.forEach(function (tile) {
        var video = tile.querySelector('video');
        video.classList.add('is-swapping');
        setTimeout(function () {
          video.src = './static/media/beh_' + tile.dataset.behavior + '_' + b.dataset.view + '.mp4';
          video.addEventListener('loadeddata', function () { video.classList.remove('is-swapping'); }, { once: true });
          var p = video.play();
          if (p && p.catch) p.catch(function () {});
        }, 200);
      });
    });
  }

  // ---------- Copy BibTeX ----------
  var copy = document.getElementById('copy-bibtex');
  var bibtex = document.getElementById('bibtex');
  if (copy && bibtex && navigator.clipboard) {
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(bibtex.textContent).then(function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy BibTeX'; }, 2000);
      });
    });
  } else if (copy) {
    copy.hidden = true;
  }
})();
