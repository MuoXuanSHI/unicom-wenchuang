/* 产品数据通过 fetch 加载，不内联在此文件中 */
let allProducts = [];

/* ========== 数据加载 ========== */
async function loadData() {
  try {
    const response = await fetch("./data/products.json");
    if (!response.ok) throw new Error("HTTP " + response.status);
    allProducts = await response.json();
    renderNewProducts();
    console.log("数据加载完成:", allProducts.length, "个SKU");
  } catch (e) {
    console.error("数据加载失败:", e);
    document.getElementById("newProductsList").innerHTML = '<div class="empty-state"><div class="empty-state-text">数据加载失败，请刷新重试</div></div>';
  }
}

/* ========== 页面路由 ========== */
// 页面历史栈，用于返回上一步
let pageHistory = [];

function showPage(pageId) {
  // 记录当前页面到历史栈（避免重复记录同一页面）
  const currentActive = document.querySelector('.page.active');
  if (currentActive) {
    const currentId = currentActive.id.replace('page-', '');
    if (currentId !== pageId && currentId !== 'detail') {
      pageHistory.push(currentId);
      // 最多保留10条历史记录
      if (pageHistory.length > 10) pageHistory.shift();
    }
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  window.scrollTo(0, 0);
}

function goBack() {
  if (pageHistory.length > 0) {
    const prevPage = pageHistory.pop();
    showPage(prevPage);
    updateNav(prevPage);
    if (prevPage === 'home') renderNewProducts();
    if (prevPage === 'list') applyFilter();
    if (prevPage === 'inventory') renderInventory();
    if (prevPage === 'custom') renderCustomProducts();
  } else {
    goHome();
  }
}
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  window.scrollTo(0, 0);
}

function goHome() {
  showPage('home');
  updateNav('home');
  renderNewProducts();
}

function goCategory(cat) {
  showPage('list');
  updateNav('list');
  document.getElementById('filterCategory').value = cat;
  applyFilter();
}

function goInventory() {
  showPage('inventory');
  updateNav('inventory');
  renderInventory();
}

function goCustom() {
  showPage('custom');
  updateNav('custom');
  renderCustomProducts();
}

function goContact() {
  showPage('contact');
  updateNav('contact');
  renderContacts();
}

function updateNav(active) {
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => item.classList.remove('active'));
  const map = { home: 0, list: 1, inventory: 2, custom: 3, contact: 3 };
  const idx = map[active];
  if (idx !== undefined) {
    document.querySelectorAll('.bottom-nav .nav-item')[idx]?.classList.add('active');
  }
}

/* ========== 新品专区 ========== */
function renderNewProducts() {
  const container = document.getElementById('newProductsList');
  let newProducts = allProducts.filter(p => p.is_new);
  const score = p => {
    const hasImg = p.images.length > 0 ? 2 : 0;
    const hasStock = p.inventory.total > 50 ? 2 : p.inventory.total > 0 ? 1 : 0;
    return hasImg * 10 + hasStock;
  };
  newProducts.sort((a, b) => score(b) - score(a));
  newProducts = newProducts.slice(0, 21);
  if (!newProducts.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">暂无新品</div></div>';
    return;
  }
  container.innerHTML = newProducts.map(p => `
    <div class="new-card" onclick="goDetail('${p.product_code_74}')">
      <span class="new-tag">NEW</span>
      ${p.images[0] ? `<img src="images/${p.images[0]}" alt="${p.name}" class="new-card-img" onerror="this.onerror=null;this.outerHTML='<div class='no-img-placeholder'>图片暂无</div>'">` : `<div class="no-img-placeholder">图片暂无</div>`}
      <div class="new-card-body">
        <div class="new-card-name">${p.name}</div>
        <div class="new-card-price">¥${p.settlement_price.toFixed(2)}</div>
        <div class="new-card-code">${p.product_code_74}</div>
      </div>
    </div>
  `).join('');
  let startX = 0, startY = 0, isDown = false;
  container.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDown = true;
  }, {passive: true});
  container.addEventListener('touchmove', (e) => {
    if (!isDown) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = startX - x;
    const dy = startY - y;
    if (Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
      container.scrollLeft += dx;
      startX = x;
    }
  }, {passive: false});
  container.addEventListener('touchend', () => { isDown = false; });
  
  // 鼠标滚轮横向滑动（桌面端）
  container.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // 已经是横向滚轮，不处理
      return;
    }
    if (Math.abs(e.deltaY) > 0) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
  }, {passive: false});
  
  // 鼠标拖拽滑动（桌面端）
  let mouseDown = false, mouseStartX = 0, mouseScrollLeft = 0;
  container.addEventListener('mousedown', (e) => {
    mouseDown = true;
    container.style.cursor = 'grabbing';
    mouseStartX = e.pageX - container.offsetLeft;
    mouseScrollLeft = container.scrollLeft;
  });
  container.addEventListener('mouseleave', () => { mouseDown = false; container.style.cursor = 'grab'; });
  container.addEventListener('mouseup', () => { mouseDown = false; container.style.cursor = 'grab'; });
  container.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - mouseStartX) * 1.5;
    container.scrollLeft = mouseScrollLeft - walk;
  });
  container.style.cursor = 'grab';
  container.style.userSelect = 'none';
}


