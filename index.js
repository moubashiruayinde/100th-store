require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Cloudinary config ─────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Database ──────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Init DB tables ────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      phone VARCHAR(20),
      is_admin BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      price NUMERIC(10,2) NOT NULL,
      compare_price NUMERIC(10,2),
      tags TEXT[],
      sizes TEXT[],
      colors TEXT[],
      images TEXT[],
      color_images JSONB DEFAULT '{}',
      banner_slot INTEGER,
      banner_image TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_ref VARCHAR(50) UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id),
      items JSONB NOT NULL,
      total NUMERIC(10,2) NOT NULL,
      delivery_fee NUMERIC(10,2) DEFAULT 0,
      status VARCHAR(50) DEFAULT 'pending',
      payment_status VARCHAR(50) DEFAULT 'unpaid',
      payment_ref VARCHAR(255),
      delivery_address JSONB,
      delivery_tracking TEXT,
      sendbox_order_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wishlist (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS banners (
      slot INTEGER PRIMARY KEY,
      image_url TEXT,
      headline TEXT,
      subtext TEXT,
      eyebrow TEXT
    );
  `);
  console.log('DB tables ready');

  // Create default admin if not exists
  const adminEmail = process.env.ADMIN_EMAIL || 'hundredsdotshop@gmail.com';
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@100th', 10);
    await pool.query(
      'INSERT INTO users (first_name, last_name, email, password, is_admin) VALUES ($1,$2,$3,$4,$5)',
      ['Store', 'Admin', adminEmail, hash, true]
    );
    console.log('Default admin created:', adminEmail);
  }
}

// ── Auth middleware ───────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || '100th_secret_key');
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

// ══════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { first_name, last_name, email, password, phone } = req.body;
    if (!email || !password || !first_name) return res.status(400).json({ error: 'Missing fields' });
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (first_name, last_name, email, password, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, first_name, last_name, email, is_admin',
      [first_name, last_name, email, hash, phone]
    );
    const user = result.rows[0];
    const token = jwt.sign(user, process.env.JWT_SECRET || '100th_secret_key', { expiresIn: '30d' });
    res.json({ token, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid email or password' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });
    const { password: _, ...userSafe } = user;
    const token = jwt.sign(userSafe, process.env.JWT_SECRET || '100th_secret_key', { expiresIn: '30d' });
    res.json({ token, user: userSafe });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get current user
app.get('/api/auth/me', auth, async (req, res) => {
  const result = await pool.query('SELECT id, first_name, last_name, email, phone, is_admin FROM users WHERE id = $1', [req.user.id]);
  res.json(result.rows[0]);
});

// ══════════════════════════════════════════════════════
//  PRODUCT ROUTES
// ══════════════════════════════════════════════════════

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const { tag, search } = req.query;
    let query = 'SELECT * FROM products WHERE is_active = true';
    const params = [];
    if (tag) { params.push(tag); query += ` AND $${params.length} = ANY(tags)`; }
    if (search) { params.push(`%${search}%`); query += ` AND title ILIKE $${params.length}`; }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

// Upload image to Cloudinary
app.post('/api/upload', adminAuth, async (req, res) => {
  try {
    const { image, folder } = req.body; // base64 image
    const result = await cloudinary.uploader.upload(image, {
      folder: folder || '100th-store',
      transformation: [{ width: 800, crop: 'limit', quality: 'auto' }]
    });
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create product (admin only)
app.post('/api/products', adminAuth, async (req, res) => {
  try {
    const { title, description, price, compare_price, tags, sizes, colors, images, color_images, banner_slot, banner_image } = req.body;
    const result = await pool.query(
      `INSERT INTO products (title, description, price, compare_price, tags, sizes, colors, images, color_images, banner_slot, banner_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [title, description, price, compare_price || null, tags, sizes, colors, images, JSON.stringify(color_images || {}), banner_slot || null, banner_image || null]
    );
    // Update banner if set
    if (banner_slot && banner_image) {
      await pool.query(
        'INSERT INTO banners (slot, image_url) VALUES ($1,$2) ON CONFLICT (slot) DO UPDATE SET image_url = $2',
        [banner_slot, banner_image]
      );
    }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update product (admin only)
app.put('/api/products/:id', adminAuth, async (req, res) => {
  try {
    const { title, description, price, compare_price, tags, sizes, images } = req.body;
    const result = await pool.query(
      'UPDATE products SET title=$1, description=$2, price=$3, compare_price=$4, tags=$5, sizes=$6, images=$7 WHERE id=$8 RETURNING *',
      [title, description, price, compare_price, tags, sizes, images, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete product (admin only)
app.delete('/api/products/:id', adminAuth, async (req, res) => {
  await pool.query('UPDATE products SET is_active = false WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// Get banners
app.get('/api/banners', async (req, res) => {
  const result = await pool.query('SELECT * FROM banners ORDER BY slot');
  res.json(result.rows);
});

// ══════════════════════════════════════════════════════
//  WISHLIST ROUTES
// ══════════════════════════════════════════════════════
app.get('/api/wishlist', auth, async (req, res) => {
  const result = await pool.query(
    'SELECT p.* FROM products p JOIN wishlist w ON p.id = w.product_id WHERE w.user_id = $1 AND p.is_active = true',
    [req.user.id]
  );
  res.json(result.rows);
});

app.post('/api/wishlist/:productId', auth, async (req, res) => {
  try {
    await pool.query('INSERT INTO wishlist (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.params.productId]);
    res.json({ added: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/wishlist/:productId', auth, async (req, res) => {
  await pool.query('DELETE FROM wishlist WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.productId]);
  res.json({ removed: true });
});

// ══════════════════════════════════════════════════════
//  PAYMENT ROUTES
// ══════════════════════════════════════════════════════

// Initialize Paystack payment
app.post('/api/payment/paystack/init', auth, async (req, res) => {
  try {
    const { amount, email, order_ref, callback_url } = req.body;
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: Math.round(amount * 100), // kobo
      reference: order_ref,
      callback_url: callback_url || `${process.env.CLIENT_URL}/order-success`,
      metadata: { order_ref }
    }, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    res.json(response.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verify Paystack payment
app.get('/api/payment/paystack/verify/:reference', async (req, res) => {
  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${req.params.reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const data = response.data.data;
    if (data.status === 'success') {
      await pool.query(
        'UPDATE orders SET payment_status=$1, payment_ref=$2, status=$3 WHERE order_ref=$4',
        ['paid', req.params.reference, 'confirmed', data.metadata.order_ref]
      );
      // Trigger Sendbox delivery
      const order = await pool.query('SELECT * FROM orders WHERE order_ref=$1', [data.metadata.order_ref]);
      if (order.rows.length > 0) await bookSendboxDelivery(order.rows[0]);
    }
    res.json(response.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════
//  ORDER ROUTES
// ══════════════════════════════════════════════════════

// Create order
app.post('/api/orders', auth, async (req, res) => {
  try {
    const { items, delivery_address, delivery_fee } = req.body;
    const total = items.reduce((sum, i) => sum + (i.price * i.quantity), 0) + (delivery_fee || 0);
    const order_ref = 'ORD-' + uuidv4().slice(0, 8).toUpperCase();
    const result = await pool.query(
      'INSERT INTO orders (order_ref, user_id, items, total, delivery_fee, delivery_address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [order_ref, req.user.id, JSON.stringify(items), total, delivery_fee || 0, JSON.stringify(delivery_address)]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get user orders
app.get('/api/orders', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(result.rows);
});

// Get single order
app.get('/api/orders/:ref', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM orders WHERE order_ref=$1 AND user_id=$2', [req.params.ref, req.user.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
  res.json(result.rows[0]);
});

// Get all orders (admin)
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT o.*, u.first_name, u.last_name, u.email, u.phone
    FROM orders o JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC
  `);
  res.json(result.rows);
});

// ══════════════════════════════════════════════════════
//  SENDBOX DELIVERY
// ══════════════════════════════════════════════════════
async function bookSendboxDelivery(order) {
  try {
    if (!process.env.SENDBOX_API_KEY) return;
    const addr = order.delivery_address;
    const response = await axios.post('https://api.sendbox.co/shipping/shipments', {
      sender: {
        name: '100TH Store',
        phone: process.env.STORE_PHONE || '08000000000',
        address: process.env.STORE_ADDRESS || 'Lagos, Nigeria',
      },
      recipient: {
        name: addr.full_name,
        phone: addr.phone,
        address: addr.address + ', ' + addr.city + ', ' + addr.state,
      },
      package: {
        description: `100TH Order ${order.order_ref}`,
        weight: 0.5,
        value: order.total,
      },
      pickup_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    }, {
      headers: { Authorization: `Bearer ${process.env.SENDBOX_API_KEY}` }
    });
    const tracking = response.data?.tracking_number || response.data?.id;
    await pool.query('UPDATE orders SET sendbox_order_id=$1, delivery_tracking=$2, status=$3 WHERE id=$4',
      [response.data.id, tracking, 'processing', order.id]);
    console.log('Sendbox delivery booked:', tracking);
  } catch (err) {
    console.error('Sendbox error:', err.message);
  }
}

// Delivery fee estimate
app.post('/api/delivery/estimate', async (req, res) => {
  try {
    const { state } = req.body;
    // Simple fee calculation based on state
    const lagosStates = ['lagos'];
    const nearbyStates = ['ogun', 'oyo', 'osun', 'ekiti', 'ondo'];
    let fee = 3500;
    if (lagosStates.includes(state?.toLowerCase())) fee = 1200;
    else if (nearbyStates.includes(state?.toLowerCase())) fee = 2000;
    res.json({ fee, estimated_days: lagosStates.includes(state?.toLowerCase()) ? '1-2' : '2-4' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start server ──────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`100TH Store server running on port ${PORT}`);
});
