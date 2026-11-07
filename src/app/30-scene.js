/* ============================================================
 * 30-scene.js — three.js 场景：零件 / 视图 / 剖视 / 标注
 * 依赖全局 THREE 与 FSG.Geometry
 * ============================================================ */
'use strict';

FSG.Scene = (function () {
  'use strict';
  var T = THREE;

  var hostEl = null, canvasEl = null;
  var renderer = null, scene = null, camera = null, controls = null;
  var root = null, ground = null, contact = null;
  var part = null, edges = null, wire = null, cap = null, capEdges = null, dimGroup = null;
  var matPart = null, matEdge = null, matWire = null, matCap = null, matCapEdge = null;
  var clipPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);   /* 裁掉 y<0，剖面朝 -y 相机 */
  var state = { view: 'iso', dims: 1, section: 0, wire: 0, auto: 0 };
  var result = null, derived = null;
  var box = new T.Box3(), fitR = 50;
  var tween = null, booted = false;

  function viewDir(name) {
    var v;
    switch (name) {
      case 'front': v = new T.Vector3(0, -1, 0.05); break;
      case 'side': v = new T.Vector3(1, -0.02, 0.05); break;
      case 'top': v = new T.Vector3(0, -0.001, 1); break;
      case 'bottom': v = new T.Vector3(0.55, -0.92, -0.78); break;
      case 'section': v = new T.Vector3(0.22, -1, 0.28); break;
      default: v = new T.Vector3(0.86, -1.05, 0.92); break;
    }
    return v.normalize();
  }
  function viewUp(name) { return (name === 'top') ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1); }

  function targetPoint() { return new T.Vector3(0, 0, derived ? derived.H * 0.5 : 5); }

  function fitDistance() {
    var w = canvasEl ? canvasEl.clientWidth : 0;
    var h = canvasEl ? canvasEl.clientHeight : 0;
    if (w > 0 && h > 0) camera.aspect = w / h;
    var vHalf = camera.fov * Math.PI / 360;
    var hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.35, camera.aspect));
    return fitR / Math.sin(Math.min(vHalf, hHalf)) * 1.0;
  }

  function init(canvas, host) {
    canvasEl = canvas;
    hostEl = host;
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0xe9edf1, 1);
    renderer.localClippingEnabled = true;
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;

    scene = new T.Scene();
    camera = new T.PerspectiveCamera(32, 1, 0.5, 3000);
    camera.up.set(0, 0, 1);
    camera.position.set(130, -150, 120);

    scene.add(new T.HemisphereLight(0xffffff, 0x8e99a4, 0.45));
    var key = new T.DirectionalLight(0xfff6e8, 1.25);
    key.position.set(110, -170, 260);
    scene.add(key);
    var fill = new T.DirectionalLight(0xd5e3f2, 0.22);
    fill.position.set(-160, -80, 120);
    scene.add(fill);
    var rim = new T.DirectionalLight(0xffffff, 0.14);
    rim.position.set(40, 200, 160);
    scene.add(rim);
    var under = new T.DirectionalLight(0xdbe6f2, 0.55);
    under.position.set(-60, 40, -180);
    scene.add(under);

    buildGround();
    buildContactShadow();

    root = new T.Group();
    scene.add(root);

    controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 20;
    controls.maxDistance = 1200;
    controls.maxPolarAngle = Math.PI * 0.995;
    controls.autoRotateSpeed = 1.1;
    controls.addEventListener('start', function () { tween = null; });

    window.addEventListener('resize', resize);
    if (window.ResizeObserver && hostEl) {
      try { new ResizeObserver(resize).observe(hostEl); } catch (e) { /* ignore */ }
    }
    renderer.domElement.addEventListener('dblclick', function () { setView(state.view, false); });

    resize();
    renderer.setAnimationLoop(animate);
    booted = true;
    document.documentElement.setAttribute('data-webgl', 'ok');
  }

  function buildGround() {
    ground = new T.Group();
    ground.add(new T.Mesh(
      new T.PlaneGeometry(1200, 1200),
      new T.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 1, metalness: 0 })
    ));
    function grid(step, color, opacity, size) {
      var pts = [];
      for (var i = -size; i <= size; i += step) {
        pts.push(-size, i, 0, size, i, 0);
        pts.push(i, -size, 0, i, size, 0);
      }
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      var m = new T.LineBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false });
      var l = new T.LineSegments(g, m);
      l.position.z = -0.02;
      return l;
    }
    ground.add(grid(10, 0xdfe5ea, 0.75, 200));
    ground.add(grid(50, 0xc9d3db, 0.9, 200));
    scene.add(ground);
  }

  function buildContactShadow() {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(128, 128, 8, 128, 128, 126);
    g.addColorStop(0, 'rgba(15,23,42,0.42)');
    g.addColorStop(0.5, 'rgba(15,23,42,0.20)');
    g.addColorStop(1, 'rgba(15,23,42,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    var tex = new T.CanvasTexture(c);
    contact = new T.Mesh(
      new T.PlaneGeometry(1, 1),
      new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 })
    );
    contact.renderOrder = 1;
    scene.add(contact);
  }

  function resize() {
    if (!renderer || !hostEl) return;
    var w = hostEl.clientWidth, h = hostEl.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function disposeObj(obj) {
    if (!obj) return;
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    if (obj.parent) obj.parent.remove(obj);
  }
  function clearGroup(g) {
    if (!g) return;
    while (g.children.length) disposeObj(g.children[0]);
  }

  function makeLabel(text, colorCss) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    var r = 26;
    ctx.beginPath();
    ctx.moveTo(16 + r, 18);
    ctx.arcTo(496, 18, 496, 110, r);
    ctx.arcTo(496, 110, 16, 110, r);
    ctx.arcTo(16, 110, 16, 18, r);
    ctx.arcTo(16, 18, 496, 18, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = colorCss;
    ctx.stroke();
    ctx.fillStyle = colorCss;
    ctx.font = '700 52px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 66);
    var tex = new T.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.encoding = T.sRGBEncoding;
    var spr = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    spr.scale.set(24, 6, 1);
    spr.renderOrder = 30;
    return spr;
  }

  function buildDims() {
    if (!derived) return;
    dimGroup = new T.Group();
    var xo = derived.W / 2 + 7;
    var L = derived.H;
    var css = '#0e7490';
    var pts = [xo, 0, 0, xo, 0, L,
      xo - 1.6, 0, 0, xo + 1.6, 0, 0,
      xo - 1.6, 0, L, xo + 1.6, 0, L];
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    dimGroup.add(new T.LineSegments(g, new T.LineBasicMaterial({
      color: new T.Color(css), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false
    })));
    var lab = makeLabel('总高 ' + FSG.fmt(L, 2), css);
    lab.position.set(xo + 2.5, 0, L * 0.5);
    dimGroup.add(lab);

    var spec;
    if (derived.mode === 'cone') {
      var etD = derived.extThread;
      spec = derived.params.extThreadKey === 'custom'
        ? ('M' + FSG.fmt(etD.D, 1) + '×' + FSG.fmt(etD.P, 2))
        : etD.key.replace('x', '×');
    } else if (derived.holeMode === 'thread') {
      spec = derived.params.threadKey === 'custom'
        ? ('M' + FSG.fmt(derived.thread.D, 1) + '×' + FSG.fmt(derived.thread.P, 2))
        : derived.thread.key.replace('x', '×');
    } else {
      spec = '⌀' + FSG.fmt(derived.holeD, 1);
    }
    var lab2 = makeLabel(spec, '#b45309');
    lab2.position.set(0, -derived.W / 2 - 8, L);
    dimGroup.add(lab2);
    root.add(dimGroup);
    dimGroup.visible = !!state.dims;
  }

  function buildContent() {
    clearGroup(root);
    part = edges = wire = cap = capEdges = null;
    matPart = matEdge = matWire = matCap = matCapEdge = null;
    dimGroup = null;
    if (!result) return;

    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(result.positions, 3));
    g.setIndex(new T.BufferAttribute(result.indices, 1));
    g.computeVertexNormals();
    matPart = new T.MeshStandardMaterial({
      color: 0xc9c1b2, roughness: 0.70, metalness: 0.06,
      flatShading: true, clippingPlanes: []
    });
    part = new T.Mesh(g, matPart);
    root.add(part);

    matEdge = new T.LineBasicMaterial({
      color: 0x9a907e, transparent: true, opacity: 0.55, depthWrite: false, clippingPlanes: []
    });
    edges = new T.LineSegments(new T.EdgesGeometry(g, 28), matEdge);
    edges.renderOrder = 4;
    root.add(edges);

    var wg = new T.BufferGeometry();
    wg.setAttribute('position', new T.BufferAttribute(result.positions.slice(0), 3));
    wg.setIndex(new T.BufferAttribute(result.indices.slice(0), 1));
    matWire = new T.MeshBasicMaterial({
      color: 0x64748b, wireframe: true, transparent: true, opacity: 0.14,
      depthWrite: false, clippingPlanes: []
    });
    wire = new T.Mesh(wg, matWire);
    wire.renderOrder = 5;
    root.add(wire);

    var sm = FSG.Geometry.sectionMesh(derived);
    var cg = new T.BufferGeometry();
    cg.setAttribute('position', new T.BufferAttribute(sm.positions, 3));
    cg.setIndex(new T.BufferAttribute(sm.indices, 1));
    cg.computeVertexNormals();
    matCap = new T.MeshStandardMaterial({
      color: 0xe4a244, roughness: 0.82, metalness: 0.02, flatShading: true, side: T.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    cap = new T.Mesh(cg, matCap);
    cap.renderOrder = 2;
    root.add(cap);
    matCapEdge = new T.LineBasicMaterial({ color: 0x8a5f1e, transparent: true, opacity: 0.8, depthWrite: false });
    capEdges = new T.LineSegments(new T.EdgesGeometry(cg, 18), matCapEdge);
    capEdges.renderOrder = 3;
    root.add(capEdges);

    buildDims();

    box.setFromBufferAttribute(g.getAttribute('position'));
    var size = box.getSize(new T.Vector3());
    fitR = Math.max(10, size.length() * 0.5);
    if (contact) {
      contact.position.set(0, 0, 0.03);
      contact.scale.set(size.x * 1.7, size.y * 1.7, 1);
    }
    applyState();
  }

  function applyState() {
    var clip = state.section ? [clipPlane] : [];
    /* 裁剪面数量变化需要重编译着色器 */
    function setClip(mat) {
      if (!mat) return;
      mat.clippingPlanes = clip;
      mat.needsUpdate = true;
    }
    setClip(matPart);
    setClip(matWire);
    setClip(matEdge);
    if (cap) cap.visible = !!state.section;
    if (capEdges) capEdges.visible = !!state.section;
    if (dimGroup) dimGroup.visible = !!state.dims;
    if (wire) wire.visible = !!state.wire;
  }

  function setView(name, instant) {
    state.view = name;
    if (ground) ground.visible = (name !== 'bottom');
    var target = targetPoint();
    var pos = target.clone().addScaledVector(viewDir(name), fitDistance());
    var up = viewUp(name);
    if (instant) {
      tween = null;
      camera.up.copy(up);
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }
    tween = {
      p0: camera.position.clone(), p1: pos,
      t0: controls.target.clone(), t1: target,
      u0: camera.up.clone(), u1: up,
      start: performance.now(), dur: 520
    };
  }

  function frameNow() {
    tween = null;
    var target = targetPoint();
    camera.up.copy(viewUp(state.view));
    camera.position.copy(target.clone().addScaledVector(viewDir(state.view), fitDistance()));
    controls.target.copy(target);
    controls.update();
  }

  function animate() {
    var now = performance.now();
    if (tween) {
      var k = Math.min(1, (now - tween.start) / tween.dur);
      var e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.t0, tween.t1, e);
      camera.up.lerpVectors(tween.u0, tween.u1, e).normalize();
      if (k >= 1) tween = null;
    }
    controls.autoRotate = !!state.auto && !tween;
    controls.update();
    renderer.render(scene, camera);
  }

  function update(res) {
    result = res;
    derived = res ? res.derived : null;
    var hadBox = !box.isEmpty();
    buildContent();
    if (!hadBox || !booted) { booted = true; frameNow(); return; }
    controls.target.copy(targetPoint());
  }

  function setState(patch) {
    Object.keys(patch || {}).forEach(function (k) { if (k in state) state[k] = patch[k]; });
    applyState();
    if (patch && (patch.section !== undefined || patch.view !== undefined)) {
      if (patch.view !== undefined) setView(patch.view);
      else setView(state.view);
    }
  }

  function getState() { return Object.assign({}, state); }

  function screenshot() {
    tween = null;
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  return {
    init: init, update: update, setState: setState, getState: getState,
    setView: setView, frameNow: frameNow, screenshot: screenshot, resize: resize,
    clipPlane: clipPlane,
    debug: function () {
      return {
        section: state.section,
        localClipping: renderer ? renderer.localClippingEnabled : null,
        clipLen: matPart ? matPart.clippingPlanes.length : -1,
        capVisible: cap ? cap.visible : null,
        capTris: cap && cap.geometry && cap.geometry.index ? cap.geometry.index.count / 3 : -1,
        normal: [clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z],
        constant: clipPlane.constant
      };
    }
  };
})();