/* ========== 产品列表 ========== */
function applyFilter() {
  const cat = document.getElementById('filterCategory').value;
  const price = document.getElementById('filterPrice').value;
  const stock = document.getElementById('filterStock').value;
  const sort = document.getElementById('sortBy').value;
  const search = (document.getElementById('globalSearch').value || '').trim().toLowerCase();

  let results = [...allProducts];

  // 分类筛选
  if (cat) results = results.filter(p => p.category === cat);

  // 价格筛选
  if (price) {
    if (price === '0-50') results = results.filter(p => p.settlement_price <= 50);
    else if (price === '50-100') results = results.filter(p => p.settlement_price > 50 && p.settlement_price <= 100);
    else if (price === '100-200') results = results.filter(p => p.settlement_price > 100 && p.settlement_price <= 200);
    else if (price === '200-500') results = results.filter(p => p.settlement_price > 200 && p.settlement_price <= 500);
    else if (price === '500+') results = results.filter(p => p.settlement_price > 500);
  }

  // 库存筛选
  if (stock) {
    if (stock === 'in') results = results.filter(p => p.inventory.total > 50);
    else if (stock === 'low') results = results.filter(p => p.inventory.total > 0 && p.inventory.total <= 50);
    else if (stock === 'out') results = results.filter(p => p.inventory.total === 0);
  }

  // 搜索
  if (search) {
    results = results.filter(p =>
      p.name.toLowerCase().includes(search) ||
      p.product_code_74.includes(search) ||
      p.product_code_69.includes(search)
    );
  }

  // 排序：有图+库存充足 > 有图+库存紧张 > 无图
  const score = p => {
    const hasImg = p.images.length > 0 ? 2 : 0;
    const hasStock = p.inventory.total > 50 ? 2 : p.inventory.total > 0 ? 1 : 0;
    return hasImg * 10 + hasStock;
  };
  if (sort === 'price-asc') results.sort((a, b) => a.settlement_price - b.settlement_price);
  else if (sort === 'price-desc') results.sort((a, b) => b.settlement_price - a.settlement_price);
  else if (sort === 'stock') results.sort((a, b) => b.inventory.total - a.inventory.total);
  else results.sort((a, b) => score(b) - score(a) || a.product_code_74.localeCompare(b.product_code_74));

  filteredProducts = results;
  renderProductGrid(results);
  document.getElementById('listCount').textContent = `共 ${results.length} 款产品`;
}

function renderProductGrid(products) {
  const grid = document.getElementById('productGrid');
  if (!products.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><div class="empty-state-icon">📭</div><div class="empty-state-text">没有找到符合条件的产品</div></div>';
    return;
  }
  grid.innerHTML = products.slice(0, 200).map(p => {
    const stockClass = p.inventory.total > 50 ? 'stock-in' : p.inventory.total > 0 ? 'stock-low' : 'stock-out';
    const stockText = p.inventory.total > 50 ? '库存充足' : p.inventory.total > 0 ? '库存紧张' : '暂无库存';
    return `
    <div class="product-card" onclick="goDetail('${p.product_code_74}')">
      ${p.images[0] ? `<img src="images/${p.images[0]}" alt="${p.name}" class="product-card-img" onerror="this.onerror=null;this.outerHTML='<div class=\'no-img-placeholder\'>图片暂无</div>'">` : `<div class="no-img-placeholder">图片暂无</div>`}
      <div class="product-card-body">
        <div class="product-card-name">${p.name}</div>
        <div class="product-card-meta">
          <span class="product-card-price">¥${p.settlement_price.toFixed(2)}</span>
          <span class="product-card-code">${p.product_code_74}</span>
        </div>
        <span class="product-card-stock ${stockClass}">${stockText}</span>
      </div>
    </div>
    `;
  }).join('');
}

