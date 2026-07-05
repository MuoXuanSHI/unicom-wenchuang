/* 全局数据 */
let allProducts = [];
let currentCategory = '全部';
let currentFilters = { category: '全部', warehouse: '全部', stock: '全部' };
let pageStack = [];

/* ========== 初始化 ========== */
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  initBottomNav();
  initLazyLoad();
  initTouchFeedback();
  initBackToTop();
  initAIChat();
  window.addEventListener('scroll', () => {
    const btn = document.getElementById('backToTop');
    if (btn) btn.classList.toggle('visible', window.scrollY > 200);
  });
});

/* ========== 数据加载 ========== */
async function loadData() {
  try {
    const res = await fetch('data/products.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    allProducts = await res.json();
    renderNewProducts();
    renderCategories();
    renderQuickActions();
  } catch (e) {
    console.error('加载数据失败:', e);
    document.getElementById('newProducts').innerHTML =
      '<p class="loading">加载失败，请刷新页面重试</p>';
  }
}

/* ========== 新品专区 (transform滑动) ========== */
function renderNewProducts() {
  const container = document.getElementById('newProducts');
  if (!container) return;
  const newProducts = allProducts.filter(p => p.is_new || p.is_new_excel).slice(0, 20);
  if (!newProducts.length) { container.innerHTML = '<p class="loading">暂无新品</p>'; return; }

  const wrap = document.createElement('div');
  wrap.className = 'new-scroll-wrap';
  const track = document.createElement('div');
  track.className = 'new-track';
  track.innerHTML = newProducts.map(p => renderNewCard(p)).join('');
  wrap.appendChild(track);
  container.innerHTML = '';
  container.appendChild(wrap);

  initNewScroll(wrap, track);
}

function renderNewCard(p) {
  const img = p.images?.length ? p.images[0] : 'placeholder.png';
  const tag = p.is_new ? '<span class="new-tag">新品</span>' : '';
  return `<div class="new-card" onclick="goDetail('${p.product_code_74}')" data-code="${p.product_code_74}">
    <div class="new-card-img-wrap">
      <div class="skeleton"></div>
      <img class="lazy-img" data-src="images/${img}" alt="${p.name}" loading="lazy">
      ${tag}
    </div>
    <div class="new-card-body">
      <div class="new-card-name">${p.name}</div>
      <div class="new-card-price">${p.price ? '¥'+p.price : '面议'}</div>
      <div class="new-card-code">${p.product_code_74}</div>
    </div>
  </div>`;
}

/* Transform-based 滑动 */
function initNewScroll(wrap, track) {
  let isDown = false, startX = 0, startLeft = 0;
  let velocity = 0, lastX = 0, lastTime = 0;
  let rafId = null, autoSnapId = null;
  const gap = 12, cardW = 170, padding = 16;
  let maxTrans = 0;

  function getMaxTrans() {
    const cardCount = track.children.length;
    const totalW = cardCount * cardW + (cardCount - 1) * gap;
    const wrapW = wrap.clientWidth;
    return Math.min(0, wrapW - totalW - padding * 2);
  }

  function setTrans(x) {
    maxTrans = getMaxTrans();
    x = Math.max(maxTrans, Math.min(0, x));
    track.style.transform = `translateX(${x}px)`;
  }

  function onDown(x) {
    isDown = true; startX = x; startLeft = getTrans();
    velocity = 0; lastX = x; lastTime = Date.now();
    track.style.transition = 'none';
    if (rafId) cancelAnimationFrame(rafId);
    if (autoSnapId) cancelAnimationFrame(autoSnapId);
  }

  function onMove(x) {
    if (!isDown) return;
    const now = Date.now(), dt = now - lastTime || 16;
    velocity = (x - lastX) / dt * 16;
    lastX = x; lastTime = now;
    const dx = x - startX;
    maxTrans = getMaxTrans();
    let cur = startLeft + dx;
    if (cur > 0) cur = dx * 0.4; /* 边缘弹性 */
    else if (cur < maxTrans) cur = maxTrans + (dx - (maxTrans - startLeft)) * 0.4;
    setTrans(cur);
  }

  function onUp() {
    if (!isDown) return;
    isDown = false;
    const cur = getTrans();
    maxTrans = getMaxTrans();
    /* 边缘回弹 */
    if (cur > 0 || cur < maxTrans) {
      const target = cur > 0 ? 0 : maxTrans;
      track.style.transition = 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)';
      setTrans(target);
      return;
    }
    /* 惯性滚动 */
    let pos = cur, v = velocity * 8;
    function inertia() {
      v *= 0.93; pos += v;
      if (Math.abs(v) < 0.3) { snapToCard(); return; }
      maxTrans = getMaxTrans();
      if (pos > 0) { pos = 0; v = -v * 0.3; }
      if (pos < maxTrans) { pos = maxTrans; v = -v * 0.3; }
      setTrans(pos);
      rafId = requestAnimationFrame(inertia);
    }
    inertia();
  }

  function snapToCard() {
    const cur = getTrans();
    maxTrans = getMaxTrans();
    if (cur > 0) { setTrans(0); return; }
    if (cur < maxTrans) { setTrans(maxTrans); return; }
    const totalStep = cardW + gap;
    const idx = Math.round(-cur / totalStep);
    const target = -idx * totalStep;
    track.style.transition = 'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
    setTrans(Math.max(maxTrans, Math.min(0, target)));
  }

  function getTrans() {
    const m = track.style.transform.match(/translateX\((-?[\d.]+)px\)/);
    return m ? parseFloat(m[1]) : 0;
  }

  wrap.addEventListener('mousedown', e => { e.preventDefault(); onDown(e.clientX); });
  window.addEventListener('mousemove', e => { if (isDown) onMove(e.clientX); });
  window.addEventListener('mouseup', onUp);
  wrap.addEventListener('touchstart', e => { onDown(e.touches[0].clientX); }, {passive:true});
  wrap.addEventListener('touchmove', e => { if (isDown) onMove(e.touches[0].clientX); }, {passive:true});
  wrap.addEventListener('touchend', onUp);
  wrap.addEventListener('touchcancel', onUp);
  window.addEventListener('resize', () => { setTrans(getTrans()); });
}

