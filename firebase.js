// ===== PICK&PAY – FIREBASE REALTIME DATABASE =====
// Hướng dẫn setup:
// 1. Vào https://console.firebase.google.com → Tạo project mới
// 2. Vào Realtime Database → Create database → Start in test mode
// 3. Copy databaseURL (dạng: https://ten-project-default-rtdb.firebaseio.com)
// 4. Thay FIREBASE_DB_URL bên dưới bằng URL của bạn

const FIREBASE_DB_URL = 'https://pickandpay-demo-default-rtdb.firebaseio.com';

// ===== HELPER: gọi Firebase REST API =====
async function fbGet(path) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { console.warn('fbGet error:', e); return null; }
}

async function fbSet(path, data) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) { console.warn('fbSet error:', e); return false; }
}

async function fbPush(path, data) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.name; // key mới
  } catch (e) { console.warn('fbPush error:', e); return null; }
}

async function fbUpdate(path, data) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.ok;
  } catch (e) { console.warn('fbUpdate error:', e); return false; }
}

async function fbDelete(path) {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, { method: 'DELETE' });
    return res.ok;
  } catch (e) { console.warn('fbDelete error:', e); return false; }
}

// ===== KIỂM TRA KẾT NỐI FIREBASE =====
let firebaseConnected = false;
async function checkFirebase() {
  const test = await fbGet('.info/connected');
  // Firebase REST không có .info/connected, dùng cách khác
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/ping.json`, { method: 'GET' });
    firebaseConnected = res.ok;
  } catch { firebaseConnected = false; }
  return firebaseConnected;
}

// ===== ĐỒNG BỘ ĐƠN HÀNG =====
// Lưu đơn hàng lên Firebase (gọi sau khi đặt hàng thành công)
async function syncOrderToFirebase(order) {
  // Lưu vào /orders/{orderId}
  const ok = await fbSet(`orders/${order.id.replace('#','')}`, {
    ...order,
    createdAt: Date.now(),
    buyerEmail: (getUser() || {}).email || 'guest'
  });
  if (ok) console.log('✅ Đơn hàng đã sync lên Firebase:', order.id);
  else console.warn('⚠️ Sync thất bại, dùng localStorage');
  return ok;
}

// Lấy tất cả đơn hàng từ Firebase (dành cho người bán)
async function getOrdersFromFirebase() {
  const data = await fbGet('orders');
  if (!data) return [];
  return Object.values(data).sort((a, b) => (b.createdAt||0) - (a.createdAt||0));
}

// Cập nhật trạng thái đơn hàng (người bán xác nhận)
async function updateOrderStatus(orderId, status) {
  const cleanId = orderId.replace('#','');
  const ok = await fbUpdate(`orders/${cleanId}`, { status, updatedAt: Date.now() });
  // Cũng cập nhật localStorage của người mua nếu trên cùng máy
  const orders = JSON.parse(localStorage.getItem('orders') || '[]');
  const o = orders.find(x => x.id === orderId);
  if (o) { o.status = status; localStorage.setItem('orders', JSON.stringify(orders)); }
  return ok;
}

// Lấy đơn hàng của người mua (theo email)
async function getBuyerOrders(email) {
  const all = await getOrdersFromFirebase();
  return all.filter(o => o.buyerEmail === email);
}

// ===== ĐỒNG BỘ USER =====
async function syncUserToFirebase(user) {
  if (!user || !user.email) return false;
  const key = user.email.replace(/[.#$\[\]]/g, '_');
  return await fbSet(`users/${key}`, { ...user, updatedAt: Date.now() });
}

async function getUserFromFirebase(email) {
  const key = email.replace(/[.#$\[\]]/g, '_');
  return await fbGet(`users/${key}`);
}

// ===== ĐỒNG BỘ SẢN PHẨM NGƯỜI BÁN =====
async function syncSellerProductsToFirebase(sellerEmail, products) {
  const key = sellerEmail.replace(/[.#$\[\]]/g, '_');
  return await fbSet(`sellerProducts/${key}`, products);
}

async function getSellerProductsFromFirebase(sellerEmail) {
  const key = sellerEmail.replace(/[.#$\[\]]/g, '_');
  const data = await fbGet(`sellerProducts/${key}`);
  return data || null;
}

// ===== WRAPPER: ưu tiên Firebase, fallback localStorage =====
// Lưu đơn hàng (dùng trong checkout.html)
async function saveOrderSync(order) {
  // Luôn lưu localStorage trước (offline-first)
  const orders = JSON.parse(localStorage.getItem('orders') || '[]');
  orders.unshift(order);
  localStorage.setItem('orders', JSON.stringify(orders));
  localStorage.setItem('lastOrder', order.id);

  // Sau đó sync lên Firebase
  syncOrderToFirebase(order).catch(e => console.warn('Firebase sync failed:', e));
}

// Lấy đơn hàng (người mua) – kết hợp localStorage + Firebase
async function getOrdersSync() {
  const local = JSON.parse(localStorage.getItem('orders') || '[]');

  // Thử lấy từ Firebase
  const user = getUser();
  if (user && user.email) {
    try {
      const remote = await getBuyerOrders(user.email);
      if (remote && remote.length > 0) {
        // Merge: ưu tiên trạng thái từ Firebase (mới hơn)
        const merged = [...local];
        remote.forEach(ro => {
          const idx = merged.findIndex(lo => lo.id === ro.id);
          if (idx >= 0) {
            // Cập nhật status từ Firebase nếu mới hơn
            if ((ro.updatedAt||0) > (merged[idx].updatedAt||0)) {
              merged[idx].status = ro.status;
            }
          } else {
            merged.unshift(ro); // Đơn mới từ thiết bị khác
          }
        });
        // Cập nhật lại localStorage
        localStorage.setItem('orders', JSON.stringify(merged));
        return merged;
      }
    } catch (e) { /* fallback localStorage */ }
  }
  return local;
}

console.log('🔥 Firebase module loaded. DB URL:', FIREBASE_DB_URL);