function handleSearch(val) {
  if (!val || val.length < 2) return;
  goCategory('');
  document.getElementById('globalSearch').value = val;
  applyFilter();
}

function doSearch() {
  applyFilter();
  goCategory('');
}

/* ========== 产品详情 ========== */
function goDetail(code) {
  currentProduct = allProducts.find(p => p.product_code_74 === code);
  if (!currentProduct) return;
  showPage('detail');
  updateNav('list');
  renderDetail();
}
function goDetail(code) {
  currentProduct = allProducts.find(p => p.product_code_74 === code);
  if (!currentProduct) return;
  showPage('detail');
  updateNav('list');
  renderDetail();
}

function renderDetail() {
  const p = currentProduct;
  const container = document.getElementById('detailContainer');

  const tags = [];
  if (p.is_new) tags.push('<span class="detail-tag tag-new">新品</span>');
  if (p.category) tags.push(`<span class="detail-tag tag-category">${p.category}</span>`);
  if (p.is_customizable) tags.push('<span class="detail-tag tag-custom">可定制</span>');

  // 生成轮播图HTML
  let carouselHtml = '';
  if (p.images.length > 0) {
      const slides = p.images.map((img, i) => `
          <div class="detail-carousel-slide" style="display:${i===0?'flex':'none'};">
              <img src="images/${img}" alt="${p.name}" onerror="this.style.display='none'">
          </div>
      `).join('');
      const dots = p.images.map((_, i) => `
          <div class="detail-carousel-dot ${i===0?'active':''}" onclick="showSlide(${i})"></div>
      `).join('');
      carouselHtml = `
          <div class="detail-carousel" id="detailCarousel">
              <div class="detail-back" onclick="goBack()">‹</div>
              ${p.images.length > 1 ? `<div class="detail-carousel-arrow prev" onclick="prevSlide()">‹</div>` : ''}
              ${p.images.length > 1 ? `<div class="detail-carousel-arrow next" onclick="nextSlide()">›</div>` : ''}
              <div class="detail-carousel-track" id="carouselTrack">
                  ${slides}
              </div>
              ${p.images.length > 1 ? `<div class="detail-carousel-dots">${dots}</div>` : ''}
          </div>
      `;
  } else {
      carouselHtml = `
          <div class="detail-carousel" style="min-height:300px;display:flex;align-items:center;justify-content:center;background:#f8f8f8;">
              <div class="detail-back" onclick="goBack()">‹</div>
              <span style="color:#ccc;font-size:14px;">图片暂无</span>
          </div>
      `;
  }

  container.innerHTML = `
    <div class="detail-img-wrap">
      ${carouselHtml}
    </div>
    <div class="detail-body">
      <div class="detail-name">${p.name}</div>
      <div class="detail-tags">${tags.join('')}</div>

      <div class="detail-price-row">
        <div class="detail-price-item">
          <div class="detail-price-label">结算价</div>
          <div class="detail-price-value">¥${p.settlement_price.toFixed(2)}</div>
        </div>
        <div class="detail-price-item">
          <div class="detail-price-label">零售价</div>
          <div class="detail-price-value">¥${p.retail_price.toFixed(2)}</div>
        </div>
      </div>

      <div class="detail-info">
        <h3>产品信息</h3>
        <div class="info-row"><span class="info-label">74编码</span><span class="info-value code">${p.product_code_74}</span></div>
        <div class="info-row"><span class="info-label">69条码</span><span class="info-value code">${p.product_code_69 || '-'}</span></div>
        <div class="info-row"><span class="info-label">分类</span><span class="info-value">${p.category || '-'} ${p.sub_category ? '/ ' + p.sub_category : ''}</span></div>
        <div class="info-row"><span class="info-label">规格/材质</span><span class="info-value">${p.spec || '-'}</span></div>
        ${p.is_customizable ? `<div class="info-row"><span class="info-label">起订量</span><span class="info-value">${p.moq || '500-1000件'}</span></div>` : ''}
      </div>

      <div class="detail-info">
        <h3>库存分布</h3>
        <table class="inventory-table">
          <tr><th>北京</th><th>昆山</th><th>东莞</th><th>成都</th><th>小库</th><th>总计</th></tr>
          <tr><td>${p.inventory.beijing}</td><td>${p.inventory.kunshan}</td><td>${p.inventory.dongguan}</td><td>${p.inventory.chengdu}</td><td>${p.inventory.xiaoku}</td><td style="color:#E60012;font-weight:700;">${p.inventory.total}</td></tr>
        </table>
      </div>

      ${p.description ? `
      <div class="detail-desc">
        <h3>产品描述</h3>
        <p>${p.description}</p>
      </div>
      ` : ''}
    </div>

    <div class="detail-actions">
      <button class="detail-action-btn btn-secondary" onclick="copyCode('${p.product_code_74}')">复制编码</button>
      <button class="detail-action-btn btn-primary" onclick="generatePoster('${p.product_code_74}')">生成海报</button>
    </div>
  `;
}

