require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wishlist (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, product_id)
    );
  `);
  console.log('DB ready');
  const adminEmail = process.env.ADMIN_EMAIL || 'hundredsdotshop@gmail.com';
  const existing = await pool.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
  if (existing.rows.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@100th2026', 10);
    await pool.query('INSERT INTO users (first_name,last_name,email,password,is_admin) VALUES ($1,$2,$3,$4,$5)',
      ['Store','Admin',adminEmail,hash,true]);
    console.log('Admin created');
  }
}

function auth(req,res,next){
  const token=req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'No token'});
  try{ req.user=jwt.verify(token,process.env.JWT_SECRET||'100th_secret'); next(); }
  catch{ res.status(401).json({error:'Invalid token'}); }
}
function adminAuth(req,res,next){
  auth(req,res,()=>{ if(!req.user.is_admin) return res.status(403).json({error:'Admin only'}); next(); });
}

// AUTH
app.post('/api/auth/register',async(req,res)=>{
  try{
    const{first_name,last_name,email,password,phone}=req.body;
    if(!email||!password||!first_name) return res.status(400).json({error:'Missing fields'});
    const exists=await pool.query('SELECT id FROM users WHERE email=$1',[email]);
    if(exists.rows.length>0) return res.status(400).json({error:'Email already registered'});
    const hash=await bcrypt.hash(password,10);
    const result=await pool.query('INSERT INTO users (first_name,last_name,email,password,phone) VALUES ($1,$2,$3,$4,$5) RETURNING id,first_name,last_name,email,is_admin',[first_name,last_name,email,hash,phone]);
    const user=result.rows[0];
    const token=jwt.sign(user,process.env.JWT_SECRET||'100th_secret',{expiresIn:'30d'});
    res.json({token,user});
  }catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/auth/login',async(req,res)=>{
  try{
    const{email,password}=req.body;
    const result=await pool.query('SELECT * FROM users WHERE email=$1',[email]);
    if(result.rows.length===0) return res.status(400).json({error:'Invalid email or password'});
    const user=result.rows[0];
    const valid=await bcrypt.compare(password,user.password);
    if(!valid) return res.status(400).json({error:'Invalid email or password'});
    const{password:_,...userSafe}=user;
    const token=jwt.sign(userSafe,process.env.JWT_SECRET||'100th_secret',{expiresIn:'30d'});
    res.json({token,user:userSafe});
  }catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/auth/me',auth,async(req,res)=>{
  const result=await pool.query('SELECT id,first_name,last_name,email,phone,is_admin FROM users WHERE id=$1',[req.user.id]);
  res.json(result.rows[0]);
});

// PRODUCTS
app.get('/api/products',async(req,res)=>{
  try{
    const{tag,search}=req.query;
    let query='SELECT * FROM products WHERE is_active=true';
    const params=[];
    if(tag){params.push(tag);query+=` AND $${params.length}=ANY(tags)`;}
    if(search){params.push(`%${search}%`);query+=` AND title ILIKE $${params.length}`;}
    query+=' ORDER BY created_at DESC';
    const result=await pool.query(query,params);
    res.json(result.rows);
  }catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/products/:id',async(req,res)=>{
  const result=await pool.query('SELECT * FROM products WHERE id=$1',[req.params.id]);
  if(result.rows.length===0) return res.status(404).json({error:'Not found'});
  res.json(result.rows[0]);
});

app.post('/api/upload',adminAuth,async(req,res)=>{
  try{
    const{image,folder}=req.body;
    const result=await cloudinary.uploader.upload(image,{folder:folder||'100th-store',transformation:[{width:800,crop:'limit',quality:'auto'}]});
    res.json({url:result.secure_url,public_id:result.public_id});
  }catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/products',adminAuth,async(req,res)=>{
  try{
    const{title,description,price,compare_price,tags,sizes,colors,images,color_images,banner_slot,banner_image}=req.body;
    const result=await pool.query(`INSERT INTO products (title,description,price,compare_price,tags,sizes,colors,images,color_images,banner_slot,banner_image) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [title,description,price,compare_price||null,tags,sizes,colors,images,JSON.stringify(color_images||{}),banner_slot||null,banner_image||null]);
    res.json(result.rows[0]);
  }catch(err){res.status(500).json({error:err.message});}
});

app.delete('/api/products/:id',adminAuth,async(req,res)=>{
  await pool.query('UPDATE products SET is_active=false WHERE id=$1',[req.params.id]);
  res.json({success:true});
});

// WISHLIST
app.get('/api/wishlist',auth,async(req,res)=>{
  const result=await pool.query('SELECT p.* FROM products p JOIN wishlist w ON p.id=w.product_id WHERE w.user_id=$1 AND p.is_active=true',[req.user.id]);
  res.json(result.rows);
});
app.post('/api/wishlist/:productId',auth,async(req,res)=>{
  try{await pool.query('INSERT INTO wishlist (user_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[req.user.id,req.params.productId]);res.json({added:true});}
  catch(err){res.status(500).json({error:err.message});}
});
app.delete('/api/wishlist/:productId',auth,async(req,res)=>{
  await pool.query('DELETE FROM wishlist WHERE user_id=$1 AND product_id=$2',[req.user.id,req.params.productId]);
  res.json({removed:true});
});

// ORDERS
app.post('/api/orders',auth,async(req,res)=>{
  try{
    const{items,delivery_address,delivery_fee}=req.body;
    const total=items.reduce((sum,i)=>sum+(i.price*i.quantity),0)+(delivery_fee||0);
    const order_ref='ORD-'+uuidv4().slice(0,8).toUpperCase();
    const result=await pool.query('INSERT INTO orders (order_ref,user_id,items,total,delivery_fee,delivery_address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [order_ref,req.user.id,JSON.stringify(items),total,delivery_fee||0,JSON.stringify(delivery_address)]);
    res.json(result.rows[0]);
  }catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/orders',auth,async(req,res)=>{
  const result=await pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);
  res.json(result.rows);
});

app.get('/api/orders/:ref',auth,async(req,res)=>{
  const result=await pool.query('SELECT * FROM orders WHERE order_ref=$1 AND user_id=$2',[req.params.ref,req.user.id]);
  if(result.rows.length===0) return res.status(404).json({error:'Not found'});
  res.json(result.rows[0]);
});

app.get('/api/admin/orders',adminAuth,async(req,res)=>{
  const result=await pool.query('SELECT o.*,u.first_name,u.last_name,u.email,u.phone FROM orders o JOIN users u ON o.user_id=u.id ORDER BY o.created_at DESC');
  res.json(result.rows);
});

// PAYMENT
app.post('/api/payment/paystack/init',auth,async(req,res)=>{
  try{
    const{amount,email,order_ref,callback_url}=req.body;
    const response=await axios.post('https://api.paystack.co/transaction/initialize',{
      email,amount:Math.round(amount*100),reference:order_ref,
      callback_url:callback_url||`${process.env.CLIENT_URL}/order-success`,
      metadata:{order_ref}
    },{headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});
    res.json(response.data);
  }catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/payment/paystack/verify/:reference',async(req,res)=>{
  try{
    const response=await axios.get(`https://api.paystack.co/transaction/verify/${req.params.reference}`,
      {headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});
    const data=response.data.data;
    if(data.status==='success'){
      await pool.query('UPDATE orders SET payment_status=$1,payment_ref=$2,status=$3 WHERE order_ref=$4',
        ['paid',req.params.reference,'confirmed',data.metadata.order_ref]);
    }
    res.json(response.data);
  }catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/delivery/estimate',async(req,res)=>{
  const{state}=req.body;
  let fee=3500;
  if(['lagos'].includes(state?.toLowerCase())) fee=1200;
  else if(['ogun','oyo','osun','ekiti','ondo'].includes(state?.toLowerCase())) fee=2000;
  res.json({fee,estimated_days:state?.toLowerCase()==='lagos'?'1-2':'2-4'});
});

// ─── SERVE FRONTEND ──────────────────────────────────────────────────────────
app.get('*',(req,res)=>{
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#060606"/>
<title>100TH Store — Dress Like It Matters</title>
<style>
/* ── RESET & TOKENS ─────────────────────────────────── */
:root{
  --black:#060606;--white:#f5f5f0;--accent:#08f7f7;
  --red:#e53935;--grey:#1a1a1a;--grey-mid:#888;
  --font-display:'Bebas Neue',sans-serif;
  --font-body:system-ui,-apple-system,'Segoe UI',sans-serif;
}
@font-face{
  font-family:'Bebas Neue';
  font-style:normal;font-weight:400;font-display:swap;
  src:url('https://fonts.gstatic.com/s/bebasneu/v14/JTUSjIg69CK48gW7PXoo9WdhyyTh89ZNpQ.woff2') format('woff2');
}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{background:var(--black);color:var(--white);font-family:var(--font-body);min-height:100vh;}
a{text-decoration:none;color:inherit;}
button{cursor:pointer;font-family:var(--font-body);border:none;background:none;}
input,select,textarea{font-family:var(--font-body);}
img{display:block;}

/* ── LAYOUT ────────────────────────────────────────── */
#app{display:flex;flex-direction:column;min-height:100vh;}
.page{flex:1;}

/* ── ANNOUNCEMENT ──────────────────────────────────── */
.ann{background:var(--accent);color:#000;text-align:center;padding:7px 14px;font-size:12px;font-weight:600;}

/* ── HEADER ────────────────────────────────────────── */
.header{
  position:sticky;top:0;z-index:9000;
  background:var(--black);border-bottom:1px solid rgba(255,255,255,.08);
  display:flex;align-items:center;justify-content:space-between;
  padding:0 14px;height:54px;
}
.logo{font-family:var(--font-display);font-size:26px;letter-spacing:.1em;cursor:pointer;}
.logo span{color:var(--accent);}
.header-right{display:flex;align-items:center;gap:4px;}
.hbtn{
  display:flex;flex-direction:column;align-items:center;gap:2px;
  padding:6px 8px;color:rgba(255,255,255,.7);font-size:10px;position:relative;
}
.hbtn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.cart-badge{
  position:absolute;top:2px;right:2px;background:var(--red);color:#fff;
  font-size:9px;font-weight:700;width:16px;height:16px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
}
.admin-add-btn{
  background:var(--accent);color:#000;padding:7px 12px;
  font-family:var(--font-display);font-size:14px;letter-spacing:.1em;
}

/* ── TOAST ─────────────────────────────────────────── */
#toast{
  position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
  background:rgba(8,247,247,.15);border:1px solid var(--accent);color:var(--accent);
  padding:10px 20px;font-size:13px;z-index:99999;white-space:nowrap;
  opacity:0;transition:opacity .3s;pointer-events:none;border-radius:4px;
}
#toast.show{opacity:1;}

/* ── SPINNER ────────────────────────────────────────── */
.spinner{display:flex;align-items:center;justify-content:center;padding:60px;}
.spin{
  width:32px;height:32px;border:3px solid rgba(8,247,247,.2);
  border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg);}}

/* ── CAT STRIP ──────────────────────────────────────── */
.cat-strip{
  display:flex;gap:8px;overflow-x:auto;padding:10px 14px;
  background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.05);
  scrollbar-width:none;
}
.cat-strip::-webkit-scrollbar{display:none;}
.cat-pill{
  display:flex;flex-direction:column;align-items:center;gap:3px;
  padding:8px 14px;background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.5);
  font-size:11px;white-space:nowrap;flex-shrink:0;border-radius:8px;
}
.cat-pill.active{background:rgba(8,247,247,.1);border-color:var(--accent);color:var(--accent);}