/* ========== 分类 ========== */
function renderCategories() {
  const container = document.getElementById('categoryGrid');
  if (!container) return;
  const counts = {};
  allProducts.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
  const cats = ['新春吉祥物', '冬季奥运会', '荣誉体系', '党建系列', '合作IP', '万兆数字产品', '成都大运会', '杭州亚运会', '红色教育', '体育用品', '世界杯周边', '世界杯吉祥物'];
  const icons = {'新春吉祥物':'🐲','冬季奥运会':'❄️','荣誉体系':'🏆','党建系列':'🚩','合作IP':'🤝','万兆数字产品':'📱','成都大运会':'🏃','杭州亚运会':'🏅','红色教育':'📚','体育用品':'🏋️','世界杯周边':'⚽','世界杯吉祥物':'🏆'};
  container.innerHTML = cats.map(cat => `<div class="category-card" onclick="goCategory('${cat}')"><div class="category-icon">${icons[cat]||'📦'}</div><div class="category-name">${cat}</div><div class="category-count">${counts[cat]||0}款</div></div>`).join('');
}

/* ========== 快捷功能 ========== */
function renderQuickActions() {
  const container = document.getElementById('quickActions');
  if (!container) return;
  const actions = [
    {icon:'🆕',text:'新品查询',fn:'scrollToNew()'},
    {icon:'📋',text:'分类浏览',fn:'showPage("home")'}, /* 分类浏览滚动到分类区 */
    {icon:'🔍',text:'库存查询',fn:'showPage("inventory")'},
    {icon:'🤖',text:'AI小助手',fn:'toggleAI()'},
    {icon:'📦',text:'产品总览',fn:'goCategory("全部")'},
    {icon:'⚙️',text:'定制服务',fn:'showPage("custom")'}
  ];
  container.innerHTML = actions.map(a => `<div class="quick-btn" onclick="${a.fn}"><div class="quick-icon">${a.icon}</div><div>${a.text}</div></div>`).join('');
}