function copyCode(code) {
  navigator.clipboard.writeText(code).then(() => alert('编码已复制: ' + code));
}

function generatePoster(code) {
  const p = allProducts.find(x => x.product_code_74 === code);
  if (!p) return;
  alert(`海报功能开发中...\n产品: ${p.name}\n编码: ${p.product_code_74}\n价格: ¥${p.settlement_price}`);
}

/* ========== 库存查询 ========== */
function switchWarehouse(wh) {
  currentWarehouse = wh;
  document.querySelectorAll('.warehouse-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderInventory();
}

function renderInventory() {
  const list = document.getElementById('inventoryList');
  let products = allProducts.filter(p => p.inventory.total > 0);

  if (currentWarehouse !== 'all') {
    products = products.filter(p => p.inventory[currentWarehouse] > 0);
    products.sort((a, b) => b.inventory[currentWarehouse] - a.inventory[currentWarehouse]);
  } else {
    products.sort((a, b) => b.inventory.total - a.inventory.total);
  }

  list.innerHTML = products.slice(0, 100).map(p => {
    const stock = currentWarehouse === 'all' ? p.inventory.total : p.inventory[currentWarehouse];
    return `
    <div class="inv-item" onclick="goDetail('${p.product_code_74}')">
      <img src="images/${p.images[0]}" alt="" class="inv-item-img" onerror="this.onerror=null;this.outerHTML='<div class=\'no-img-placeholder\'>图片暂无</div>'">
      <div class="inv-item-info">
        <div class="inv-item-name">${p.name}</div>
        <div class="inv-item-code">${p.product_code_74}</div>
      </div>
      <div class="inv-item-stock">${stock}件</div>
    </div>
    `;
  }).join('');
}

/* ========== 定制产品 ========== */
function renderCustomProducts() {
  const grid = document.getElementById('customProductGrid');
  const customProducts = allProducts.filter(p => p.is_customizable);
  grid.innerHTML = customProducts.slice(0, 50).map(p => `
    <div class="product-card" onclick="goDetail('${p.product_code_74}')">
      <img src="images/${p.images[0]}" alt="${p.name}" class="product-card-img" onerror="this.onerror=null;this.outerHTML='<div class=\'no-img-placeholder\'>图片暂无</div>'">
      <div class="product-card-body">
        <div class="product-card-name">${p.name}</div>
        <div class="product-card-meta">
          <span class="product-card-price">¥${p.settlement_price.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `).join('');
}


/* ========== 对接人 ========== */
function renderContacts() {
  const list = document.getElementById('contactList');
  // 基于知识库中的对接人信息（简化展示）
  list.innerHTML = `
    <div class="contact-item">
      <h4>智慧供应链产品采购</h4>
      <p>各省分采购对接人，请联系当地智慧供应链负责人</p>
      <p>采购下单、批量询价、合同签署</p>
    </div>
    <div class="contact-item">
      <h4>退换货/售后服务</h4>
      <p>产品质量问题、退换货申请</p>
      <p>请联系各省分文创产品对接人或华盛公司客服</p>
    </div>
    <div class="contact-item">
      <h4>定制服务咨询</h4>
      <p>LOGO定制、图案设计、包装定制</p>
      <p>起订量500-1000件，工期视产品而定</p>
    </div>
  `;
}

/* ========== AI助手 ========== */
function toggleAI() {
  document.getElementById('aiChat').classList.toggle('active');
}

/* ========== ADP AI 助手（腾讯智能体开发平台）—— 已隐藏 ========== */
const ADP_CONFIG = {
  // API Key 已移除，后续需要时再配置
  apiKey: '',
  botId: 'XCDLaD',
  baseUrl: 'https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse'
};

// 调用腾讯ADP SSE流式API
async function callADPAPI(content) {
  const payload = {
    bot_app_key: ADP_CONFIG.apiKey,
    session_id: 'web_' + Date.now(),
    visitor_biz_id: 'visitor_' + Math.random().toString(36).substr(2, 9),
    content: content,
    incremental: true,
    streaming_throttle: 10,
    stream: "enable"
  };
  
  const response = await fetch(ADP_CONFIG.baseUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) throw new Error('HTTP ' + response.status);
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let finalAnswer = '';
  
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.split(':', 1)[1].trim();
      } else if (trimmed.startsWith('data:') && currentEvent === 'reply') {
        const data = trimmed.substring(5).trim();
        if (!data) continue;
        
        if (data.includes('"is_final":true') || data.includes('"is_final": true')) {
          try {
            const json = JSON.parse(data);
            const outputs = json.payload?.work_flow?.outputs;
            if (outputs && outputs.length > 0) {
              try {
                const output = JSON.parse(outputs[0]);
                finalAnswer = typeof output === 'string' ? output : JSON.stringify(output);
              } catch {
                finalAnswer = outputs[0];
              }
            }
          } catch (e) {
            console.error('ADP SSE parse error:', e);
          }
        }
      }
    }
  }
  
  return finalAnswer || 'AI助手没有返回有效回复，请重试。';
}