/* ── FLASH ──────────────────────────────────────────── */
.flash{
  display:flex;align-items:center;gap:10px;padding:10px 14px;
  background:linear-gradient(90deg,#b71c1c,#e53935);
}
.flash-title{font-family:var(--font-display);font-size:16px;letter-spacing:.1em;}
.flash-timer{
  font-family:monospace;font-size:16px;font-weight:700;
  background:rgba(0,0,0,.3);padding:4px 10px;border-radius:4px;flex-shrink:0;
}
.flash-cta{
  font-size:11px;font-weight:700;color:#fff;padding:6px 12px;
  background:rgba(0,0,0,.3);border-radius:4px;white-space:nowrap;margin-left:auto;
}

/* ── BANNER CAROUSEL ────────────────────────────────── */
.banner{
  position:relative;overflow:hidden;height:220px;
  background:#0a0a0a;display:flex;align-items:center;padding:0 24px;
}
.banner-slide{
  position:absolute;inset:0;display:flex;align-items:center;padding:0 24px;
  opacity:0;transition:opacity .6s;pointer-events:none;
}
.banner-slide.active{opacity:1;pointer-events:auto;}
.banner-eye{font-size:11px;color:var(--accent);letter-spacing:.15em;margin-bottom:6px;}
.banner-h{
  font-family:var(--font-display);font-size:42px;line-height:.95;
  margin-bottom:10px;white-space:pre-line;
}
.banner-sub{font-size:12px;color:rgba(255,255,255,.6);margin-bottom:14px;}
.banner-cta{
  padding:10px 20px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:14px;letter-spacing:.1em;
}
.banner-dots{
  position:absolute;bottom:12px;left:50%;transform:translateX(-50%);
  display:flex;gap:6px;
}
.banner-dot{
  width:6px;height:6px;border-radius:50%;
  background:rgba(255,255,255,.3);transition:background .3s;
}
.banner-dot.active{background:var(--accent);}

/* ── SECTION ────────────────────────────────────────── */
.section{padding:16px 0;}
.sec-header{display:flex;align-items:center;justify-content:space-between;padding:0 14px 12px;}
.sec-title{font-family:var(--font-display);font-size:22px;letter-spacing:.1em;}
.sec-link{font-size:12px;color:var(--accent);}

/* ── PRODUCT GRID ────────────────────────────────────── */
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 10px;}
.card{
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);
  border-radius:4px;overflow:hidden;cursor:pointer;
}
.card-img{
  position:relative;aspect-ratio:1;overflow:hidden;
  background:rgba(255,255,255,.04);display:flex;align-items:center;
  justify-content:center;font-size:48px;
}
.card-img img{width:100%;height:100%;object-fit:cover;}
.card-badge{position:absolute;top:8px;left:8px;font-size:9px;font-weight:700;padding:3px 7px;}
.badge-new{background:var(--accent);color:#000;}
.badge-sale{background:var(--red);color:#fff;}
.badge-ltd{background:#ff6f00;color:#fff;}
.wish-btn{
  position:absolute;top:8px;right:8px;width:30px;height:30px;
  border-radius:50%;background:rgba(0,0,0,.5);color:#fff;font-size:14px;
}
.wish-btn.active{background:var(--red);}
.card-info{padding:10px;}
.card-name{font-size:12px;margin-bottom:4px;line-height:1.3;}
.card-price{font-size:14px;font-weight:700;color:var(--accent);}
.card-compare{font-size:11px;color:var(--grey-mid);text-decoration:line-through;margin-left:6px;}
.card-rating{font-size:11px;margin:4px 0 8px;}
.atc{
  width:100%;padding:9px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:13px;letter-spacing:.08em;
}

/* ── EMPTY STATE ────────────────────────────────────── */
.empty{text-align:center;padding:50px 20px;}
.empty-icon{font-size:44px;margin-bottom:12px;}
.empty-title{font-size:16px;font-weight:600;margin-bottom:6px;}
.empty-sub{font-size:13px;color:var(--grey-mid);margin-bottom:20px;}
.shop-btn{
  display:inline-block;padding:12px 28px;background:var(--accent);
  color:#000;font-family:var(--font-display);font-size:14px;letter-spacing:.1em;
}

/* ── FOOTER ─────────────────────────────────────────── */
footer{
  background:rgba(255,255,255,.02);border-top:1px solid rgba(255,255,255,.06);
  padding:24px 14px;margin-top:20px;
}
.foot-brand{font-family:var(--font-display);font-size:24px;margin-bottom:4px;}
.foot-brand span{color:var(--accent);}
.foot-links{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;}
.foot-links a{font-size:12px;color:rgba(255,255,255,.5);}
.foot-copy{font-size:11px;color:rgba(255,255,255,.25);}

/* ── PRODUCT DETAIL ─────────────────────────────────── */
.gal-main{
  aspect-ratio:1;overflow:hidden;background:rgba(255,255,255,.04);
  display:flex;align-items:center;justify-content:center;font-size:80px;
}
.gal-main img{width:100%;height:100%;object-fit:cover;}
.gal-thumbs{display:flex;gap:8px;padding:8px 14px;overflow-x:auto;}
.gal-thumb{
  width:60px;height:60px;object-fit:cover;
  border:2px solid transparent;flex-shrink:0;cursor:pointer;
}
.gal-thumb.active{border-color:var(--accent);}
.pd-info{padding:16px 14px;}
.pd-title{font-family:var(--font-display);font-size:26px;letter-spacing:.08em;margin-bottom:8px;}
.pd-price{font-size:24px;font-weight:700;color:var(--accent);margin-bottom:4px;}
.pd-compare{font-size:14px;color:#888;text-decoration:line-through;margin-bottom:12px;}
.pd-stars{display:flex;align-items:center;gap:6px;margin-bottom:16px;}
.pd-label{font-size:11px;color:rgba(255,255,255,.5);letter-spacing:.1em;margin-bottom:8px;}
.swatches{display:flex;gap:8px;margin-bottom:16px;}
.swatch{
  width:28px;height:28px;border-radius:50%;
  border:2px solid transparent;cursor:pointer;
}
.swatch.active{border-color:var(--white);}
.sizes{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
.sz-btn{
  width:44px;height:36px;background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.6);font-size:12px;
}
.sz-btn.active{background:rgba(8,247,247,.15);border-color:var(--accent);color:var(--accent);}
.pd-add{
  width:100%;padding:15px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:18px;letter-spacing:.12em;margin-bottom:10px;
}
.pd-wish{
  width:100%;padding:13px;background:transparent;
  border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.6);font-size:14px;
}
.pd-desc{
  padding:16px 14px;border-top:1px solid rgba(255,255,255,.06);
  font-size:13px;color:rgba(255,255,255,.65);line-height:1.7;
}

/* ── AUTH ────────────────────────────────────────────── */
.auth-page{
  min-height:80vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;padding:24px 16px;
}
.auth-logo{font-family:var(--font-display);font-size:32px;letter-spacing:.15em;margin-bottom:24px;}
.auth-logo span{color:var(--accent);}
.auth-card{
  width:100%;max-width:400px;background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.1);padding:28px 24px;
}
.auth-title{font-family:var(--font-display);font-size:24px;letter-spacing:.1em;margin-bottom:6px;}
.auth-sub{font-size:13px;color:var(--grey-mid);margin-bottom:22px;}
.auth-err{
  background:rgba(229,57,53,.1);border:1px solid rgba(229,57,53,.3);
  color:#ef9a9a;padding:10px;font-size:12px;margin-bottom:14px;
}
.field{margin-bottom:14px;}
.field label{
  display:block;font-size:11px;color:rgba(255,255,255,.5);
  letter-spacing:.08em;margin-bottom:6px;
}
.field input,.field select,.field textarea{
  width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  color:var(--white);padding:11px 12px;font-size:14px;outline:none;
}
.field input:focus,.field select:focus{border-color:var(--accent);}
.field select option{background:#1a1a1a;}
.auth-btn{
  width:100%;padding:14px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:16px;letter-spacing:.12em;margin-top:6px;
}
.auth-div{text-align:center;margin:16px 0;position:relative;}
.auth-div::before{content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(255,255,255,.08);}
.auth-div span{background:rgba(255,255,255,.03);padding:0 12px;font-size:11px;color:rgba(255,255,255,.3);position:relative;}
.auth-link-btn{
  display:block;text-align:center;padding:12px;
  border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6);font-size:13px;width:100%;
}
.back-link{margin-top:16px;font-size:12px;color:#888;}

/* ── ACCOUNT ────────────────────────────────────────── */
.acct-hero{
  display:flex;align-items:center;gap:14px;padding:20px 14px;
  background:linear-gradient(135deg,rgba(8,247,247,.08),transparent);
}
.acct-av{
  width:54px;height:54px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:24px;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.acct-name{font-family:var(--font-display);font-size:20px;letter-spacing:.08em;}
.acct-email{font-size:12px;color:var(--grey-mid);margin-top:2px;}
.stats{display:flex;background:rgba(255,255,255,.03);}
.stat{flex:1;text-align:center;padding:14px 8px;}
.stat-n{font-family:var(--font-display);font-size:24px;color:var(--accent);}
.stat-l{font-size:10px;color:var(--grey-mid);letter-spacing:.06em;}
.tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.08);}
.tab{flex:1;padding:13px;font-size:12px;color:rgba(255,255,255,.4);}
.tab.active{color:var(--accent);border-bottom:2px solid var(--accent);}
.panel{display:none;padding:16px 14px;}
.panel.active{display:block;}
.ord-card{
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);
  margin-bottom:12px;
}
.ord-top{
  display:flex;justify-content:space-between;align-items:flex-start;
  padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.06);
}
.ord-num{font-size:13px;font-weight:600;}
.ord-date{font-size:11px;color:var(--grey-mid);}
.ord-status{font-size:11px;padding:4px 10px;border-radius:20px;background:rgba(8,247,247,.1);color:var(--accent);}
.ord-foot{
  display:flex;justify-content:space-between;align-items:center;
  padding:10px 14px;
}
.ord-total{font-size:13px;}
.prof-card{
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);margin-bottom:16px;
}
.prof-row{
  display:flex;justify-content:space-between;padding:13px 14px;
  border-bottom:1px solid rgba(255,255,255,.05);font-size:13px;
}
.prof-key{color:rgba(255,255,255,.4);font-size:12px;}
.logout-btn{
  width:100%;padding:13px;background:transparent;
  border:1px solid rgba(229,57,53,.3);color:#ef9a9a;font-size:13px;
}