/* ========== 产品列表 ========== */
function goCategory(category) {
  pageStack.push({page:'home',filters:{...currentFilters}});
  currentFilters.category = category;
  showPage('productList');
  applyFilter();
  const header = document.querySelector('.page-back-title');
  if (header) header.textContent = category === '全部' ? '全部产品' : category;
}

function applyFilter() {
  const { category, warehouse, stock } = currentFilters;
  let filtered = [...allProducts];
  if (category !== '全部') filtered = filtered.filter(p => p.category === category);
  if (warehouse !== '全部') {
    const wh = warehouse === '华北' ? 'wh_hb' : warehouse === '华东' ? 'wh_hd' : 'wh_gz';
    filtered = filtered.filter(p => p[wh] > 0);
  }
  if (stock === '现货') filtered = filtered.filter(p => p.total_stock > 0);
  if (stock === '低库存') filtered = filtered.filter(p => p.total_stock > 0 && p.total_stock < 50);

  const container = document.getElementById('productList');
  if (!container) return;
  const countEl = document.querySelector('.list-count');
  if (countEl) countEl.textContent = `共 ${filtered.length} 款产品`;
  if (!filtered.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">暂无相关产品</div></div>'; return; }

  container.innerHTML = filtered.map(p => renderProductCard(p)).join('');
  initTouchFeedback('.product-card');
  initLazyImages(container);
}

function renderProductCard(p) {
  const img = p.images?.length ? p.images[0] : 'placeholder.png';
  const stockClass = p.total_stock > 20 ? 'stock-in' : p.total_stock > 0 ? 'stock-low' : 'stock-out';
  const stockText = p.total_stock > 20 ? '现货充足' : p.total_stock > 0 ? '库存紧张' : '缺货';
  return `<div class="product-card" onclick="goDetail('${p.product_code_74}')" data-code="${p.product_code_74}">
    <div class="product-img-wrap">
      <div class="skeleton"></div>
      <img class="lazy-img" data-src="images/${img}" alt="${p.name}" loading="lazy">
    </div>
    <div class="product-card-body">
      <div class="product-card-name">${p.name}</div>
      <div class="product-card-meta">
        <span class="product-card-price">${p.price ? '¥'+p.price : '面议'}</span>
        <span class="product-card-code">${p.product_code_74}</span>
      </div>
      <span class="product-card-stock ${stockClass}">${stockText}</span>
    </div>
  </div>`;
}

/* ========== 产品详情 ========== */
function goDetail(code) {
  pageStack.push({page:document.querySelector('.page.active')?.id||'home',filters:{...currentFilters}});
  const p = allProducts.find(x => x.product_code_74 === code);
  if (!p) return;
  const container = document.getElementById('productDetail');
  if (!container) return;
  container.innerHTML = renderDetail(p);
  showPage('productDetail');
  initDetailCarousel(container);
  initTouchFeedback('.detail-action-btn');
  window.scrollTo(0,0);
}

function renderDetail(p) {
  const imgs = (p.images||[]).map(img => `<img src="images/${img}" alt="${p.name}">`).join('');
  const tags = [];
  if (p.is_new) tags.push('<span class="detail-tag tag-new">新品</span>');
  if (p.category) tags.push(`<span class="detail-tag tag-category">${p.category}</span>`);
  if (p.is_customizable) tags.push('<span class="detail-tag tag-custom">可定制</span>');
  const whMap = {'wh_hd':'华东','wh_hb':'华北','wh_gz':'广州'};
  const invRows = ['wh_hd','wh_hb','wh_gz'].map(k => `<tr><th>${whMap[k]}</th><td>${p[k]||0}</td></tr>`).join('');
  return `<div class="detail-container">
    <div class="detail-carousel">
      <div class="detail-carousel-track">${imgs}</div>
      <div class="detail-carousel-dots"></div>
      <div class="detail-back" onclick="goBack()">←</div>
      ${p.images.length>1 ? '<div class="detail-carousel-arrow prev" onclick="prevSlide()">‹</div><div class="detail-carousel-arrow next" onclick="nextSlide()">›</div>' : ''}
    </div>
    <div class="detail-body">
      <div class="detail-name">${p.name}</div>
      <div class="detail-tags">${tags.join('')}</div>
      <div class="detail-price-row">
        <div class="detail-price-item"><div class="detail-price-label">批发价</div><div class="detail-price-value">${p.price ? '¥'+p.price : '面议'}</div></div>
        <div class="detail-price-item"><div class="detail-price-label">零售价</div><div class="detail-price-value purchase">${p.purchase_price ? '¥'+p.purchase_price : '面议'}</div></div>
      </div>
      <div class="detail-info">
        <h3>产品信息</h3>
        <div class="info-row"><span class="info-label">74码</span><span class="info-value code">${p.product_code_74}</span></div>
        <div class="info-row"><span class="info-label">产品编号</span><span class="info-value">${p.product_code || '-'}</span></div>
        <div class="info-row"><span class="info-label">品类</span><span class="info-value">${p.category}</span></div>
        <div class="info-row"><span class="info-label">材质</span><span class="info-value">${p.material||'详见说明'}</span></div>
        <div class="info-row"><span class="info-label">规格</span><span class="info-value">${p.spec||'详见说明'}</span></div>
        <div class="info-row"><span class="info-label">是否可定制</span><span class="info-value">${p.is_customizable?'是':'否'}</span></div>
        <div class="info-row"><span class="info-label">库存总量</span><span class="info-value">${p.total_stock}</span></div>
        <h3 style="margin-top:20px">分仓库存</h3>
        <table class="inventory-table"><tbody>${invRows}</tbody></table>
      </div>
    </div>
    <div class="detail-actions">
      <div class="detail-action-btn btn-secondary" onclick="goBack()">返回</div>
      <div class="detail-action-btn btn-primary" onclick="showPage('contact')">联系采购</div>
    </div>
  </div>`;
}

function initDetailCarousel(container) {
  const track = container.querySelector('.detail-carousel-track');
  const dots = container.querySelector('.detail-carousel-dots');
  if (!track || !dots || track.children.length <= 1) return;
  const slides = track.children;
  let idx = 0;
  dots.innerHTML = Array.from(slides).map((_,i) => `<div class="detail-carousel-dot ${i===0?'active':''}"></div>`).join('');
  window.currentSlide = idx;
  window.nextSlide = () => { idx=(idx+1)%slides.length; update(); };
  window.prevSlide = () => { idx=(idx-1+slides.length)%slides.length; update(); };
  function update() { track.style.transform=`translateX(-${idx*100}%)`; dots.querySelectorAll('.detail-carousel-dot').forEach((d,i)=>d.classList.toggle('active',i===idx)); }
  let startX=0,curX=0,swiping=false;
  track.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;swiping=true;},{passive:true});
  track.addEventListener('touchmove',e=>{if(!swiping)return;curX=e.touches[0].clientX;},{passive:true});
  track.addEventListener('touchend',()=>{if(!swiping)return;swiping=false;const dx=curX-startX;if(Math.abs(dx)>50){dx>0?window.prevSlide():window.nextSlide();}});
  track.addEventListener('touchcancel',()=>{swiping=false;});
}

