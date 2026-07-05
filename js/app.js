/* ====== 全局数据 ====== */
let allProducts = [];
let pageHistory = [];
let currentWarehouse = 'all';

/* ====== 初始化 ====== */
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  renderContacts();
});

/* ====== 数据加载 ====== */
async function loadData() {
  try {
    const res = await fetch('data/products.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    allProducts = await res.json();
    renderNewProducts();
  } catch (e) {
    console.error('加载数据失败:', e);
    document.getElementById('newProductsList').innerHTML = '<p style="padding:20px;text-align:center;color:#999;">加载失败，请刷新重试</p>';
  }
}

/* ====== 页面导航 ====== */
function goHome() {
  showPage('page-home');
  updateNav('home');
}

function goCategory(category) {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-list');
  updateNav('list');
  const sel = document.getElementById('filterCategory');
  if (sel) sel.value = category;
  applyFilter();
  const titleEl = document.querySelector('.page-back-title');
  if (titleEl) titleEl.textContent = category || '全部产品';
}

function goInventory() {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-inventory');
  updateNav('inventory');
  renderInventory();
}

function goCustom() {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-custom');
  updateNav('custom');
}

function goContact() {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-contact');
  updateNav('contact');
}

function goBack() {
  if (pageHistory.length > 0) {
    const prev = pageHistory.pop();
    showPage(prev.page);
    if (prev.page === 'page-home') updateNav('home');
    else if (prev.page === 'page-list') updateNav('list');
    else if (prev.page === 'page-inventory') updateNav('inventory');
    else if (prev.page === 'page-custom') updateNav('custom');
    else if (prev.page === 'page-contact') updateNav('contact');
  } else {
    goHome();
  }
}

function showPage(pageId) {
  if (pageId === 'search') {
    document.getElementById('globalSearch').focus();
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  window.scrollTo(0, 0);
}

function updateNav(activeType) {
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
  const navMap = {
    'home': 0, 'list': 1, 'inventory': 2, 'custom': 2, 'contact': 2, 'search': 3,
    'detail': 1
  };
  const idx = navMap[activeType];
  if (idx !== undefined) {
    const items = document.querySelectorAll('.bottom-nav .nav-item');
    if (items[idx]) items[idx].classList.add('active');
  }
}

/* ====== 排序和图片渲染辅助函数 ====== */
function getSortPriority(p) {
  var hasStock = (p.inventory && p.inventory.total > 0);
  var hasImg = (p.images && p.images.length > 0);
  if (hasStock && hasImg) return 3;
  if (hasStock && !hasImg) return 2;
  return 1;
}
function sortByPriority(products) {
  return products.sort(function(a, b) {
    return getSortPriority(b) - getSortPriority(a);
  });
}
function getProductImageHTML(p, isLazy) {
  if (p.images && p.images.length > 0) {
    if (isLazy) {
      return '<div class="skeleton"></div><img class="lazy-img" data-src="images/' + p.images[0] + '" alt="' + p.name + '" loading="lazy">';
    } else {
      return '<img class="lazy-img loaded" src="images/' + p.images[0] + '" alt="' + p.name + '" style="opacity:1">';
    }
  } else {
    return '<div class="no-img-placeholder">图片暂无</div>';
  }
}

/* ====== 新品专区 ====== */
function renderNewProducts() {
  const container = document.getElementById('newProductsList');
  if (!container) return;
  var newProducts = allProducts.filter(function(p) { return p.is_new; });
  newProducts = sortByPriority(newProducts).slice(0, 21);
  if (!newProducts.length) { container.innerHTML = '<p style="padding:20px;text-align:center;color:#999;">暂无新品</p>'; return; }

  container.innerHTML = newProducts.map(function(p) {
    return '<div class="new-card" onclick="renderProductDetail(\'' + p.product_code_74 + '\')">' +
      '<div class="new-card-img-wrap">' +
        getProductImageHTML(p, true) +
      '</div>' +
      '<div class="new-card-body">' +
        '<div class="new-card-name">' + p.name + '</div>' +
        '<div class="new-card-price">' + (p.purchase_price ? '¥' + p.purchase_price : '面议') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.new-card'));
}

/* Transform-based 新品滑动 */

/* Transform-based 新品滑动 */
let newScrollPos = 0;
function initNewScrollTransform() {
  const track = document.getElementById('newProductsList');
  if (!track) return;
  let isDown = false, startX = 0, startPos = 0;
  let velocity = 0, lastX = 0, lastTime = 0, rafId = null;
  const gap = 12, cardW = 160;

  function getMax() {
    const totalW = track.scrollWidth;
    const wrapW = track.parentElement ? track.parentElement.clientWidth : window.innerWidth;
    return Math.min(0, wrapW - totalW);
  }
  function setPos(x) {
    const max = getMax();
    newScrollPos = Math.max(max, Math.min(0, x));
    track.style.transform = 'translateX(' + newScrollPos + 'px)';
  }

  track.addEventListener('mousedown', function(e) { isDown = true; startX = e.clientX; startPos = newScrollPos; velocity = 0; lastX = e.clientX; lastTime = Date.now(); track.style.transition = 'none'; if (rafId) cancelAnimationFrame(rafId); });
  window.addEventListener('mousemove', function(e) { if (!isDown) return; var now = Date.now(), dt = now - lastTime || 16; velocity = (e.clientX - lastX) / dt * 16; lastX = e.clientX; lastTime = now; var cur = startPos + (e.clientX - startX); var max = getMax(); if (cur > 0) cur = (e.clientX - startX) * 0.4; else if (cur < max) cur = max + (e.clientX - startX - (max - startPos)) * 0.4; setPos(cur); });
  window.addEventListener('mouseup', function() {
    if (!isDown) return; isDown = false;
    var max = getMax();
    if (newScrollPos > 0 || newScrollPos < max) { track.style.transition = 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)'; setPos(newScrollPos > 0 ? 0 : max); return; }
    var pos = newScrollPos, v = velocity * 8;
    (function inertia() { v *= 0.93; pos += v; if (Math.abs(v) < 0.3) { snap(); return; } var m = getMax(); if (pos > 0) { pos = 0; v = -v * 0.3; } if (pos < m) { pos = m; v = -v * 0.3; } setPos(pos); rafId = requestAnimationFrame(inertia); })();
  });
  track.addEventListener('touchstart', function(e) { isDown = true; startX = e.touches[0].clientX; startPos = newScrollPos; velocity = 0; lastX = e.touches[0].clientX; lastTime = Date.now(); track.style.transition = 'none'; if (rafId) cancelAnimationFrame(rafId); }, {passive:true});
  track.addEventListener('touchmove', function(e) { if (!isDown) return; var now = Date.now(), dt = now - lastTime || 16; var cx = e.touches[0].clientX; velocity = (cx - lastX) / dt * 16; lastX = cx; lastTime = now; var cur = startPos + (cx - startX); var max = getMax(); if (cur > 0) cur = (cx - startX) * 0.4; else if (cur < max) cur = max + (cx - startX - (max - startPos)) * 0.4; setPos(cur); }, {passive:true});
  track.addEventListener('touchend', function() { if (!isDown) return; isDown = false; var max = getMax(); if (newScrollPos > 0 || newScrollPos < max) { track.style.transition = 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)'; setPos(newScrollPos > 0 ? 0 : max); return; } var pos = newScrollPos, v = velocity * 8; (function inertia() { v *= 0.93; pos += v; if (Math.abs(v) < 0.3) { snap(); return; } var m = getMax(); if (pos > 0) { pos = 0; v = -v * 0.3; } if (pos < m) { pos = m; v = -v * 0.3; } setPos(pos); rafId = requestAnimationFrame(inertia); })(); });
  window.addEventListener('resize', function() { setPos(newScrollPos); });

  function snap() {
    var max = getMax();
    if (newScrollPos > 0) { setPos(0); return; }
    if (newScrollPos < max) { setPos(max); return; }
    var step = cardW + gap;
    var idx = Math.round(-newScrollPos / step);
    track.style.transition = 'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
    setPos(-idx * step);
  }
}

function scrollNewProducts(dir) {
  var track = document.getElementById('newProductsList');
  if (!track) return;
  var step = (160 + 12) * 2;
  var max = Math.min(0, track.parentElement.clientWidth - track.scrollWidth);
  var target = newScrollPos + (dir > 0 ? -step : step);
  target = Math.max(max, Math.min(0, target));
  track.style.transition = 'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
  newScrollPos = target;
  track.style.transform = 'translateX(' + target + 'px)';
}

/* ====== 产品列表筛选 ====== */
function applyFilter() {
  var cat = document.getElementById('filterCategory');
  cat = cat ? cat.value : '';
  var price = document.getElementById('filterPrice');
  price = price ? price.value : '';
  var stock = document.getElementById('filterStock');
  stock = stock ? stock.value : '';
  var sort = document.getElementById('sortBy');
  sort = sort ? sort.value : 'code';

  var filtered = allProducts.slice();
  if (cat) filtered = filtered.filter(function(p) { return p.category === cat; });

  if (price) {
    filtered = filtered.filter(function(p) {
      var pr = p.purchase_price;
      if (!pr && pr !== 0) return false;
      if (price === '0-50') return pr >= 0 && pr <= 50;
      if (price === '50-100') return pr > 50 && pr <= 100;
      if (price === '100-200') return pr > 100 && pr <= 200;
      if (price === '200-500') return pr > 200 && pr <= 500;
      if (price === '500+') return pr > 500;
      return true;
    });
  }

  if (stock) {
    filtered = filtered.filter(function(p) {
      var inv = p.inventory ? p.inventory.total : 0;
      if (stock === 'in') return inv > 0;
      if (stock === 'low') return inv > 0 && inv < 50;
      if (stock === 'out') return inv === 0;
      return true;
    });
  }

  if (sort === 'price-asc') filtered.sort(function(a,b) { return (a.purchase_price||0) - (b.purchase_price||0); });
  else if (sort === 'price-desc') filtered.sort(function(a,b) { return (b.purchase_price||0) - (a.purchase_price||0); });
  else if (sort === 'stock') filtered.sort(function(a,b) { return ((b.inventory&&b.inventory.total)||0) - ((a.inventory&&a.inventory.total)||0); });
  else filtered = sortByPriority(filtered);

  var countEl = document.getElementById('listCount');
  if (countEl) countEl.textContent = '共 ' + filtered.length + ' 款产品';

  var container = document.getElementById('productGrid');
  if (!container) return;
  if (!filtered.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">暂无相关产品</div></div>'; return; }

  container.innerHTML = filtered.map(function(p) {
    return '<div class="product-card" onclick="renderProductDetail(\'' + p.product_code_74 + '\')">' +
      '<div class="product-img-wrap">' +
        getProductImageHTML(p, true) +
      '</div>' +
      '<div class="product-card-body">' +
        '<div class="product-card-name">' + p.name + '</div>' +
        '<div class="product-card-meta">' +
          '<span class="product-card-price">' + (p.purchase_price ? '¥'+p.purchase_price : '面议') + '</span>' +
          '<span class="product-card-code">' + p.product_code_74 + '</span>' +
        '</div>' +
        '<span class="product-card-stock ' + getStockClass(p) + '">' + getStockText(p) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.product-card'));
}

function getStockClass(p) {
  var total = p.inventory ? p.inventory.total : 0;
  if (total > 20) return 'stock-in';
  if (total > 0) return 'stock-low';
  if (p.category === '荣誉体系') return 'stock-custom';
  if (p.category === '服装体系') return 'stock-demand';
  return 'stock-out';
}
function getStockText(p) {
  var total = p.inventory ? p.inventory.total : 0;
  if (total > 20) return '现货充足';
  if (total > 0) return '库存紧张';
  if (p.category === '荣誉体系') return '定制咨询';
  if (p.category === '服装体系') return '以需定采';
  return '缺货';
}

/* ====== 搜索 ====== */
function handleSearch(value) {
  // 实时搜索可选，当前留空
}

function doSearch() {
  var q = document.getElementById('globalSearch').value.trim().toLowerCase();
  if (!q) return;

  var results = allProducts.filter(function(p) {
    return p.name.toLowerCase().includes(q) ||
      p.product_code_74.includes(q) ||
      (p.product_code_69 && p.product_code_69.includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q));
  });
  results = sortByPriority(results);

  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-list');
  updateNav('list');

  var countEl = document.getElementById('listCount');
  if (countEl) countEl.textContent = '搜索"' + q + '"：共 ' + results.length + ' 款产品';

  var container = document.getElementById('productGrid');
  if (!container) return;
  if (!results.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">未找到相关产品</div></div>'; return; }

  container.innerHTML = results.map(function(p) {
    return '<div class="product-card" onclick="renderProductDetail(\'' + p.product_code_74 + '\')">' +
      '<div class="product-img-wrap">' +
        getProductImageHTML(p, true) +
      '</div>' +
      '<div class="product-card-body">' +
        '<div class="product-card-name">' + p.name + '</div>' +
        '<div class="product-card-meta">' +
          '<span class="product-card-price">' + (p.purchase_price ? '¥'+p.purchase_price : '面议') + '</span>' +
          '<span class="product-card-code">' + p.product_code_74 + '</span>' +
        '</div>' +
        '<span class="product-card-stock ' + getStockClass(p) + '">' + getStockText(p) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.product-card'));
  window.scrollTo(0, 0);
}

/* ====== 产品详情 ====== */
function renderProductDetail(code) {
  var p = allProducts.find(function(x) { return x.product_code_74 === code; });
  if (!p) return;

  var currentPage = document.querySelector('.page.active');
  pageHistory.push({page: currentPage ? currentPage.id : 'page-home', title: currentPage ? (currentPage.querySelector('.page-back-title') ? currentPage.querySelector('.page-back-title').textContent : '首页') : '首页'});
  showPage('page-detail');
  updateNav('detail');

  var imgs = (p.images || []).map(function(img) { return '<img src="images/' + img + '" alt="' + p.name + '">'; }).join('');
  var tags = [];
  if (p.is_new) tags.push('<span class="detail-tag tag-new">新品</span>');
  if (p.category) tags.push('<span class="detail-tag tag-category">' + p.category + '</span>');
  if (p.is_customizable) tags.push('<span class="detail-tag tag-custom">可定制</span>');

  var inv = p.inventory || {};
  var invRows = [
    ['北京总仓', inv.beijing || 0],
    ['昆山总仓', inv.kunshan || 0],
    ['东莞总仓', inv.dongguan || 0],
    ['成都总仓', inv.chengdu || 0],
    ['小库', inv.xiaoku || 0]
  ].map(function(row) { return '<tr><th>' + row[0] + '</th><td>' + row[1] + '</td></tr>'; }).join('');

  document.getElementById('detailContainer').innerHTML =
    '<div class="detail-carousel">' +
      '<div class="detail-carousel-track">' + (imgs || '<div style="padding:40px;text-align:center;color:#999;">暂无图片</div>') + '</div>' +
      '<div class="detail-carousel-dots"></div>' +
      '<div class="detail-back" onclick="goBack()">←</div>' +
    '</div>' +
    '<div class="detail-body">' +
      '<div class="detail-name">' + p.name + '</div>' +
      '<div class="detail-tags">' + tags.join('') + '</div>' +
      '<div class="detail-price-row">' +
        '<div class="detail-price-item"><div class="detail-price-label">批发价</div><div class="detail-price-value">' + (p.purchase_price ? '¥'+p.purchase_price : '面议') + '</div></div>' +
        '<div class="detail-price-item"><div class="detail-price-label">零售价</div><div class="detail-price-value purchase">' + (p.retail_price ? '¥'+p.retail_price : '面议') + '</div></div>' +
      '</div>' +
      '<div class="detail-info">' +
        '<h3>产品信息</h3>' +
        '<div class="info-row"><span class="info-label">74码</span><span class="info-value code">' + p.product_code_74 + '</span></div>' +
        '<div class="info-row"><span class="info-label">69码</span><span class="info-value">' + (p.product_code_69 || '-') + '</span></div>' +
        '<div class="info-row"><span class="info-label">品类</span><span class="info-value">' + (p.category || '-') + '</span></div>' +
        '<div class="info-row"><span class="info-label">材质</span><span class="info-value">' + (p.material || '详见说明') + '</span></div>' +
        '<div class="info-row"><span class="info-label">规格</span><span class="info-value">' + (p.spec || '详见说明') + '</span></div>' +
        '<div class="info-row"><span class="info-label">可定制</span><span class="info-value">' + (p.is_customizable ? '是' : '否') + '</span></div>' +
        '<div class="info-row"><span class="info-label">库存总量</span><span class="info-value">' + (inv.total || 0) + '</span></div>' +
        '<h3 style="margin-top:20px">分仓库存</h3>' +
        '<table class="inventory-table"><tbody>' + invRows + '</tbody></table>' +
      '</div>' +
    '</div>' +
    '<div class="detail-actions">' +
      '<div class="detail-action-btn btn-secondary" onclick="goBack()">返回</div>' +
      '<div class="detail-action-btn btn-primary" onclick="goContact()">联系采购</div>' +
    '</div>';

  initDetailCarousel();
  initTouchFeedback(document.querySelectorAll('.detail-action-btn'));
  window.scrollTo(0, 0);
}

function initDetailCarousel() {
  var track = document.querySelector('.detail-carousel-track');
  var dots = document.querySelector('.detail-carousel-dots');
  if (!track || !dots || track.children.length <= 1) return;
  var slides = track.children;
  var idx = 0;
  dots.innerHTML = Array.from(slides).map(function(_,i) { return '<div class="detail-carousel-dot ' + (i===0?'active':'') + '"></div>'; }).join('');

  function update() { track.style.transform = 'translateX(-' + idx*100 + '%)'; dots.querySelectorAll('.detail-carousel-dot').forEach(function(d,i) { d.classList.toggle('active', i===idx); }); }
  window.nextSlide = function() { idx = (idx + 1) % slides.length; update(); };
  window.prevSlide = function() { idx = (idx - 1 + slides.length) % slides.length; update(); };

  var startX = 0, curX = 0, swiping = false;
  track.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; swiping = true; }, {passive:true});
  track.addEventListener('touchmove', function(e) { if (!swiping) return; curX = e.touches[0].clientX; }, {passive:true});
  track.addEventListener('touchend', function() { if (!swiping) return; swiping = false; var dx = curX - startX; if (Math.abs(dx) > 50) { dx > 0 ? window.prevSlide() : window.nextSlide(); } });
}

/* ====== 库存查询 ====== */
function switchWarehouse(wh) {
  currentWarehouse = wh;
  var whLabels = {all:'全部', beijing:'北京总仓', kunshan:'昆山总仓', dongguan:'东莞总仓', chengdu:'成都总仓', xiaoku:'小库'};
  document.querySelectorAll('.warehouse-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.trim() === whLabels[wh]);
  });
  renderInventory();
}

function renderInventory() {
  var container = document.getElementById('inventoryList');
  if (!container) return;

  var filtered = allProducts.slice();
  if (currentWarehouse !== 'all') {
    filtered = filtered.filter(function(p) { return p.inventory && p.inventory[currentWarehouse] > 0; });
  }
  filtered = sortByPriority(filtered);

  container.innerHTML = filtered.map(function(p) {
    var imgHtml = '';
    if (p.images && p.images.length > 0) {
      imgHtml = '<img class="inv-item-img" src="images/' + p.images[0] + '" alt="' + p.name + '" loading="lazy" onerror="this.style.display=\'none\'">';
    } else {
      imgHtml = '<div class="inv-item-img no-img-placeholder" style="width:56px;height:56px;font-size:10px;border-radius:8px;">图片暂无</div>';
    }
    return '<div class="inv-item" onclick="renderProductDetail(\'' + p.product_code_74 + '\')">' +
      imgHtml +
      '<div class="inv-item-info">' +
        '<div class="inv-item-name">' + p.name + '</div>' +
        '<div class="inv-item-code">' + p.product_code_74 + '</div>' +
      '</div>' +
      '<div class="inv-item-stock">' + (p.inventory ? p.inventory.total : 0) + '</div>' +
    '</div>';
  }).join('');

  initTouchFeedback(container.querySelectorAll('.inv-item'));
}

/* ====== 对接人 ====== */
function renderContacts() {
  var container = document.getElementById('contactList');
  if (!container) return;
  var contacts = [
    {name:'梁明宇', role:'荣誉产品负责人', scope:'奖杯/奖牌/证书/牌匾/奖章', note:'1件起订，7-10天工期'},
    {name:'贾翔榆', role:'服装产品负责人', scope:'T恤/POLO/外套/冲锋衣等', note:'1件起订，15天工期'},
    {name:'石书宇', role:'常规文创负责人', scope:'办公/生活/包袋/数码/徽章/摆件等', note:'500-1000件起订'},
  ];
  container.innerHTML = contacts.map(function(c) {
    return '<div class="contact-item">' +
      '<h4>' + c.name + ' — ' + c.role + '</h4>' +
      '<p><strong>负责范围：</strong>' + c.scope + '</p>' +
      '<p><strong>起订量/工期：</strong>' + c.note + '</p>' +
    '</div>';
  }).join('');
}

/* ====== AI 助手 ====== */
function toggleAI() {
  var chat = document.getElementById('aiChat');
  if (chat) chat.classList.toggle('active');
}

function sendAI() {
  var input = document.getElementById('aiInput');
  var body = document.getElementById('aiChatBody');
  if (!input || !body) return;
  var text = input.value.trim();
  if (!text) return;

  var userDiv = document.createElement('div');
  userDiv.className = 'ai-user-msg'; userDiv.textContent = text;
  body.appendChild(userDiv);
  input.value = '';

  var loadingDiv = document.createElement('div');
  loadingDiv.className = 'ai-bot-msg';
  loadingDiv.innerHTML = '<div class="ai-loading"><span></span><span></span><span></span></div>';
  body.appendChild(loadingDiv);
  body.scrollTop = body.scrollHeight;

  setTimeout(function() {
    loadingDiv.remove();
    var botDiv = document.createElement('div');
    botDiv.className = 'ai-bot-msg';
    botDiv.textContent = '您好！AI助手功能正在接入中，暂无法提供实时回复。如有紧急问题，请直接联系对接人。';
    body.appendChild(botDiv);
    body.scrollTop = body.scrollHeight;
  }, 1500);
}

/* ====== 返回顶部 ====== */
function scrollToTop() {
  window.scrollTo({top: 0, behavior: 'smooth'});
}

window.addEventListener('scroll', function() {
  var btn = document.querySelector('.back-to-top');
  if (btn) btn.style.opacity = window.scrollY > 300 ? '1' : '0';
});

/* ====== 懒加载 ====== */
function initLazyImages(root) {
  if (!root || !window.IntersectionObserver) return;
  var imgs = root.querySelectorAll('img.lazy-img');
  if (!imgs.length) return;
  var obs = new IntersectionObserver(function(entries, observer) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var img = entry.target;
        var src = img.dataset.src;
        if (src) {
          img.src = src;
          img.onload = function() { img.classList.add('loaded'); var sk = img.parentElement ? img.parentElement.querySelector('.skeleton') : null; if (sk) sk.style.display = 'none'; };
          img.onerror = function() { img.classList.add('loaded'); var sk = img.parentElement ? img.parentElement.querySelector('.skeleton') : null; if (sk) sk.style.display = 'none'; };
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '50px', threshold: 0.01 });
  imgs.forEach(function(img) { obs.observe(img); });
}

/* ====== 触摸反馈 ====== */
function initTouchFeedback(elements) {
  if (!elements) return;
  var list = elements.length !== undefined ? elements : [elements];
  list.forEach(function(el) {
    el.addEventListener('touchstart', function() { el.classList.add('pressing'); }, {passive:true});
    el.addEventListener('touchend', function() { el.classList.remove('pressing'); }, {passive:true});
    el.addEventListener('touchcancel', function() { el.classList.remove('pressing'); }, {passive:true});
    el.addEventListener('mousedown', function() { el.classList.add('pressing'); });
    el.addEventListener('mouseup', function() { el.classList.remove('pressing'); });
    el.addEventListener('mouseleave', function() { el.classList.remove('pressing'); });
  });
}