async function sendAI() {
  const input = document.getElementById('aiInput');
  const text = input.value.trim();
  if (!text) return;
  
  const body = document.getElementById('aiChatBody');
  body.innerHTML += `<div class="ai-user-msg">${escapeHtml(text)}</div>`;
  input.value = '';
  body.scrollTop = body.scrollHeight;
  
  // 显示加载中
  const loadingId = 'ai_loading_' + Date.now();
  body.innerHTML += `<div class="ai-bot-msg" id="${loadingId}"><div class="ai-loading"><span></span><span></span><span></span></div>AI思考中...</div>`;
  body.scrollTop = body.scrollHeight;
  
  try {
    const answer = await callADPAPI(text);
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      loadingEl.innerHTML = escapeHtml(answer).replace(/\n/g, '<br>');
    }
  } catch (err) {
    console.error('ADP API Error:', err);
    // CORS失败或网络错误时回退到本地FAQ
    const answer = getAIAnswer(text);
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      loadingEl.innerHTML = `<div style="color:#999;font-size:12px;margin-bottom:6px;">[ADP服务暂时不可用，已切换本地模式]</div>` + answer;
    }
  }
  body.scrollTop = body.scrollHeight;
}

function getAIAnswer(q) {
  const lower = q.toLowerCase();

  // 库存查询
  if (lower.includes('库存') || lower.includes('有货') || lower.includes('还剩')) {
    const keywords = q.replace(/[库存有货还剩多少件个]/g, '').trim();
    if (keywords.length >= 2) {
      const matches = allProducts.filter(p => p.name.includes(keywords) || p.product_code_74.includes(keywords));
      if (matches.length > 0) {
        const p = matches[0];
        return `【${p.name}】<br>北京：${p.inventory.beijing}件<br>昆山：${p.inventory.kunshan}件<br>东莞：${p.inventory.dongguan}件<br>成都：${p.inventory.chengdu}件<br>小库：${p.inventory.xiaoku}件<br>总计：<b>${p.inventory.total}件</b>`;
      }
    }
    return '请告诉我具体的产品名称或编码，我可以帮你查询库存分布。';
  }

  // 价格查询
  if (lower.includes('价格') || lower.includes('多少钱') || lower.includes('结算') || lower.includes('零售')) {
    const keywords = q.replace(/[价格多少钱结算零售价]/g, '').trim();
    if (keywords.length >= 2) {
      const matches = allProducts.filter(p => p.name.includes(keywords) || p.product_code_74.includes(keywords));
      if (matches.length > 0) {
        const p = matches[0];
        return `【${p.name}】<br>74编码：${p.product_code_74}<br>结算价：¥${p.settlement_price.toFixed(2)}<br>零售价：¥${p.retail_price.toFixed(2)}`;
      }
    }
    return '请告诉我具体的产品名称或编码，我可以帮你查询价格。';
  }

  // 编码查询
  if (lower.includes('编码') || lower.includes('条码') || lower.includes('74') || lower.includes('69')) {
    return '产品编码（74码）是联通文创产品的唯一标识码，可以在产品库中搜索查询。每个产品对应唯一的74码和69码（商品条码）。';
  }

  // 定制
  if (lower.includes('定制') || lower.includes('logo') || lower.includes('起订')) {
    return '联通文创产品支持以下定制服务：<br>• 可定制内容：LOGO更换、图案定制、包装定制、外观纹路/花纹定制<br>• 设计费：已包含在定制报价中，不另收<br>• 客户提供素材：AI格式LOGO源文件（或其他高清格式）<br>• 起订量：500-1000件起订<br>• 工期：视产品而定，具体请联系定制对接人。';
  }

  // 采购流程
  if (lower.includes('采购') || lower.includes('下单') || lower.includes('买') || lower.includes('怎么订')) {
    return '采购下单流程：<br>1. 在「联通文创小管家」浏览产品并确认库存<br>2. 联系各省分智慧供应链对接人提交采购需求<br>3. 确认报价和定制方案（如有）<br>4. 签署合同/订单确认<br>5. 等待发货并验收';
  }

  // 售后
  if (lower.includes('售后') || lower.includes('退换') || lower.includes('退货') || lower.includes('质量问题')) {
    return '售后政策：<br>• 退换货请联系各省分对接人或华盛公司客服<br>• 质量问题支持退换货<br>• 定制产品非质量问题不支持退换<br>• 具体售后流程请查看「对接人」页面获取联系方式。';
  }

  // 新品
  if (lower.includes('新品') || lower.includes('新款')) {
    const newProducts = allProducts.filter(p => p.is_new);
    return `当前有 ${newProducts.length} 款新品，请在首页「新品专区」查看。最新入仓的新品包括：${newProducts.slice(0, 5).map(p => p.name).join('、')}等。`;
  }

  // 默认回答
  return '你好！我是联通文创智能助手。我可以帮你查询产品信息、库存、价格、定制服务等。请直接输入你的问题，比如：<br>• "折叠风扇有库存吗？"<br>• "这款产品的价格是多少？"<br>• "定制需要多少起订量？"<br><br>你也可以使用顶部搜索框直接查找产品。';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ========== 工具函数 ========== */
function scrollNewProducts(dir) {
  const container = document.getElementById('newProductsList');
  if (!container) return;
  const scrollAmount = 200;
  container.scrollBy({ left: dir * scrollAmount, behavior: 'smooth' });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 监听滚动显示返回顶部
window.addEventListener('scroll', () => {
  const btn = document.querySelector('.back-to-top');
  if (window.scrollY > 300) btn.classList.add('visible');
  else btn.classList.remove('visible');
});


/* ========== 轮播图控制 ========== */
let currentSlide = 0;
let totalSlides = 0;

function showSlide(index) {
    const slides = document.querySelectorAll('.detail-carousel-slide');
    const dots = document.querySelectorAll('.detail-carousel-dot');
    if (!slides.length) return;
    currentSlide = index;
    if (currentSlide < 0) currentSlide = slides.length - 1;
    if (currentSlide >= slides.length) currentSlide = 0;
    slides.forEach((s, i) => { s.style.display = i === currentSlide ? 'flex' : 'none'; });
    dots.forEach((d, i) => { d.classList.toggle('active', i === currentSlide); });
}

function nextSlide() { showSlide(currentSlide + 1); }
function prevSlide() { showSlide(currentSlide - 1); }

/* ========== 初始化 ========== */

document.addEventListener('DOMContentLoaded', () => {
  loadData();
});