/* ========== 库存查询 ========== */
function renderInventory() {
  const container = document.getElementById('inventoryList');
  if (!container) return;
  const warehouse = currentFilters.warehouse || '全部';
  let filtered = [...allProducts];
  if (warehouse !== '全部') {
    const wh = warehouse === '华北' ? 'wh_hb' : warehouse === '华东' ? 'wh_hd' : 'wh_gz';
    filtered = filtered.filter(p => p[wh] > 0);
  }
  filtered.sort((a,b) => b.total_stock - a.total_stock);
  container.innerHTML = filtered.map(p => `<div class="inv-item" onclick="goDetail('${p.product_code_74}')" data-code="${p.product_code_74}">
    <img class="inv-item-img" src="${p.images?.length?'images/'+p.images[0]:'placeholder.png'}" alt="${p.name}">
    <div class="inv-item-info"><div class="inv-item-name">${p.name}</div><div class="inv-item-code">${p.product_code_74}</div></div>
    <div class="inv-item-stock">${p.total_stock}</div>
  </div>`).join('');
  initTouchFeedback('.inv-item');
}

function switchWarehouse(wh) {
  currentFilters.warehouse = wh;
  document.querySelectorAll('.warehouse-tab').forEach(t => t.classList.toggle('active', t.dataset.wh === wh));
  renderInventory();
}