/* ── CART ────────────────────────────────────────────── */
.cart-page{padding:16px 14px;max-width:600px;margin:0 auto;}
.cart-title{font-family:var(--font-display);font-size:28px;letter-spacing:.1em;margin-bottom:16px;}
.cart-item{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.06);}
.cart-img{width:80px;height:80px;object-fit:cover;flex-shrink:0;}
.cart-img-ph{
  width:80px;height:80px;background:rgba(255,255,255,.05);
  display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;
}
.cart-info{flex:1;}
.cart-name{font-size:13px;margin-bottom:4px;}
.cart-meta{font-size:11px;color:var(--grey-mid);margin-bottom:8px;}
.cart-price{font-size:14px;font-weight:700;color:var(--accent);}
.qty-row{display:flex;align-items:center;gap:10px;margin-top:8px;}
.qty-btn{
  width:28px;height:28px;background:rgba(255,255,255,.08);color:var(--white);font-size:16px;
}
.qty-n{font-size:14px;min-width:20px;text-align:center;}
.rm-btn{color:var(--grey-mid);font-size:11px;margin-left:auto;}
.summary{margin-top:16px;padding:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);}
.sum-row{display:flex;justify-content:space-between;font-size:13px;padding:6px 0;}
.sum-total{
  display:flex;justify-content:space-between;font-size:16px;font-weight:700;
  padding:10px 0;border-top:1px solid rgba(255,255,255,.1);margin-top:6px;
}
.chk-btn{
  width:100%;padding:15px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:18px;letter-spacing:.12em;margin-top:14px;
}

/* ── CHECKOUT ────────────────────────────────────────── */
.chk-page{padding:16px 14px;max-width:600px;margin:0 auto 40px;}
.chk-title{font-family:var(--font-display);font-size:28px;letter-spacing:.1em;margin-bottom:16px;}
.sec-t{
  font-size:13px;color:var(--accent);letter-spacing:.1em;margin-bottom:12px;
  border-bottom:1px solid rgba(8,247,247,.2);padding-bottom:6px;
}
.f-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.deliv-info{
  background:rgba(8,247,247,.06);border:1px solid rgba(8,247,247,.2);
  padding:12px;font-size:12px;color:var(--accent);margin-bottom:14px;
}
.pay-methods{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;}
.pay-method{
  display:flex;align-items:center;gap:12px;padding:13px;
  border:1px solid rgba(255,255,255,.1);cursor:pointer;
}
.pay-method.sel{border-color:var(--accent);background:rgba(8,247,247,.05);}
.pay-name{font-size:13px;font-weight:600;}
.pay-sub{font-size:11px;color:var(--grey-mid);}
.pay-btn{
  width:100%;padding:15px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:18px;letter-spacing:.12em;
}

/* ── ORDER SUCCESS ────────────────────────────────────── */
.success-page{
  min-height:80vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;padding:30px 20px;text-align:center;
}
.success-icon{font-size:64px;margin-bottom:16px;}
.success-title{font-family:var(--font-display);font-size:28px;color:var(--accent);margin-bottom:8px;}
.success-sub{font-size:14px;color:var(--grey-mid);margin-bottom:24px;line-height:1.6;}
.success-ref{
  background:rgba(8,247,247,.08);border:1px solid rgba(8,247,247,.2);
  padding:12px 20px;font-size:14px;color:var(--accent);margin-bottom:24px;
}

/* ── ADMIN MODAL ────────────────────────────────────── */
.modal-ov{
  position:fixed;inset:0;background:rgba(0,0,0,.8);
  z-index:9999;display:flex;align-items:flex-end;
}
.modal-sheet{
  width:100%;background:var(--black);border-top:1px solid rgba(255,255,255,.1);
  max-height:92vh;overflow-y:auto;
}
.modal-hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08);
}
.modal-title{font-family:var(--font-display);font-size:20px;letter-spacing:.12em;}
.modal-close{color:var(--grey-mid);font-size:20px;}
.mtabs{
  display:flex;border-bottom:1px solid rgba(255,255,255,.08);overflow-x:auto;
}
.mtab{
  flex:1;min-width:70px;padding:11px 6px;font-size:11px;
  color:rgba(255,255,255,.4);white-space:nowrap;
}
.mtab.active{color:var(--accent);border-bottom:2px solid var(--accent);}
.mbody{padding:18px;}
.mpanel{display:none;}
.mpanel.active{display:block;}
.flabel{display:block;font-size:11px;color:rgba(255,255,255,.5);letter-spacing:.08em;margin-bottom:6px;}
.finput{
  width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  color:var(--white);padding:10px 12px;font-size:13px;outline:none;
}
.finput:focus{border-color:var(--accent);}
.tag-row{display:flex;flex-wrap:wrap;gap:6px;}
.tag-btn{
  padding:5px 10px;background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.5);font-size:11px;
}
.tag-btn.on{background:rgba(8,247,247,.12);border-color:var(--accent);color:var(--accent);}
.sz-row{display:flex;gap:6px;}
.sz-tog{
  width:44px;height:36px;background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.4);font-size:12px;
}
.sz-tog.on{background:rgba(8,247,247,.12);border-color:var(--accent);color:var(--accent);}
.photo-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:16px;}
.photo-slot{
  aspect-ratio:1;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.15);
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  position:relative;overflow:hidden;font-size:20px;color:rgba(255,255,255,.2);
}
.photo-slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.col-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
.col-card{display:flex;flex-direction:column;align-items:center;gap:6px;}
.col-dot{width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,255,255,.15);}
.col-lbl{font-size:10px;color:rgba(255,255,255,.4);}
.col-zone{
  width:100%;aspect-ratio:1;background:rgba(255,255,255,.04);
  border:1px dashed rgba(255,255,255,.15);display:flex;align-items:center;
  justify-content:center;cursor:pointer;position:relative;overflow:hidden;
  font-size:24px;color:rgba(255,255,255,.2);
}
.col-zone img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.next-btn{
  width:100%;padding:13px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:15px;letter-spacing:.1em;margin-top:14px;
}
.pub-btn{
  width:100%;padding:15px;background:var(--accent);color:#000;
  font-family:var(--font-display);font-size:17px;letter-spacing:.12em;margin-top:8px;
}
.hint{font-size:11px;color:rgba(255,255,255,.35);line-height:1.6;margin-bottom:12px;}
.sum-box{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);padding:14px;margin-bottom:16px;}
.sum-row2{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px;}
.sum-k{color:rgba(255,255,255,.4);min-width:110px;}
</style>
</head>
<body>
<div id="app"></div>
<div id="toast"></div>