/* ========== 页面导航 ========== */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  updateNav(pageId);
  window.scrollTo(0,0);
  if (pageId === 'inventory') renderInventory();
  if (pageId === 'productList') applyFilter();
}

function goBack() {
  if (!pageStack.length) { showPage('home'); return; }
  const prev = pageStack.pop();
  if (prev.filters) currentFilters = {...prev.filters};
  showPage(prev.page);
  if (prev.page === 'productList') applyFilter();
}

function updateNav(pageId) {
  const map = { home:'nav-home', productList:'nav-category', inventory:'nav-inventory', custom:'nav-custom', contact:'nav-custom', productDetail:'nav-category' };
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navId = map[pageId];
  if (navId) {
    const nav = document.getElementById(navId);
    if (nav) nav.classList.add('active');
  }
}

function initBottomNav() {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const page = this.dataset.page;
      if (page === 'home') { showPage('home'); }
      else if (page === 'category') { goCategory('全部'); }
      else if (page === 'inventory') { showPage('inventory'); }
      else if (page === 'custom') { showPage('custom'); }
      else if (page === 'contact') { showPage('contact'); }
    });
    item.addEventListener('touchstart', () => item.classList.add('pressing'), {passive:true});
    item.addEventListener('touchend', () => item.classList.remove('pressing'), {passive:true});
    item.addEventListener('touchcancel', () => item.classList.remove('pressing'), {passive:true});
  });
}

/* ========== 搜索 ========== */
function searchProducts() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if (!q) return;
  const results = allProducts.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.product_code_74.includes(q) ||
    (p.product_code && p.product_code.includes(q)) ||
    p.category.toLowerCase().includes(q)
  );
  pageStack.push({page:document.querySelector('.page.active')?.id||'home',filters:{...currentFilters}});
  showPage('productList');
  const container = document.getElementById('productList');
  if (!container) return;
  const countEl = document.querySelector('.list-count');
  if (countEl) countEl.textContent = `搜索"${q}"：共 ${results.length} 款产品`;
  if (!results.length) { container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">未找到相关产品</div></div>'; return; }
  container.innerHTML = results.map(p => renderProductCard(p)).join('');
  initTouchFeedback('.product-card');
  initLazyImages(container);
  window.scrollTo(0,0);
}

/* 回车搜索 */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('searchInput');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') searchProducts(); });
});

/* ========== 懒加载 ========== */
function initLazyLoad() {
  initLazyImages(document);
}

function initLazyImages(root) {
  if (!root) return;
  const imgs = root.querySelectorAll ? root.querySelectorAll('img.lazy-img') : [];
  if (!imgs.length || !window.IntersectionObserver) return;
  const obs = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        const src = img.dataset.src;
        if (src) {
          img.src = src;
          img.onload = () => { img.classList.add('loaded'); const sk = img.parentElement?.querySelector('.skeleton'); if (sk) sk.style.display='none'; };
          img.onerror = () => { img.classList.add('loaded'); const sk = img.parentElement?.querySelector('.skeleton'); if (sk) sk.style.display='none'; };
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '50px', threshold: 0.01 });
  imgs.forEach(img => obs.observe(img));
}

/* ========== 触摸反馈 ========== */
function initTouchFeedback(selector) {
  if (!selector) selector = '.new-card, .product-card, .category-card, .quick-btn, .inv-item';
  const elements = typeof selector === 'string' ? document.querySelectorAll(selector) : selector;
  elements.forEach(el => {
    el.addEventListener('touchstart', () => el.classList.add('pressing'), {passive:true});
    el.addEventListener('touchend', () => el.classList.remove('pressing'), {passive:true});
    el.addEventListener('touchcancel', () => el.classList.remove('pressing'), {passive:true});
  });
}

/* ========== 返回顶部 ========== */
function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  btn.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));
  btn.addEventListener('touchstart', () => btn.classList.add('pressing'), {passive:true});
  btn.addEventListener('touchend', () => btn.classList.remove('pressing'), {passive:true});
}

/* ========== AI 聊天 ========== */
function toggleAI() { document.getElementById('aiChat')?.classList.toggle('active'); }
function initAIChat() {
  const input = document.getElementById('aiInput');
  const sendBtn = document.getElementById('aiSend');
  const messages = document.getElementById('aiMessages');
  if (!input || !sendBtn || !messages) return;
  sendBtn.addEventListener('click', sendAI);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendAI(); });
  function sendAI() {
    const text = input.value.trim();
    if (!text) return;
    const userDiv = document.createElement('div');
    userDiv.className = 'ai-user-msg'; userDiv.textContent = text; messages.appendChild(userDiv);
    input.value = '';
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'ai-bot-msg'; loadingDiv.innerHTML = '<div class="ai-loading"><span></span><span></span><span></span></div>';
    messages.appendChild(loadingDiv); messages.scrollTop = messages.scrollHeight;
    fetch('https://kimi-k2.6.com/api/v1/chat', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer 642530bb' },
      body: JSON.stringify({ model: 'kimi-k2.6', messages: [{role:'user',content:text}] })
    }).then(r => r.json()).then(data => {
      loadingDiv.remove();
      const botDiv = document.createElement('div');
      botDiv.className = 'ai-bot-msg'; botDiv.textContent = data.choices?.[0]?.message?.content || '抱歉，AI服务暂时不可用';
      messages.appendChild(botDiv); messages.scrollTop = messages.scrollHeight;
    }).catch(e => {
      loadingDiv.remove();
      const botDiv = document.createElement('div');
      botDiv.className = 'ai-bot-msg'; botDiv.textContent = '网络连接失败，请稍后重试';
      messages.appendChild(botDiv); messages.scrollTop = messages.scrollHeight;
    });
  }
}

/* ========== 滚动到新品 ========== */
function scrollToNew() { showPage('home'); setTimeout(() => { const el = document.querySelector('.new-scroll-wrap'); if (el) el.scrollIntoView({behavior:'smooth', block:'center'}); }, 100); }

/* 新品列表滑动 (桌面端按钮) */
function scrollNewProducts(dir) {
  const wrap = document.querySelector('.new-scroll-wrap');
  const track = document.querySelector('.new-track');
  if (!wrap || !track) return;
  const cardW = 170, gap = 12, step = (cardW + gap) * 2;
  const m = track.style.transform.match(/translateX\((-?[\d.]+)px\)/);
  const cur = m ? parseFloat(m[1]) : 0;
  const maxTrans = Math.min(0, wrap.clientWidth - track.scrollWidth - 32);
  let target = cur + (dir === 'left' ? step : -step);
  target = Math.max(maxTrans, Math.min(0, target));
  track.style.transition = 'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
  track.style.transform = `translateX(${target}px)`;
  setTimeout(() => { track.style.transition = 'none'; }, 400);
}