<script>
'use strict';

// ─── UTILITIES ───────────────────────────────────────────────────────────────
const fmt = p => '₦' + Number(p).toLocaleString('en-NG');

function toast(msg, dur = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), dur);
}

// Lightweight fetch wrapper (replaces axios)
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const token = localStorage.getItem('100th_token');
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
const GET  = url        => api('GET',    url);
const POST = (url, b)   => api('POST',   url, b);
const DEL  = url        => api('DELETE', url);

// ─── STATE ───────────────────────────────────────────────────────────────────
const State = {
  user: null,
  cart: (() => { try { return JSON.parse(localStorage.getItem('100th_cart') || '[]'); } catch { return []; } })(),
  wishlist: [],
  page: location.pathname,
};

function saveCart() { localStorage.setItem('100th_cart', JSON.stringify(State.cart)); }
function cartCount() { return State.cart.reduce((s, i) => s + i.quantity, 0); }
function cartTotal() { return State.cart.reduce((s, i) => s + i.price * i.quantity, 0); }

function addToCart(product, size, color, qty = 1) {
  const key = product.id + '-' + size + '-' + color;
  const ex = State.cart.find(i => i.key === key);
  if (ex) ex.quantity += qty;
  else State.cart.push({ key, product, size, color, quantity: qty, price: Number(product.price) });
  saveCart();
  updateCartBadge();
}
function removeFromCart(key) { State.cart = State.cart.filter(i => i.key !== key); saveCart(); }
function updateQty(key, qty) { if (qty <= 0) return removeFromCart(key); const i = State.cart.find(x => x.key === key); if (i) i.quantity = qty; saveCart(); }

function updateCartBadge() {
  const b = document.querySelector('.cart-badge');
  const n = cartCount();
  if (b) { b.textContent = n; b.style.display = n > 0 ? 'flex' : 'none'; }
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
function navigate(path) {
  history.pushState({}, '', path);
  State.page = path;
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => { State.page = location.pathname; render(); window.scrollTo(0, 0); });

// Intercept anchor clicks for SPA navigation
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (a) { e.preventDefault(); navigate(a.getAttribute('href')); }
});

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function svgIcon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.innerHTML = path;
  return svg;
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
function buildHeader() {
  const n = cartCount();
  const cartBadge = el('span', { className: 'cart-badge', style: { display: n > 0 ? 'flex' : 'none' } }, String(n));

  const row = el('div', { className: 'header-right' });

  if (State.user?.is_admin) {
    row.appendChild(el('button', { className: 'admin-add-btn', onClick: () => openAdminModal() }, '＋ Add'));
  }

  // Wishlist icon
  row.appendChild(el('button', { className: 'hbtn', onClick: () => navigate(State.user ? '/account' : '/login') },
    svgIcon('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>')
  ));

  // Cart icon
  const cartBtn = el('button', { className: 'hbtn', onClick: () => navigate('/cart') },
    svgIcon('<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>'),
    cartBadge
  );
  row.appendChild(cartBtn);

  // User icon
  row.appendChild(el('button', { className: 'hbtn', onClick: () => navigate(State.user ? '/account' : '/login') },
    svgIcon('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    el('span', {}, State.user ? State.user.first_name : 'Sign In')
  ));

  return el('div', {},
    el('div', { className: 'ann' }, 'Free delivery on orders over ₦15,000 · New drops daily'),
    el('header', { className: 'header' },
      el('div', { className: 'logo', onClick: () => navigate('/') }, '100', el('span', {}, 'TH')),
      row
    )
  );
}

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
const CATS = [
  { label: 'All', icon: '🏠', cat: 'all' },
  { label: 'T-Shirts', icon: '👕', cat: 't-shirts' },
  { label: 'Limited', icon: '⭐', cat: 'limited-edition' },
  { label: 'New In', icon: '🆕', cat: 'new-arrivals' },
  { label: 'Best Picks', icon: '🏆', cat: 'best-picks' },
];
const BANNERS = [
  { h: 'DRESS\\nLIKE IT\\nMATTERS', sub: 'Premium Nigerian streetwear', eye: 'NEW COLLECTION 2026' },
  { h: 'LIMITED\\nEDITION', sub: 'Only a few left', eye: 'EXCLUSIVE DROP' },
  { h: 'EXPRESS\\nYOURSELF', sub: 'Custom designs available', eye: 'CUSTOM DESIGN' },
];

let _homeState = { products: [], loading: true, cat: 'all', wishlist: [], bIdx: 0 };
let _bannerInterval, _timerInterval;

async function buildHome() {
  const wrap = el('div', { className: 'page' });

  // Category strip
  const catStrip = el('div', { className: 'cat-strip' });
  function updateCats() {
    catStrip.innerHTML = '';
    CATS.forEach(c => {
      const pill = el('div', { className: 'cat-pill' + (_homeState.cat === c.cat ? ' active' : ''),
        onClick: () => { _homeState.cat = c.cat; updateCats(); loadProducts(c.cat); }
      }, el('span', { style: { fontSize: '18px' } }, c.icon), el('span', {}, c.label));
      catStrip.appendChild(pill);
    });
  }
  updateCats();
  wrap.appendChild(catStrip);

  // Flash sale bar
  const timerEl = el('div', { className: 'flash-timer' }, '00:00:00');
  function tickTimer() {
    const now = new Date(), end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const d = end - now;
    const h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000), s = Math.floor((d % 60000) / 1000);
    timerEl.textContent = String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  }
  tickTimer();
  _timerInterval = setInterval(tickTimer, 1000);

  const flash = el('div', { className: 'flash' },
    el('span', { style: { fontSize: '18px' } }, '⚡'),
    el('span', { className: 'flash-title' }, 'FLASH SALE'),
    el('span', { style: { fontSize: '11px', opacity: '0.8', marginLeft: '6px' } }, 'Limited deals'),
    timerEl,
    el('button', { className: 'flash-cta', onClick: () => { _homeState.cat = 'sale'; updateCats(); loadProducts('sale'); } }, 'SEE ALL →')
  );
  wrap.appendChild(flash);

  // Banner carousel
  const bannerWrap = el('div', { className: 'banner' });
  const slides = BANNERS.map((b, i) => {
    const s = el('div', { className: 'banner-slide' + (i === 0 ? ' active' : '') },
      el('div', { className: 'banner-content' },
        el('div', { className: 'banner-eye' }, b.eye),
        el('div', { className: 'banner-h' }, b.h.replace(/\\n/g, '\n')),
        el('div', { className: 'banner-sub' }, b.sub),
        el('button', { className: 'banner-cta', onClick: () => { _homeState.cat = 't-shirts'; updateCats(); loadProducts('t-shirts'); } }, 'SHOP T-SHIRTS')
      )
    );
    bannerWrap.appendChild(s);
    return s;
  });
  const dotsWrap = el('div', { className: 'banner-dots' });
  const dots = BANNERS.map((_, i) => {
    const d = el('div', { className: 'banner-dot' + (i === 0 ? ' active' : '') });
    dotsWrap.appendChild(d);
    return d;
  });
  bannerWrap.appendChild(dotsWrap);
  wrap.appendChild(bannerWrap);

  clearInterval(_bannerInterval);
  _bannerInterval = setInterval(() => {
    _homeState.bIdx = (_homeState.bIdx + 1) % BANNERS.length;
    slides.forEach((s, i) => s.classList.toggle('active', i === _homeState.bIdx));
    dots.forEach((d, i) => d.classList.toggle('active', i === _homeState.bIdx));
  }, 5000);

  // Product area
  const prodArea = el('div', {});
  wrap.appendChild(prodArea);

  // Footer
  wrap.appendChild(buildFooter());

  // Wishlist
  if (State.user) {
    GET('/api/wishlist').then(data => {
      _homeState.wishlist = data.map(p => p.id);
      renderProducts();
    }).catch(() => {});
  }

  async function loadProducts(cat) {
    _homeState.loading = true;
    renderProducts();
    try {
      const params = cat && cat !== 'all' ? '?tag=' + cat : '';
      _homeState.products = await GET('/api/products' + params);
    } catch { _homeState.products = []; }
    _homeState.loading = false;
    renderProducts();
  }

  function renderProducts() {
    prodArea.innerHTML = '';
    if (_homeState.loading) { prodArea.appendChild(el('div', { className: 'spinner' }, el('div', { className: 'spin' }))); return; }

    const prods = _homeState.products;
    if (_homeState.cat !== 'all') {
      prodArea.appendChild(buildSection(CATS.find(c => c.cat === _homeState.cat)?.label || 'Products', prods, null));
    } else {
      const newArrivals = prods.filter(p => p.tags?.includes('new-arrivals') || !p.tags?.length);
      const bestPicks   = prods.filter(p => p.tags?.includes('best-picks'));
      const limited     = prods.filter(p => p.tags?.includes('limited-edition'));
      if (newArrivals.length) prodArea.appendChild(buildSection('JUST IN', newArrivals, 'new-arrivals'));
      if (bestPicks.length)   prodArea.appendChild(buildSection('BEST PICKS', bestPicks, 'best-picks'));
      if (limited.length)     prodArea.appendChild(buildSection('LIMITED EDITION', limited, 'limited-edition'));
      if (!prods.length) {
        prodArea.appendChild(el('div', { style: { textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.4)' } },
          el('div', { style: { fontSize: '48px', marginBottom: '12px' } }, '👕'),
          el('div', { style: { fontSize: '16px', marginBottom: '6px', color: '#fff' } }, 'Products coming soon'),
          el('div', { style: { fontSize: '13px' } }, 'Admin: tap "+ Add" to upload your first product')
        ));
      }
    }
  }

  function buildSection(title, items, linkCat) {
    if (!items.length) return el('div', {});
    const sec = el('div', { className: 'section' },
      el('div', { className: 'sec-header' },
        el('h2', { className: 'sec-title' }, title),
        linkCat ? el('button', { className: 'sec-link', onClick: () => { _homeState.cat = linkCat; updateCats(); loadProducts(linkCat); } }, 'See all →') : el('span', {})
      )
    );
    const grid = el('div', { className: 'grid' });
    items.slice(0, 4).forEach(p => grid.appendChild(buildCard(p)));
    sec.appendChild(grid);
    return sec;
  }

  function buildCard(p) {
    const inWish = _homeState.wishlist.includes(p.id);
    const imgArea = el('div', { className: 'card-img' });
    if (p.images?.[0]) imgArea.appendChild(el('img', { src: p.images[0], alt: p.title, loading: 'lazy' }));
    else imgArea.appendChild(el('span', {}, '👕'));
    if (p.tags?.includes('new-arrivals'))    imgArea.appendChild(el('span', { className: 'card-badge badge-new' }, 'NEW'));
    if (p.tags?.includes('limited-edition')) imgArea.appendChild(el('span', { className: 'card-badge badge-ltd' }, 'LIMITED'));
    if (p.compare_price > p.price)           imgArea.appendChild(el('span', { className: 'card-badge badge-sale', style: { top: '32px' } }, 'SALE'));

    const wishBtn = el('button', { className: 'wish-btn' + (inWish ? ' active' : ''), onClick: async e => {
      e.stopPropagation();
      if (!State.user) { navigate('/login'); return; }
      try {
        if (_homeState.wishlist.includes(p.id)) {
          await DEL('/api/wishlist/' + p.id);
          _homeState.wishlist = _homeState.wishlist.filter(x => x !== p.id);
          toast('Removed from wishlist');
        } else {
          await POST('/api/wishlist/' + p.id);
          _homeState.wishlist.push(p.id);
          toast('Added to wishlist ♥');
        }
        wishBtn.className = 'wish-btn' + (_homeState.wishlist.includes(p.id) ? ' active' : '');
        wishBtn.textContent = _homeState.wishlist.includes(p.id) ? '♥' : '♡';
      } catch { toast('Error'); }
    }}, inWish ? '♥' : '♡');
    imgArea.appendChild(wishBtn);

    return el('div', { className: 'card', onClick: () => navigate('/product/' + p.id) },
      imgArea,
      el('div', { className: 'card-info' },
        el('div', { className: 'card-name' }, p.title),
        el('div', {},
          el('span', { className: 'card-price' }, fmt(p.price)),
          p.compare_price > p.price ? el('span', { className: 'card-compare' }, fmt(p.compare_price)) : el('span', {})
        ),
        el('div', { className: 'card-rating' }, el('span', { style: { color: '#ffd600' } }, '★★★★★'), ' (4.8)'),
        el('button', { className: 'atc', onClick: e => {
          e.stopPropagation();
          addToCart(p, p.sizes?.[1] || p.sizes?.[0] || 'M', p.colors?.[0] || 'Black');
          toast(p.title + ' added to cart! 🛒');
        }}, 'ADD TO CART')
      )
    );
  }

  loadProducts('all');
  return wrap;
}

// ─── PRODUCT DETAIL ───────────────────────────────────────────────────────────
async function buildProductDetail(id) {
  const wrap = el('div', { className: 'page' });
  wrap.appendChild(el('div', { className: 'spinner' }, el('div', { className: 'spin' })));

  let product, selSize = 'M', selColor = 'Black', selImg = 0;
  try { product = await GET('/api/products/' + id); }
  catch { navigate('/'); return wrap; }

  selSize  = product.sizes?.[1]  || product.sizes?.[0]  || 'M';
  selColor = product.colors?.[0] || 'Black';
  const colorHex = { Black: '#111', White: '#f5f5f0', 'Teal Green': '#08f7f7', Carton: '#bb8e51' };

  function rebuild() {
    wrap.innerHTML = '';
    const mainImg = el('div', { className: 'gal-main' });
    if (product.images?.[selImg]) mainImg.appendChild(el('img', { src: product.images[selImg], alt: product.title }));
    else mainImg.appendChild(document.createTextNode('👕'));
    wrap.appendChild(mainImg);

    if (product.images?.length > 1) {
      const thumbs = el('div', { className: 'gal-thumbs' });
      product.images.forEach((img, i) => {
        thumbs.appendChild(el('img', { className: 'gal-thumb' + (selImg === i ? ' active' : ''), src: img, alt: '', onClick: () => { selImg = i; rebuild(); } }));
      });
      wrap.appendChild(thumbs);
    }

    const info = el('div', { className: 'pd-info' },
      el('h1', { className: 'pd-title' }, product.title),
      el('div', { className: 'pd-price' }, fmt(product.price))
    );
    if (product.compare_price > product.price) info.appendChild(el('div', { className: 'pd-compare' }, fmt(product.compare_price)));
    info.appendChild(el('div', { className: 'pd-stars' }, el('span', { style: { color: '#ffd600', fontSize: '14px' } }, '★★★★★'), el('span', { style: { fontSize: '12px', color: '#888' } }, ' (4.8)')));

    if (product.colors?.length) {
      info.appendChild(el('div', { className: 'pd-label' }, 'COLOUR — ', el('span', { style: { color: '#f5f5f0' } }, selColor)));
      const sw = el('div', { className: 'swatches' });
      product.colors.forEach(c => {
        sw.appendChild(el('button', { className: 'swatch' + (selColor === c ? ' active' : ''), style: { background: colorHex[c] || '#888' }, title: c, onClick: () => { selColor = c; rebuild(); } }));
      });
      info.appendChild(sw);
    }

    if (product.sizes?.length) {
      info.appendChild(el('div', { className: 'pd-label' }, 'SIZE — ', el('span', { style: { color: '#f5f5f0' } }, selSize)));
      const szRow = el('div', { className: 'sizes' });
      product.sizes.forEach(s => {
        szRow.appendChild(el('button', { className: 'sz-btn' + (selSize === s ? ' active' : ''), onClick: () => { selSize = s; rebuild(); } }, s));
      });
      info.appendChild(szRow);
    }

    info.appendChild(el('button', { className: 'pd-add', onClick: () => { addToCart(product, selSize, selColor); toast('Added to cart! 🛒'); } }, 'ADD TO CART'));
    info.appendChild(el('button', { className: 'pd-wish', onClick: () => { if (!State.user) navigate('/login'); } }, '♡ Add to Wishlist'));
    wrap.appendChild(info);

    if (product.description) {
      wrap.appendChild(el('div', { className: 'pd-desc' },
        el('div', { style: { fontFamily: 'Bebas Neue', fontSize: '16px', letterSpacing: '.1em', marginBottom: '8px', color: 'rgba(255,255,255,0.5)' } }, 'DESCRIPTION'),
        document.createTextNode(product.description)
      ));
    }
  }

  rebuild();
  return wrap;
}

// ─── AUTH PAGES ───────────────────────────────────────────────────────────────
function buildLogin() {
  let email = '', pw = '';
  const errEl = el('div', { className: 'auth-err', style: { display: 'none' } });
  const btn   = el('button', { className: 'auth-btn' }, 'SIGN IN');

  async function submit() {
    errEl.style.display = 'none';
    btn.textContent = 'SIGNING IN…'; btn.disabled = true;
    try {
      const data = await POST('/api/auth/login', { email, password: pw });
      localStorage.setItem('100th_token', data.token);
      State.user = data.user;
      navigate('/account');
    } catch (e) {
      errEl.textContent = '❌ ' + e.message;
      errEl.style.display = 'block';
    }
    btn.textContent = 'SIGN IN'; btn.disabled = false;
  }

  const emailInput = el('input', { className: 'finput', type: 'email', placeholder: 'your@email.com', onInput: e => email = e.target.value });
  const pwInput    = el('input', { className: 'finput', type: 'password', placeholder: 'Your password', onInput: e => pw = e.target.value });
  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  btn.addEventListener('click', submit);

  return el('div', { className: 'page' },
    el('div', { className: 'auth-page' },
      el('div', { className: 'auth-logo' }, '100', el('span', {}, 'TH')),
      el('div', { className: 'auth-card' },
        el('h1', { className: 'auth-title' }, 'Sign In'),
        el('p', { className: 'auth-sub' }, 'Welcome back! Sign in to track orders.'),
        errEl,
        el('div', { className: 'field' }, el('label', {}, 'EMAIL'), emailInput),
        el('div', { className: 'field' }, el('label', {}, 'PASSWORD'), pwInput),
        btn,
        el('div', { className: 'auth-div' }, el('span', {}, 'OR')),
        el('button', { className: 'auth-link-btn', onClick: () => navigate('/register') }, 'Create New Account')
      ),
      el('a', { href: '/', className: 'back-link', 'data-link': '' }, '← Back to store')
    )
  );
}

function buildRegister() {
  const form = { first_name: '', last_name: '', email: '', password: '', phone: '' };
  const errEl = el('div', { className: 'auth-err', style: { display: 'none' } });
  const btn   = el('button', { className: 'auth-btn' }, 'CREATE ACCOUNT');
  const set   = (k, v) => form[k] = v;

  async function submit() {
    errEl.style.display = 'none';
    btn.textContent = 'CREATING…'; btn.disabled = true;
    try {
      const data = await POST('/api/auth/register', form);
      localStorage.setItem('100th_token', data.token);
      State.user = data.user;
      navigate('/account');
    } catch (e) {
      errEl.textContent = '❌ ' + e.message;
      errEl.style.display = 'block';
    }
    btn.textContent = 'CREATE ACCOUNT'; btn.disabled = false;
  }
  btn.addEventListener('click', submit);

  return el('div', { className: 'page' },
    el('div', { className: 'auth-page' },
      el('div', { className: 'auth-logo' }, '100', el('span', {}, 'TH')),
      el('div', { className: 'auth-card' },
        el('h1', { className: 'auth-title' }, 'Create Account'),
        el('p', { className: 'auth-sub' }, 'Join 100TH — track orders & save favourites.'),
        errEl,
        el('div', { className: 'f-row' },
          el('div', { className: 'field' }, el('label', {}, 'FIRST NAME'), el('input', { className: 'finput', placeholder: 'First name', onInput: e => set('first_name', e.target.value) })),
          el('div', { className: 'field' }, el('label', {}, 'LAST NAME'), el('input', { className: 'finput', placeholder: 'Last name', onInput: e => set('last_name', e.target.value) }))
        ),
        el('div', { className: 'field' }, el('label', {}, 'EMAIL'), el('input', { className: 'finput', type: 'email', placeholder: 'your@email.com', onInput: e => set('email', e.target.value) })),
        el('div', { className: 'field' }, el('label', {}, 'PHONE'), el('input', { className: 'finput', type: 'tel', placeholder: '08012345678', onInput: e => set('phone', e.target.value) })),
        el('div', { className: 'field' }, el('label', {}, 'PASSWORD'), el('input', { className: 'finput', type: 'password', placeholder: 'Min. 8 characters', onInput: e => set('password', e.target.value) })),
        btn,
        el('div', { className: 'auth-div' }, el('span', {}, 'OR')),
        el('button', { className: 'auth-link-btn', onClick: () => navigate('/login') }, 'Sign In Instead')
      )
    )
  );
}

// ─── ACCOUNT PAGE ─────────────────────────────────────────────────────────────
async function buildAccount() {
  if (!State.user) { navigate('/login'); return el('div', {}); }
  const wrap = el('div', { className: 'page' });
  wrap.appendChild(el('div', { className: 'spinner' }, el('div', { className: 'spin' })));

  let orders = [], wishlist = [], activeTab = 'orders';
  try { [orders, wishlist] = await Promise.all([GET('/api/orders'), GET('/api/wishlist')]); }
  catch {}

  function rebuild() {
    wrap.innerHTML = '';
    const u = State.user;
    wrap.appendChild(el('div', { className: 'acct-hero' },
      el('div', { className: 'acct-av' }, (u.first_name?.[0] || 'U').toUpperCase()),
      el('div', {},
        el('div', { className: 'acct-name' }, u.first_name + ' ' + u.last_name),
        el('div', { className: 'acct-email' }, u.email)
      )
    ));

    wrap.appendChild(el('div', { className: 'stats' },
      ...[ ['ORDERS', orders.length], ['PAID', orders.filter(o => o.payment_status === 'paid').length], ['WISHLIST', wishlist.length] ]
        .map(([l, n]) => el('div', { className: 'stat' }, el('div', { className: 'stat-n' }, String(n)), el('div', { className: 'stat-l' }, l)))
    ));

    const tabBar = el('div', { className: 'tabs' });
    [['orders','📦 Orders'],['wishlist','♥ Wishlist'],['profile','👤 Profile']].forEach(([k, l]) => {
      tabBar.appendChild(el('button', { className: 'tab' + (activeTab === k ? ' active' : ''), onClick: () => { activeTab = k; rebuild(); } }, l));
    });
    wrap.appendChild(tabBar);

    // Orders panel
    const ordPanel = el('div', { className: 'panel' + (activeTab === 'orders' ? ' active' : '') });
    if (!orders.length) {
      ordPanel.appendChild(el('div', { className: 'empty' }, el('div', { className: 'empty-icon' }, '📦'), el('div', { className: 'empty-title' }, 'No orders yet'), el('div', { className: 'empty-sub' }, 'Your orders will appear here'), el('a', { href: '/', className: 'shop-btn', 'data-link': '' }, 'SHOP NOW')));
    } else {
      orders.forEach(o => {
        ordPanel.appendChild(el('div', { className: 'ord-card' },
          el('div', { className: 'ord-top' },
            el('div', {}, el('div', { className: 'ord-num' }, 'Order #' + o.order_ref), el('div', { className: 'ord-date' }, new Date(o.created_at).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }))),
            el('div', { className: 'ord-status' }, o.payment_status === 'paid' ? '✅ Paid' : '⏳ Pending')
          ),
          el('div', { className: 'ord-foot' }, el('div', { className: 'ord-total' }, 'Total: ', el('strong', {}, fmt(o.total))))
        ));
      });
    }
    wrap.appendChild(ordPanel);

    // Wishlist panel
    const wlPanel = el('div', { className: 'panel' + (activeTab === 'wishlist' ? ' active' : '') });
    if (!wishlist.length) {
      wlPanel.appendChild(el('div', { className: 'empty' }, el('div', { className: 'empty-icon' }, '♥'), el('div', { className: 'empty-title' }, 'Wishlist is empty'), el('div', { className: 'empty-sub' }, 'Tap ♡ on any product to save it'), el('a', { href: '/', className: 'shop-btn', 'data-link': '' }, 'BROWSE')));
    } else {
      wishlist.forEach(p => {
        const row = el('div', { style: { display:'flex', gap:'12px', padding:'12px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', marginBottom:'10px' } });
        if (p.images?.[0]) row.appendChild(el('img', { src: p.images[0], style: { width:'80px', height:'80px', objectFit:'cover' } }));
        else row.appendChild(el('div', { style: { width:'80px', height:'80px', background:'rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'28px' } }, '👕'));
        row.appendChild(el('div', { style: { flex:'1' } },
          el('div', { style: { fontSize:'13px', marginBottom:'4px' } }, p.title),
          el('div', { style: { fontSize:'14px', fontWeight:'700', color:'#08f7f7', marginBottom:'8px' } }, fmt(p.price)),
          el('div', { style: { display:'flex', gap:'8px' } },
            el('button', { style: { padding:'6px 14px', background:'#08f7f7', color:'#000', fontSize:'11px', fontWeight:'600' }, onClick: () => navigate('/product/' + p.id) }, 'View'),
            el('button', { style: { padding:'6px 14px', background:'transparent', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.4)', fontSize:'11px' }, onClick: async () => {
              await DEL('/api/wishlist/' + p.id);
              wishlist = wishlist.filter(x => x.id !== p.id);
              rebuild();
            }}, 'Remove')
          )
        ));
        wlPanel.appendChild(row);
      });
    }
    wrap.appendChild(wlPanel);

    // Profile panel
    const profPanel = el('div', { className: 'panel' + (activeTab === 'profile' ? ' active' : '') });
    const u2 = State.user;
    profPanel.appendChild(el('div', { className: 'prof-card' },
      ...[ ['Full Name', u2.first_name + ' ' + u2.last_name], ['Email', u2.email], ['Phone', u2.phone || 'Not set'] ]
        .map(([k, v]) => el('div', { className: 'prof-row' }, el('span', { className: 'prof-key' }, k), el('span', {}, v)))
    ));
    profPanel.appendChild(el('button', { className: 'logout-btn', onClick: () => {
      localStorage.removeItem('100th_token');
      State.user = null;
      navigate('/');
    }}, 'Sign Out'));
    wrap.appendChild(profPanel);
  }

  rebuild();
  return wrap;
}

// ─── CART PAGE ────────────────────────────────────────────────────────────────
function buildCart() {
  const wrap = el('div', { className: 'page' });

  function rebuild() {
    wrap.innerHTML = '';
    const page = el('div', { className: 'cart-page' });
    if (!State.cart.length) {
      page.appendChild(el('div', { className: 'empty' }, el('div', { className: 'empty-icon' }, '🛒'), el('div', { className: 'empty-title' }, 'Your cart is empty'), el('div', { className: 'empty-sub' }, 'Add some products to get started'), el('a', { href: '/', className: 'shop-btn', 'data-link': '' }, 'SHOP NOW')));
      wrap.appendChild(page);
      return;
    }

    page.appendChild(el('h1', { className: 'cart-title' }, 'MY CART (' + State.cart.length + ')'));
    State.cart.forEach(item => {
      const row = el('div', { className: 'cart-item' });
      if (item.product.images?.[0]) row.appendChild(el('img', { className: 'cart-img', src: item.product.images[0], alt: item.product.title }));
      else row.appendChild(el('div', { className: 'cart-img-ph' }, '👕'));
      const priceEl = el('div', { className: 'cart-price' }, fmt(item.price * item.quantity));
      const qtyEl   = el('span', { className: 'qty-n' }, String(item.quantity));
      row.appendChild(el('div', { className: 'cart-info' },
        el('div', { className: 'cart-name' }, item.product.title),
        el('div', { className: 'cart-meta' }, item.color + ' · Size ' + item.size),
        priceEl,
        el('div', { className: 'qty-row' },
          el('button', { className: 'qty-btn', onClick: () => { updateQty(item.key, item.quantity - 1); rebuild(); } }, '−'),
          qtyEl,
          el('button', { className: 'qty-btn', onClick: () => { updateQty(item.key, item.quantity + 1); rebuild(); } }, '+'),
          el('button', { className: 'rm-btn', onClick: () => { removeFromCart(item.key); rebuild(); } }, 'Remove')
        )
      ));
      page.appendChild(row);
    });

    page.appendChild(el('div', { className: 'summary' },
      el('div', { className: 'sum-row' }, el('span', {}, 'Subtotal'), el('span', {}, fmt(cartTotal()))),
      el('div', { className: 'sum-row' }, el('span', {}, 'Delivery'), el('span', {}, 'Calculated at checkout')),
      el('div', { className: 'sum-total' }, el('span', {}, 'Total'), el('span', { style: { color: '#08f7f7' } }, fmt(cartTotal()))),
      el('button', { className: 'chk-btn', onClick: () => navigate('/checkout') }, 'PROCEED TO CHECKOUT')
    ));
    wrap.appendChild(page);
  }

  rebuild();
  return wrap;
}

// ─── CHECKOUT PAGE ────────────────────────────────────────────────────────────
async function buildCheckout() {
  if (!State.user) { navigate('/login'); return el('div', {}); }
  const wrap = el('div', { className: 'page' });
  const STATES = ['Lagos','Abuja','Kano','Ibadan','Ogun','Oyo','Rivers','Kaduna','Enugu','Delta','Edo','Imo','Others'];
  const addr = { full_name:'', email: State.user?.email||'', phone: State.user?.phone||'', address:'', city:'', state:'Lagos' };
  let fee = 1200, payMethod = 'paystack';

  const feeEl = el('div', { className: 'deliv-info' });
  const btn   = el('button', { className: 'pay-btn' }, 'PAY ' + fmt(cartTotal() + fee));

  function updateFee(state) {
    POST('/api/delivery/estimate', { state }).then(r => {
      fee = r.fee;
      feeEl.innerHTML = '🚚 Delivery fee: <strong>' + fmt(fee) + '</strong> · ' + r.estimated_days + ' days';
      btn.textContent = 'PAY ' + fmt(cartTotal() + fee);
    }).catch(() => {});
  }
  updateFee('Lagos');
  feeEl.textContent = '🚚 Delivery fee: ₦1,200 · 1-2 days';

  async function placeOrder() {
    if (!addr.full_name || !addr.address || !addr.phone) { alert('Please fill in all delivery details'); return; }
    btn.textContent = 'PROCESSING…'; btn.disabled = true;
    try {
      const items = State.cart.map(i => ({ product: i.product, size: i.size, color: i.color, quantity: i.quantity, price: i.price }));
      const order = await POST('/api/orders', { items, delivery_address: addr, delivery_fee: fee });
      const payRes = await POST('/api/payment/paystack/init', { amount: cartTotal() + fee, email: addr.email || State.user.email, order_ref: order.order_ref, callback_url: location.origin + '/order-success?ref=' + order.order_ref });
      if (payRes.data?.authorization_url) {
        State.cart = []; saveCart();
        location.href = payRes.data.authorization_url;
      }
    } catch (e) { alert('Error: ' + e.message); }
    btn.textContent = 'PAY ' + fmt(cartTotal() + fee); btn.disabled = false;
  }
  btn.addEventListener('click', placeOrder);

  const stateSelect = el('select', { className: 'finput', onChange: e => { addr.state = e.target.value; updateFee(e.target.value); } });
  STATES.forEach(s => { const o = el('option', {}, s); if (s === 'Lagos') o.selected = true; stateSelect.appendChild(o); });

  const page = el('div', { className: 'chk-page' },
    el('h1', { className: 'chk-title' }, 'CHECKOUT'),
    el('div', { className: 'sec-t' }, 'DELIVERY DETAILS'),
    el('div', { className: 'field' }, el('label', {}, 'FULL NAME'), el('input', { className: 'finput', placeholder: 'John Doe', onInput: e => addr.full_name = e.target.value })),
    el('div', { className: 'f-row' },
      el('div', { className: 'field' }, el('label', {}, 'PHONE'), el('input', { className: 'finput', type: 'tel', placeholder: '08012345678', value: addr.phone, onInput: e => addr.phone = e.target.value })),
      el('div', { className: 'field' }, el('label', {}, 'EMAIL'), el('input', { className: 'finput', type: 'email', value: addr.email, onInput: e => addr.email = e.target.value }))
    ),
    el('div', { className: 'field' }, el('label', {}, 'ADDRESS'), el('input', { className: 'finput', placeholder: 'House number, street name', onInput: e => addr.address = e.target.value })),
    el('div', { className: 'f-row' },
      el('div', { className: 'field' }, el('label', {}, 'CITY'), el('input', { className: 'finput', placeholder: 'Lagos', onInput: e => addr.city = e.target.value })),
      el('div', { className: 'field' }, el('label', {}, 'STATE'), stateSelect)
    ),
    feeEl,
    el('div', { className: 'sec-t' }, 'PAYMENT'),
    el('div', { className: 'pay-methods' },
      el('div', { className: 'pay-method sel' },
        el('input', { type: 'radio', checked: 'true' }),
        el('div', {}, el('div', { className: 'pay-name' }, '💳 Paystack'), el('div', { className: 'pay-sub' }, 'Card, bank transfer, USSD'))
      )
    ),
    el('div', { className: 'summary', style: { marginBottom: '16px' } },
      ...State.cart.map(item => el('div', { className: 'sum-row' }, el('span', {}, item.product.title + ' × ' + item.quantity), el('span', {}, fmt(item.price * item.quantity)))),
      el('div', { className: 'sum-row' }, el('span', {}, 'Delivery'), el('span', {}, fmt(fee))),
      el('div', { className: 'sum-total' }, el('span', {}, 'Total'), el('span', { style: { color: '#08f7f7' } }, fmt(cartTotal() + fee)))
    ),
    btn
  );
  wrap.appendChild(page);
  return wrap;
}

// ─── ORDER SUCCESS PAGE ───────────────────────────────────────────────────────
function buildOrderSuccess() {
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref');
  const paystackRef = params.get('reference') || params.get('trxref');
  if (paystackRef) GET('/api/payment/paystack/verify/' + paystackRef).catch(() => {});

  return el('div', { className: 'page' },
    el('div', { className: 'success-page' },
      el('div', { className: 'success-icon' }, '🎉'),
      el('h1', { className: 'success-title' }, 'ORDER PLACED!'),
      el('p', { className: 'success-sub' }, 'Thank you for shopping with 100TH! Your order is confirmed.'),
      ref ? el('div', { className: 'success-ref' }, 'Order: ', el('strong', {}, ref)) : el('span', {}),
      el('a', { href: '/account', className: 'shop-btn', 'data-link': '' }, 'VIEW MY ORDERS')
    )
  );
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function buildFooter() {
  return el('footer', {},
    el('div', { className: 'foot-brand' }, '100', el('span', {}, 'TH')),
    el('div', { style: { fontSize: '12px', color: '#888', marginBottom: '16px' } }, 'Dress Like It Matters'),
    el('div', { className: 'foot-links' },
      el('a', { href: '/account', 'data-link': '' }, 'My Account'),
      el('a', { href: '/account', 'data-link': '' }, 'Orders'),
      el('a', { href: 'mailto:hundredsdotshop@gmail.com' }, 'Contact')
    ),
    el('div', { className: 'foot-copy' }, '© 2026 100TH Store')
  );
}

// ─── ADMIN MODAL ──────────────────────────────────────────────────────────────
const COLORS = [{ key:'black', label:'Black', hex:'#111' },{ key:'white', label:'White', hex:'#f5f5f0' },{ key:'teal', label:'Teal Green', hex:'#08f7f7' },{ key:'carton', label:'Carton', hex:'#bb8e51' }];
const SIZES  = ['XS','S','M','L','XL','XXL'];
const TAGS   = ['new-arrivals','limited-edition','best-picks','t-shirts','sale'];

function openAdminModal() {
  const ov = el('div', { className: 'modal-ov', onClick: () => ov.remove() });
  const sheet = el('div', { className: 'modal-sheet', onClick: e => e.stopPropagation() });
  ov.appendChild(sheet);
  document.body.appendChild(ov);

  let tab = 0;
  let title = '', price = '', compare = '', desc = '';
  let selTags = [], selSizes = ['S','M','L','XL'];
  let photos = Array(8).fill(null), colorImgs = {};
  let publishing = false;

  const mtabs = el('div', { className: 'mtabs' });
  const mbody = el('div', { className: 'mbody' });

  function switchTab(i) {
    tab = i;
    [...mtabs.children].forEach((b, j) => b.classList.toggle('active', j === i));
    [...mbody.children].forEach((p, j) => p.classList.toggle('active', j === i));
  }

  ['📋 Details','🖼 Photos','🎨 Colours','🚀 Publish'].forEach((t, i) => {
    const b = el('button', { className: 'mtab' + (i === 0 ? ' active' : ''), onClick: () => switchTab(i) }, t);
    mtabs.appendChild(b);
  });

  // Header
  sheet.appendChild(el('div', { className: 'modal-hdr' },
    el('div', { style: { display:'flex', alignItems:'center', gap:'10px' } },
      el('div', { style: { width:'32px', height:'32px', background:'#08f7f7', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'700', fontSize:'18px' } }, '＋'),
      el('div', {}, el('div', { className: 'modal-title' }, 'ADD PRODUCT'), el('div', { style: { fontSize:'10px', color:'rgba(255,255,255,0.4)' } }, 'Upload → Goes live instantly'))
    ),
    el('button', { className: 'modal-close', onClick: () => ov.remove() }, '✕')
  ));
  sheet.appendChild(mtabs);
  sheet.appendChild(mbody);

  // ── Tab 0: Details ──
  const tagRow = el('div', { className: 'tag-row' });
  TAGS.forEach(t => {
    const b = el('button', { className: 'tag-btn' + (selTags.includes(t) ? ' on' : ''), onClick: () => {
      selTags = selTags.includes(t) ? selTags.filter(x => x !== t) : [...selTags, t];
      b.className = 'tag-btn' + (selTags.includes(t) ? ' on' : '');
    }}, t);
    tagRow.appendChild(b);
  });
  const szRow = el('div', { className: 'sz-row' });
  SIZES.forEach(s => {
    const b = el('button', { className: 'sz-tog' + (selSizes.includes(s) ? ' on' : ''), onClick: () => {
      selSizes = selSizes.includes(s) ? selSizes.filter(x => x !== s) : [...selSizes, s];
      b.className = 'sz-tog' + (selSizes.includes(s) ? ' on' : '');
    }}, s);
    szRow.appendChild(b);
  });
  const titleIn   = el('input', { className: 'finput', placeholder: 'e.g. Classic 100TH Tee', onInput: e => title = e.target.value });
  const priceIn   = el('input', { className: 'finput', type: 'number', placeholder: '8500', onInput: e => price = e.target.value });
  const compareIn = el('input', { className: 'finput', type: 'number', placeholder: '14000', onInput: e => compare = e.target.value });
  const descIn    = el('textarea', { className: 'finput', rows: '3', placeholder: 'Premium quality...', onInput: e => desc = e.target.value });

  const p0 = el('div', { className: 'mpanel active' },
    el('div', { className: 'field' }, el('label', { className: 'flabel' }, 'Product Title *'), titleIn),
    el('div', { style: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' } },
      el('div', { className: 'field' }, el('label', { className: 'flabel' }, 'Price (₦) *'), priceIn),
      el('div', { className: 'field' }, el('label', { className: 'flabel' }, 'Compare-at Price'), compareIn)
    ),
    el('div', { className: 'field' }, el('label', { className: 'flabel' }, 'Description'), descIn),
    el('div', { className: 'field' }, el('label', { className: 'flabel' }, 'Tags'), tagRow),
    el('div', { className: 'field' }, el('label', { className: 'flabel' }, 'Sizes'), szRow),
    el('button', { className: 'next-btn', onClick: () => switchTab(1) }, 'Next: Photos →')
  );

  // ── Tab 1: Photos ──
  const photoGrid = el('div', { className: 'photo-grid' });
  photos.forEach((_, i) => {
    const slot = el('div', { className: 'photo-slot' }, i === 0 ? '⭐' : '＋');
    slot.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(f); });
        photos[i] = { dataUrl, name: f.name };
        slot.innerHTML = '';
        const img = document.createElement('img');
        img.src = dataUrl; slot.appendChild(img);
      };
      inp.click();
    });
    photoGrid.appendChild(slot);
  });
  const p1 = el('div', { className: 'mpanel' },
    el('p', { className: 'hint' }, 'Upload up to 8 photos. First = cover image.'),
    photoGrid,
    el('button', { className: 'next-btn', onClick: () => switchTab(2) }, 'Next: Colour Images →')
  );

  // ── Tab 2: Colours ──
  const colGrid = el('div', { className: 'col-grid' });
  COLORS.forEach(c => {
    const zone = el('div', { className: 'col-zone' }, '＋');
    zone.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(f); });
        colorImgs[c.key] = { dataUrl, name: f.name };
        zone.innerHTML = '';
        const img = document.createElement('img');
        img.src = dataUrl; zone.appendChild(img);
      };
      inp.click();
    });
    colGrid.appendChild(el('div', { className: 'col-card' },
      el('div', { className: 'col-dot', style: { background: c.hex } }),
      el('div', { className: 'col-lbl' }, c.label),
      zone
    ));
  });
  const p2 = el('div', { className: 'mpanel' },
    el('p', { className: 'hint' }, 'Upload image for each colour variant.'),
    colGrid,
    el('button', { className: 'next-btn', onClick: () => switchTab(3) }, 'Next: Publish →')
  );

  // ── Tab 3: Publish ──
  const pubBtn = el('button', { className: 'pub-btn' }, '🚀 PUBLISH LIVE TO YOUR STORE');
  pubBtn.addEventListener('click', async () => {
    if (!title || !price) { toast('Fill in title and price!'); return; }
    pubBtn.textContent = 'PUBLISHING…'; pubBtn.disabled = true;
    try {
      const uploadedPhotos = [];
      for (const p of photos) {
        if (!p) continue;
        const r = await POST('/api/upload', { image: p.dataUrl, folder: '100th-products' });
        uploadedPhotos.push(r.url);
      }
      const uploadedColorImgs = {};
      for (const [key, ci] of Object.entries(colorImgs)) {
        const r = await POST('/api/upload', { image: ci.dataUrl, folder: '100th-colors' });
        uploadedColorImgs[key] = r.url;
      }
      await POST('/api/products', { title, description: desc, price: parseFloat(price), compare_price: compare ? parseFloat(compare) : null, tags: selTags, sizes: selSizes, colors: COLORS.map(c => c.label), images: uploadedPhotos, color_images: uploadedColorImgs });
      toast('✅ ' + title + ' is now live!');
      ov.remove();
      navigate('/');
    } catch (e) { toast('Error: ' + e.message); }
    pubBtn.textContent = '🚀 PUBLISH LIVE TO YOUR STORE'; pubBtn.disabled = false;
  });

  const sumBox = el('div', { className: 'sum-box' });
  function updateSummary() {
    sumBox.innerHTML = '';
    [['Title', title||'—'],['Price', price ? '₦'+price+(compare?' (was ₦'+compare+')':'') : '—'],['Sizes', selSizes.join(', ')||'—'],['Tags', selTags.join(', ')||'none'],['Photos', photos.filter(Boolean).length+' uploaded'],['Colour images', Object.keys(colorImgs).join(', ')||'none']].forEach(([k,v]) => {
      sumBox.appendChild(el('div', { className: 'sum-row2' }, el('span', { className: 'sum-k' }, k), el('span', {}, v)));
    });
  }
  updateSummary();
  const p3 = el('div', { className: 'mpanel' }, sumBox, pubBtn);
  p3.addEventListener('mouseenter', updateSummary);

  mbody.appendChild(p0);
  mbody.appendChild(p1);
  mbody.appendChild(p2);
  mbody.appendChild(p3);
}

// ─── RENDER ENGINE ────────────────────────────────────────────────────────────
async function render() {
  clearInterval(_bannerInterval);
  clearInterval(_timerInterval);

  const appEl = document.getElementById('app');
  appEl.innerHTML = '';

  // Header (always present)
  appEl.appendChild(buildHeader());
  updateCartBadge();

  const path = location.pathname;
  const idMatch = path.match(/^\\/product\\/([^/]+)$/);
  let content;

  if (path === '/')                     content = await buildHome();
  else if (idMatch)                     content = await buildProductDetail(idMatch[1]);
  else if (path === '/login')           content = buildLogin();
  else if (path === '/register')        content = buildRegister();
  else if (path === '/account')         content = await buildAccount();
  else if (path === '/cart')            content = buildCart();
  else if (path === '/checkout')        content = await buildCheckout();
  else if (path === '/order-success')   content = buildOrderSuccess();
  else { content = el('div', { className: 'empty', style: { marginTop: '60px' } }, el('div', { className: 'empty-icon' }, '🔍'), el('div', { className: 'empty-title' }, '404 — Page not found'), el('a', { href: '/', 'data-link': '', className: 'shop-btn', style: { marginTop: '16px' } }, 'HOME')); }

  appEl.appendChild(content);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
async function boot() {
  const token = localStorage.getItem('100th_token');
  if (token) {
    try {
      State.user = await GET('/api/auth/me');
    } catch {
      localStorage.removeItem('100th_token');
    }
  }
  render();
}

boot();
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  await initDB();
  console.log('100TH Store running on port ' + PORT);
});
