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

// SERVE FRONTEND - inline HTML app
app.get('*',(req,res)=>{
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#060606"/>
<title>100TH Store — Dress Like It Matters</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/react-router-dom@6/dist/umd/react-router-dom.production.min.js"></script>
<script src="https://unpkg.com/axios/dist/axios.min.js"></script>
<style>
:root{--black:#060606;--white:#f5f5f0;--accent:#08f7f7;--red:#e53935;--grey:#1a1a1a;--grey-mid:#888;--font-display:'Bebas Neue',sans-serif;--font-body:'Inter',sans-serif;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--black);color:var(--white);font-family:var(--font-body);}
a{text-decoration:none;color:inherit;}
button{cursor:pointer;font-family:var(--font-body);}
.ann{background:var(--accent);color:#000;text-align:center;padding:7px;font-size:12px;font-weight:600;}
.header{position:sticky;top:0;z-index:9000;background:var(--black);border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;padding:0 14px;height:54px;}
.logo{font-family:var(--font-display);font-size:26px;letter-spacing:0.1em;}
.logo span{color:var(--accent);}
.header-right{display:flex;align-items:center;gap:6px;}
.hbtn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 8px;color:rgba(255,255,255,0.7);font-size:10px;background:none;border:none;position:relative;}
.hbtn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;}
.badge{position:absolute;top:2px;right:2px;background:var(--red);color:#fff;font-size:9px;font-weight:700;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;}
.admin-btn{background:var(--accent);color:#000;border:none;padding:7px 12px;font-family:var(--font-display);font-size:14px;letter-spacing:0.1em;}
.cat-strip{display:flex;gap:8px;overflow-x:auto;padding:10px 14px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05);scrollbar-width:none;}
.cat-strip::-webkit-scrollbar{display:none;}
.cat-pill{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);font-size:11px;white-space:nowrap;flex-shrink:0;border-radius:8px;}
.cat-pill.active{background:rgba(8,247,247,0.1);border-color:var(--accent);color:var(--accent);}
.flash{display:flex;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(90deg,#b71c1c,#e53935);}
.flash-title{font-family:var(--font-display);font-size:16px;letter-spacing:0.1em;}
.flash-timer{font-family:monospace;font-size:16px;font-weight:700;background:rgba(0,0,0,0.3);padding:4px 10px;border-radius:4px;flex-shrink:0;}
.flash-cta{font-size:11px;font-weight:700;color:#fff;padding:6px 12px;background:rgba(0,0,0,0.3);border-radius:4px;white-space:nowrap;border:none;}
.banner{position:relative;overflow:hidden;height:220px;background:#0a0a0a;display:flex;align-items:center;padding:0 24px;}
.banner-content{z-index:1;}
.banner-eye{font-size:11px;color:var(--accent);letter-spacing:0.15em;margin-bottom:6px;}
.banner-h{font-family:var(--font-display);font-size:42px;line-height:0.95;margin-bottom:10px;}
.banner-sub{font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:14px;}
.banner-cta{padding:10px 20px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:14px;letter-spacing:0.1em;border:none;}
.section{padding:16px 0;}
.sec-header{display:flex;align-items:center;justify-content:space-between;padding:0 14px 12px;}
.sec-title{font-family:var(--font-display);font-size:22px;letter-spacing:0.1em;}
.sec-link{font-size:12px;color:var(--accent);background:none;border:none;}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:0 10px;}
.card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;cursor:pointer;}
.card-img{position:relative;aspect-ratio:1;overflow:hidden;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;font-size:48px;}
.card-img img{width:100%;height:100%;object-fit:cover;}
.card-badge{position:absolute;top:8px;left:8px;font-size:9px;font-weight:700;padding:3px 7px;}
.badge-new{background:var(--accent);color:#000;}
.badge-sale{background:var(--red);color:#fff;}
.badge-ltd{background:#ff6f00;color:#fff;}
.wish-btn{position:absolute;top:8px;right:8px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,0.5);border:none;color:#fff;font-size:14px;}
.wish-btn.active{background:var(--red);}
.card-info{padding:10px;}
.card-name{font-size:12px;margin-bottom:4px;line-height:1.3;}
.card-price{font-size:14px;font-weight:700;color:var(--accent);margin-bottom:4px;}
.card-compare{font-size:11px;color:var(--grey-mid);text-decoration:line-through;margin-left:6px;}
.card-rating{font-size:11px;margin-bottom:8px;}
.atc{width:100%;padding:9px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:13px;letter-spacing:0.08em;border:none;}
.spinner{display:flex;align-items:center;justify-content:center;padding:40px;}
.spin{width:32px;height:32px;border:3px solid rgba(8,247,247,0.2);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(8,247,247,0.15);border:1px solid var(--accent);color:var(--accent);padding:10px 20px;font-size:13px;z-index:99999;white-space:nowrap;opacity:0;transition:opacity .3s;pointer-events:none;border-radius:4px;}
.toast.show{opacity:1;}
.auth-page{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;}
.auth-logo{font-family:var(--font-display);font-size:32px;letter-spacing:0.15em;margin-bottom:24px;}
.auth-logo span{color:var(--accent);}
.auth-card{width:100%;max-width:400px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);padding:28px 24px;}
.auth-title{font-family:var(--font-display);font-size:24px;letter-spacing:0.1em;margin-bottom:6px;}
.auth-sub{font-size:13px;color:var(--grey-mid);margin-bottom:22px;}
.auth-err{background:rgba(229,57,53,0.1);border:1px solid rgba(229,57,53,0.3);color:#ef9a9a;padding:10px;font-size:12px;margin-bottom:14px;}
.field{margin-bottom:14px;}
.field label{display:block;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:0.08em;margin-bottom:6px;}
.field input,.field select,.field textarea{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:var(--white);padding:11px 12px;font-size:14px;font-family:var(--font-body);outline:none;box-sizing:border-box;}
.field input:focus{border-color:var(--accent);}
.auth-btn{width:100%;padding:14px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:16px;letter-spacing:0.12em;border:none;margin-top:6px;}
.auth-div{text-align:center;margin:16px 0;position:relative;}
.auth-div::before{content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(255,255,255,0.08);}
.auth-div span{background:rgba(255,255,255,0.03);padding:0 12px;font-size:11px;color:rgba(255,255,255,0.3);position:relative;}
.auth-link-btn{display:block;text-align:center;padding:12px;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);font-size:13px;background:none;width:100%;}
.acct{padding-bottom:40px;max-width:600px;margin:0 auto;}
.acct-hero{display:flex;align-items:center;gap:14px;padding:20px 14px;background:linear-gradient(135deg,rgba(8,247,247,0.08),transparent);}
.acct-av{width:54px;height:54px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:24px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.acct-name{font-family:var(--font-display);font-size:20px;letter-spacing:0.08em;}
.acct-email{font-size:12px;color:var(--grey-mid);margin-top:2px;}
.stats{display:flex;background:rgba(255,255,255,0.03);}
.stat{flex:1;text-align:center;padding:14px 8px;}
.stat-n{font-family:var(--font-display);font-size:24px;color:var(--accent);}
.stat-l{font-size:10px;color:var(--grey-mid);letter-spacing:0.06em;}
.tabs{display:flex;border-bottom:1px solid rgba(255,255,255,0.08);}
.tab{flex:1;padding:13px;font-size:12px;background:none;border:none;color:rgba(255,255,255,0.4);}
.tab.active{color:var(--accent);border-bottom:2px solid var(--accent);margin-bottom:-1px;}
.panel{display:none;padding:16px 14px;}
.panel.active{display:block;}
.ord-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);margin-bottom:12px;}
.ord-top{display:flex;justify-content:space-between;align-items:flex-start;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);}
.ord-num{font-size:13px;font-weight:600;}
.ord-date{font-size:11px;color:var(--grey-mid);}
.ord-status{font-size:11px;padding:4px 10px;border-radius:20px;background:rgba(8,247,247,0.1);color:var(--accent);}
.ord-foot{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-top:1px solid rgba(255,255,255,0.06);}
.ord-total{font-size:13px;}
.empty{text-align:center;padding:40px 20px;}
.empty-icon{font-size:40px;margin-bottom:12px;}
.empty-title{font-size:16px;font-weight:600;margin-bottom:6px;}
.empty-sub{font-size:13px;color:var(--grey-mid);margin-bottom:20px;}
.shop-btn{display:inline-block;padding:12px 28px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:14px;letter-spacing:0.1em;}
.logout-btn{width:100%;padding:13px;background:transparent;border:1px solid rgba(229,57,53,0.3);color:#ef9a9a;font-size:13px;}
.prof-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);margin-bottom:16px;}
.prof-row{display:flex;justify-content:space-between;padding:13px 14px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px;}
.prof-key{color:rgba(255,255,255,0.4);font-size:12px;}
.cart-page{padding:16px 14px;max-width:600px;margin:0 auto;}
.cart-title{font-family:var(--font-display);font-size:28px;letter-spacing:0.1em;margin-bottom:16px;}
.cart-item{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);}
.cart-img{width:80px;height:80px;object-fit:cover;flex-shrink:0;}
.cart-img-ph{width:80px;height:80px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;}
.cart-info{flex:1;}
.cart-name{font-size:13px;margin-bottom:4px;}
.cart-meta{font-size:11px;color:var(--grey-mid);margin-bottom:8px;}
.cart-price{font-size:14px;font-weight:700;color:var(--accent);}
.qty-row{display:flex;align-items:center;gap:10px;margin-top:8px;}
.qty-btn{width:28px;height:28px;background:rgba(255,255,255,0.08);border:none;color:var(--white);font-size:16px;}
.qty-n{font-size:14px;min-width:20px;text-align:center;}
.rm-btn{background:none;border:none;color:var(--grey-mid);font-size:11px;margin-left:auto;}
.summary{margin-top:16px;padding:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);}
.sum-row{display:flex;justify-content:space-between;font-size:13px;padding:6px 0;}
.sum-total{display:flex;justify-content:space-between;font-size:16px;font-weight:700;padding:10px 0;border-top:1px solid rgba(255,255,255,0.1);margin-top:6px;}
.chk-btn{width:100%;padding:15px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:18px;letter-spacing:0.12em;border:none;margin-top:14px;}
.chk-page{padding:16px 14px;max-width:600px;margin:0 auto 40px;}
.chk-title{font-family:var(--font-display);font-size:28px;letter-spacing:0.1em;margin-bottom:16px;}
.sec-t{font-size:13px;color:var(--accent);letter-spacing:0.1em;margin-bottom:12px;border-bottom:1px solid rgba(8,247,247,0.2);padding-bottom:6px;}
.f-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.deliv-info{background:rgba(8,247,247,0.06);border:1px solid rgba(8,247,247,0.2);padding:12px;font-size:12px;color:var(--accent);margin-bottom:14px;}
.pay-methods{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;}
.pay-method{display:flex;align-items:center;gap:12px;padding:13px;border:1px solid rgba(255,255,255,0.1);cursor:pointer;}
.pay-method.sel{border-color:var(--accent);background:rgba(8,247,247,0.05);}
.pay-name{font-size:13px;font-weight:600;}
.pay-sub{font-size:11px;color:var(--grey-mid);}
.pay-btn{width:100%;padding:15px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:18px;letter-spacing:0.12em;border:none;}
.pd-page{padding-bottom:40px;}
.gal-main{aspect-ratio:1;overflow:hidden;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;font-size:80px;}
.gal-main img{width:100%;height:100%;object-fit:cover;}
.gal-thumbs{display:flex;gap:8px;padding:8px 14px;overflow-x:auto;}
.gal-thumb{width:60px;height:60px;object-fit:cover;border:2px solid transparent;flex-shrink:0;cursor:pointer;}
.gal-thumb.active{border-color:var(--accent);}
.pd-info{padding:16px 14px;}
.pd-title{font-family:var(--font-display);font-size:26px;letter-spacing:0.08em;margin-bottom:8px;}
.pd-price{font-size:24px;font-weight:700;color:var(--accent);margin-bottom:12px;}
.pd-label{font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:0.1em;margin-bottom:8px;}
.swatches{display:flex;gap:8px;margin-bottom:16px;}
.swatch{width:28px;height:28px;border-radius:50%;border:2px solid transparent;cursor:pointer;}
.swatch.active{border-color:var(--white);}
.sizes{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
.sz-btn{width:44px;height:36px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);font-size:12px;}
.sz-btn.active{background:rgba(8,247,247,0.15);border-color:var(--accent);color:var(--accent);}
.pd-add{width:100%;padding:15px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:18px;letter-spacing:0.12em;border:none;margin-bottom:10px;}
.pd-wish{width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);font-size:14px;}
.pd-desc{padding:16px 14px;border-top:1px solid rgba(255,255,255,0.06);font-size:13px;color:rgba(255,255,255,0.65);line-height:1.7;}
.success-page{min-height:80vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px 20px;text-align:center;}
.success-icon{font-size:64px;margin-bottom:16px;}
.success-title{font-family:var(--font-display);font-size:28px;color:var(--accent);margin-bottom:8px;}
.success-sub{font-size:14px;color:var(--grey-mid);margin-bottom:24px;line-height:1.6;}
.success-ref{background:rgba(8,247,247,0.08);border:1px solid rgba(8,247,247,0.2);padding:12px 20px;font-size:14px;color:var(--accent);margin-bottom:24px;}
.modal-ov{position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:flex-end;}
.modal-sheet{width:100%;background:var(--black);border-top:1px solid rgba(255,255,255,0.1);max-height:92vh;overflow-y:auto;}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.08);}
.modal-title{font-family:var(--font-display);font-size:20px;letter-spacing:0.12em;}
.modal-close{background:none;border:none;color:var(--grey-mid);font-size:20px;}
.mtabs{display:flex;border-bottom:1px solid rgba(255,255,255,0.08);overflow-x:auto;}
.mtab{flex:1;min-width:70px;padding:11px 6px;font-size:11px;background:none;border:none;color:rgba(255,255,255,0.4);white-space:nowrap;}
.mtab.active{color:var(--accent);border-bottom:2px solid var(--accent);margin-bottom:-1px;}
.mbody{padding:18px;}
.mpanel{display:none;}
.mpanel.active{display:block;}
.flabel{display:block;font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:0.08em;margin-bottom:6px;}
.finput{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:var(--white);padding:10px 12px;font-size:13px;font-family:var(--font-body);outline:none;box-sizing:border-box;}
.finput:focus{border-color:var(--accent);}
.tag-row{display:flex;flex-wrap:wrap;gap:6px;}
.tag-btn{padding:5px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);font-size:11px;}
.tag-btn.active{background:rgba(8,247,247,0.12);border-color:var(--accent);color:var(--accent);}
.sz-row{display:flex;gap:6px;}
.sz-tog{width:44px;height:36px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.4);font-size:12px;}
.sz-tog.active{background:rgba(8,247,247,0.12);border-color:var(--accent);color:var(--accent);}
.photo-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:16px;}
.photo-slot{aspect-ratio:1;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;font-size:20px;color:rgba(255,255,255,0.2);}
.photo-slot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.col-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
.col-card{display:flex;flex-direction:column;align-items:center;gap:6px;}
.col-dot{width:22px;height:22px;border-radius:50%;border:1px solid rgba(255,255,255,0.15);}
.col-lbl{font-size:10px;color:rgba(255,255,255,0.4);}
.col-zone{width:100%;aspect-ratio:1;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;font-size:24px;color:rgba(255,255,255,0.2);}
.col-zone img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.next-btn{width:100%;padding:13px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:15px;letter-spacing:0.1em;border:none;margin-top:14px;}
.pub-btn{width:100%;padding:15px;background:var(--accent);color:#000;font-family:var(--font-display);font-size:17px;letter-spacing:0.12em;border:none;margin-top:8px;}
.hint{font-size:11px;color:rgba(255,255,255,0.35);line-height:1.6;margin-bottom:12px;}
.sum-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);padding:14px;margin-bottom:16px;}
.sum-row2{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;}
.sum-k{color:rgba(255,255,255,0.4);min-width:110px;}
footer{background:rgba(255,255,255,0.02);border-top:1px solid rgba(255,255,255,0.06);padding:24px 14px;margin-top:20px;}
.foot-brand{font-family:var(--font-display);font-size:24px;margin-bottom:4px;}
.foot-brand span{color:var(--accent);}
.foot-links{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;}
.foot-links a{font-size:12px;color:rgba(255,255,255,0.5);}
.foot-copy{font-size:11px;color:rgba(255,255,255,0.25);}
</style>
</head>
<body>
<div id="root"></div>
<script>
const API = '';
const {useState,useEffect,useContext,createContext,useCallback} = React;
const {BrowserRouter,Routes,Route,Link,useNavigate,useParams,useSearchParams} = ReactRouterDOM;

// AUTH CONTEXT
const AuthCtx = createContext();
function AuthProvider({children}){
  const [user,setUser]=useState(null);
  const [loading,setLoading]=useState(true);
  const [cart,setCart]=useState(()=>{try{return JSON.parse(localStorage.getItem('100th_cart')||'[]');}catch{return [];}});
  useEffect(()=>{
    const token=localStorage.getItem('100th_token');
    if(token){
      axios.defaults.headers.common['Authorization']='Bearer '+token;
      axios.get('/api/auth/me').then(r=>setUser(r.data)).catch(()=>localStorage.removeItem('100th_token')).finally(()=>setLoading(false));
    }else setLoading(false);
  },[]);
  useEffect(()=>{localStorage.setItem('100th_cart',JSON.stringify(cart));},[cart]);
  const login=async(email,password)=>{const r=await axios.post('/api/auth/login',{email,password});localStorage.setItem('100th_token',r.data.token);axios.defaults.headers.common['Authorization']='Bearer '+r.data.token;setUser(r.data.user);return r.data;};
  const register=async(data)=>{const r=await axios.post('/api/auth/register',data);localStorage.setItem('100th_token',r.data.token);axios.defaults.headers.common['Authorization']='Bearer '+r.data.token;setUser(r.data.user);return r.data;};
  const logout=()=>{localStorage.removeItem('100th_token');delete axios.defaults.headers.common['Authorization'];setUser(null);};
  const addToCart=(product,size,color,qty=1)=>{setCart(prev=>{const key=product.id+'-'+size+'-'+color;const ex=prev.find(i=>i.key===key);if(ex)return prev.map(i=>i.key===key?{...i,quantity:i.quantity+qty}:i);return[...prev,{key,product,size,color,quantity:qty,price:product.price}];});};
  const removeFromCart=(key)=>setCart(prev=>prev.filter(i=>i.key!==key));
  const updateQty=(key,qty)=>{if(qty<=0)return removeFromCart(key);setCart(prev=>prev.map(i=>i.key===key?{...i,quantity:qty}:i));};
  const clearCart=()=>setCart([]);
  const cartTotal=cart.reduce((s,i)=>s+(i.price*i.quantity),0);
  const cartCount=cart.reduce((s,i)=>s+i.quantity,0);
  return React.createElement(AuthCtx.Provider,{value:{user,loading,login,register,logout,cart,addToCart,removeFromCart,updateQty,clearCart,cartTotal,cartCount}},children);
}
const useAuth=()=>useContext(AuthCtx);

function toast(msg){let t=document.getElementById('gt');if(!t){t=document.createElement('div');t.id='gt';t.className='toast';document.body.appendChild(t);}t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}
function fmt(p){return '₦'+Number(p).toLocaleString();}

// HEADER
function Header(){
  const {user,cartCount}=useAuth();
  const [showAdmin,setShowAdmin]=useState(false);
  const nav=useNavigate();
  return React.createElement(React.Fragment,null,
    React.createElement('div',{className:'ann'},'Free delivery on orders over ₦15,000 · New drops daily'),
    React.createElement('header',{className:'header'},
      React.createElement(Link,{to:'/',className:'logo'},React.createElement(React.Fragment,null,'100',React.createElement('span',null,'TH'))),
      React.createElement('div',{className:'header-right'},
        user?.is_admin&&React.createElement('button',{className:'admin-btn',onClick:()=>setShowAdmin(true)},'＋ Add'),
        React.createElement('button',{className:'hbtn',onClick:()=>nav('/account')},
          React.createElement('svg',{viewBox:'0 0 24 24'},React.createElement('path',{d:'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'}))
        ),
        React.createElement('button',{className:'hbtn',onClick:()=>nav('/cart')},
          React.createElement('svg',{viewBox:'0 0 24 24'},React.createElement('path',{d:'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z'}),React.createElement('line',{x1:'3',y1:'6',x2:'21',y2:'6'}),React.createElement('path',{d:'M16 10a4 4 0 01-8 0'})),
          cartCount>0&&React.createElement('span',{className:'badge'},cartCount)
        ),
        React.createElement('button',{className:'hbtn',onClick:()=>nav(user?'/account':'/login')},
          React.createElement('svg',{viewBox:'0 0 24 24'},React.createElement('path',{d:'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2'}),React.createElement('circle',{cx:'12',cy:'7',r:'4'})),
          React.createElement('span',null,user?user.first_name:'Sign In')
        )
      )
    ),
    showAdmin&&React.createElement(AdminModal,{onClose:()=>setShowAdmin(false)})
  );
}

// ADMIN MODAL
const COLORS=[{key:'black',label:'Black',hex:'#111'},{key:'white',label:'White',hex:'#f5f5f0'},{key:'teal',label:'Teal Green',hex:'#08f7f7'},{key:'carton',label:'Carton',hex:'#bb8e51'}];
const SIZES=['XS','S','M','L','XL','XXL'];
const TAGS=['new-arrivals','limited-edition','best-picks','t-shirts','sale'];
function AdminModal({onClose}){
  const [tab,setTab]=useState(0);
  const [title,setTitle]=useState('');const [price,setPrice]=useState('');const [compare,setCompare]=useState('');const [desc,setDesc]=useState('');
  const [tags,setTags]=useState([]);const [sizes,setSizes]=useState(['S','M','L','XL']);
  const [photos,setPhotos]=useState(Array(8).fill(null));const [colorImgs,setColorImgs]=useState({});
  const [publishing,setPublishing]=useState(false);const [done,setDone]=useState(false);
  const readFile=f=>new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(f);});
  const handlePhoto=async(e,i)=>{const f=e.target.files[0];if(!f)return;const d=await readFile(f);setPhotos(prev=>{const a=[...prev];a[i]={dataUrl:d,name:f.name};return a;});};
  const handleColorImg=async(e,key)=>{const f=e.target.files[0];if(!f)return;const d=await readFile(f);setColorImgs(prev=>({...prev,[key]:{dataUrl:d,name:f.name}}));};
  const publish=async()=>{
    if(!title||!price){toast('Fill in title and price!');return;}
    setPublishing(true);
    try{
      const uploadedPhotos=[];
      for(const p of photos){if(!p)continue;const res=await axios.post('/api/upload',{image:p.dataUrl,folder:'100th-products'});uploadedPhotos.push(res.data.url);}
      const uploadedColorImgs={};
      for(const[key,ci]of Object.entries(colorImgs)){const res=await axios.post('/api/upload',{image:ci.dataUrl,folder:'100th-colors'});uploadedColorImgs[key]=res.data.url;}
      await axios.post('/api/products',{title,description:desc,price:parseFloat(price),compare_price:compare?parseFloat(compare):null,tags,sizes,colors:COLORS.map(c=>c.label),images:uploadedPhotos,color_images:uploadedColorImgs});
      setDone(true);toast('✅ Product published live!');
    }catch(err){toast('Error: '+(err.response?.data?.error||err.message));}
    setPublishing(false);
  };
  if(done)return React.createElement('div',{className:'modal-ov',onClick:onClose},
    React.createElement('div',{className:'modal-sheet',onClick:e=>e.stopPropagation()},
      React.createElement('div',{className:'mbody'},
        React.createElement('div',{style:{textAlign:'center',padding:'30px'}},
          React.createElement('div',{style:{fontSize:'48px',marginBottom:'12px'}},'✅'),
          React.createElement('div',{style:{fontFamily:'Bebas Neue',fontSize:'22px',color:'#08f7f7',marginBottom:'8px'}},'LIVE ON YOUR STORE!'),
          React.createElement('div',{style:{fontSize:'13px',color:'rgba(255,255,255,0.6)'}},title+' is now published.'),
          React.createElement('button',{className:'pub-btn',style:{marginTop:'20px'},onClick:onClose},'Done')
        )
      )
    )
  );
  return React.createElement('div',{className:'modal-ov',onClick:onClose},
    React.createElement('div',{className:'modal-sheet',onClick:e=>e.stopPropagation()},
      React.createElement('div',{className:'modal-hdr'},
        React.createElement('div',{style:{display:'flex',alignItems:'center',gap:'10px'}},
          React.createElement('div',{style:{width:'32px',height:'32px',background:'#08f7f7',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'700',fontSize:'18px'}},'＋'),
          React.createElement('div',null,React.createElement('div',{className:'modal-title'},'ADD PRODUCT'),React.createElement('div',{style:{fontSize:'10px',color:'rgba(255,255,255,0.4)'}},'Upload → Goes live instantly'))
        ),
        React.createElement('button',{className:'modal-close',onClick:onClose},'✕')
      ),
      React.createElement('div',{className:'mtabs'},
        ['📋 Details','🖼 Photos','🎨 Colours','🚀 Publish'].map((t,i)=>React.createElement('button',{key:i,className:'mtab'+(tab===i?' active':''),onClick:()=>setTab(i)},t))
      ),
      React.createElement('div',{className:'mbody'},
        // Tab 0: Details
        React.createElement('div',{className:'mpanel'+(tab===0?' active':'')},
          React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Product Title *'),React.createElement('input',{className:'finput',value:title,onChange:e=>setTitle(e.target.value),placeholder:'e.g. Classic 100TH Tee'})),
          React.createElement('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}},
            React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Price (₦) *'),React.createElement('input',{className:'finput',type:'number',value:price,onChange:e=>setPrice(e.target.value),placeholder:'8500'})),
            React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Compare-at Price'),React.createElement('input',{className:'finput',type:'number',value:compare,onChange:e=>setCompare(e.target.value),placeholder:'14000'}))
          ),
          React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Description'),React.createElement('textarea',{className:'finput',value:desc,onChange:e=>setDesc(e.target.value),rows:3,placeholder:'Premium quality...'})),
          React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Tags'),React.createElement('div',{className:'tag-row'},TAGS.map(t=>React.createElement('button',{key:t,type:'button',className:'tag-btn'+(tags.includes(t)?' active':''),onClick:()=>setTags(prev=>prev.includes(t)?prev.filter(x=>x!==t):[...prev,t])},t)))),
          React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Sizes'),React.createElement('div',{className:'sz-row'},SIZES.map(s=>React.createElement('button',{key:s,type:'button',className:'sz-tog'+(sizes.includes(s)?' active':''),onClick:()=>setSizes(prev=>prev.includes(s)?prev.filter(x=>x!==s):[...prev,s])},s)))),
          React.createElement('button',{className:'next-btn',onClick:()=>setTab(1)},'Next: Photos →')
        ),
        // Tab 1: Photos
        React.createElement('div',{className:'mpanel'+(tab===1?' active':'')},
          React.createElement('p',{className:'hint'},'Upload up to 8 photos. First = cover image.'),
          React.createElement('div',{className:'photo-grid'},
            photos.map((p,i)=>React.createElement('label',{key:i,className:'photo-slot'},
              React.createElement('input',{type:'file',accept:'image/*',style:{display:'none'},onChange:e=>handlePhoto(e,i)}),
              p?React.createElement('img',{src:p.dataUrl,alt:''}):( i===0?'⭐':'＋')
            ))
          ),
          React.createElement('button',{className:'next-btn',onClick:()=>setTab(2)},'Next: Colour Images →')
        ),
        // Tab 2: Colours
        React.createElement('div',{className:'mpanel'+(tab===2?' active':'')},
          React.createElement('p',{className:'hint'},'Upload image for each colour variant.'),
          React.createElement('div',{className:'col-grid'},
            COLORS.map(c=>React.createElement('div',{key:c.key,className:'col-card'},
              React.createElement('div',{className:'col-dot',style:{background:c.hex}}),
              React.createElement('div',{className:'col-lbl'},c.label),
              React.createElement('label',{className:'col-zone'},
                React.createElement('input',{type:'file',accept:'image/*',style:{display:'none'},onChange:e=>handleColorImg(e,c.key)}),
                colorImgs[c.key]?React.createElement('img',{src:colorImgs[c.key].dataUrl,alt:''}):'＋'
              )
            ))
          ),
          React.createElement('button',{className:'next-btn',onClick:()=>setTab(3)},'Next: Publish →')
        ),
        // Tab 3: Publish
        React.createElement('div',{className:'mpanel'+(tab===3?' active':'')},
          React.createElement('div',{className:'sum-box'},
            [['Title',title||'—'],['Price',price?'₦'+price+(compare?' (was ₦'+compare+')':''):'—'],['Sizes',sizes.join(', ')||'—'],['Tags',tags.join(', ')||'none'],['Photos',photos.filter(Boolean).length+' uploaded'],['Colour images',Object.keys(colorImgs).join(', ')||'none']].map(([k,v])=>
              React.createElement('div',{key:k,className:'sum-row2'},React.createElement('span',{className:'sum-k'},k),React.createElement('span',null,v))
            )
          ),
          React.createElement('button',{className:'pub-btn',onClick:publish,disabled:publishing},publishing?'PUBLISHING…':'🚀 PUBLISH LIVE TO YOUR STORE')
        )
      )
    )
  );
}

// HOME
const CATS=[{label:'All',icon:'🏠',cat:'all'},{label:'T-Shirts',icon:'👕',cat:'t-shirts'},{label:'Limited',icon:'⭐',cat:'limited-edition'},{label:'New In',icon:'🆕',cat:'new-arrivals'},{label:'Best Picks',icon:'🏆',cat:'best-picks'}];
function Home(){
  const [products,setProducts]=useState([]);const [loading,setLoading]=useState(true);const [cat,setCat]=useState('all');
  const [bIdx,setBIdx]=useState(0);const [timer,setTimer]=useState('00:00:00');const [wishlist,setWishlist]=useState([]);
  const {user,addToCart}=useAuth();const nav=useNavigate();
  const banners=[{h:'DRESS\nLIKE IT\nMATTERS',sub:'Premium Nigerian streetwear',eye:'NEW COLLECTION 2026'},{h:'LIMITED\nEDITION',sub:'Only a few left',eye:'EXCLUSIVE DROP'},{h:'EXPRESS\nYOURSELF',sub:'Custom designs available',eye:'CUSTOM DESIGN'}];
  useEffect(()=>{loadProducts('all');},[]);
  useEffect(()=>{const id=setInterval(()=>setBIdx(i=>(i+1)%banners.length),5000);return()=>clearInterval(id);},[]);
  useEffect(()=>{const tick=()=>{const now=new Date(),end=new Date(now);end.setHours(23,59,59,999);const d=end-now,h=Math.floor(d/3600000),m=Math.floor((d%3600000)/60000),s=Math.floor((d%60000)/1000);setTimer(String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'));};tick();const id=setInterval(tick,1000);return()=>clearInterval(id);},[]);
  useEffect(()=>{if(user)axios.get('/api/wishlist').then(r=>setWishlist(r.data.map(p=>p.id))).catch(()=>{});},[user]);
  const loadProducts=async(c)=>{setLoading(true);try{const r=await axios.get('/api/products',{params:c&&c!=='all'?{tag:c}:{}});setProducts(r.data);}catch{}setLoading(false);};
  const handleCat=(c)=>{setCat(c);loadProducts(c);};
  const toggleWish=async(e,id)=>{e.stopPropagation();if(!user){nav('/login');return;}const inList=wishlist.includes(id);try{if(inList){await axios.delete('/api/wishlist/'+id);setWishlist(prev=>prev.filter(x=>x!==id));toast('Removed from wishlist');}else{await axios.post('/api/wishlist/'+id);setWishlist(prev=>[...prev,id]);toast('Added to wishlist ♥');}}catch{toast('Error');}};
  const handleATC=(e,p)=>{e.stopPropagation();addToCart(p,p.sizes?.[1]||p.sizes?.[0]||'M',p.colors?.[0]||'Black');toast(p.title+' added to cart! 🛒');};
  const ProductCard=({product:p})=>React.createElement('div',{className:'card',onClick:()=>nav('/product/'+p.id)},
    React.createElement('div',{className:'card-img'},
      p.images?.[0]?React.createElement('img',{src:p.images[0],alt:p.title,loading:'lazy'}):React.createElement('span',null,'👕'),
      p.tags?.includes('new-arrivals')&&React.createElement('span',{className:'card-badge badge-new'},'NEW'),
      p.tags?.includes('limited-edition')&&React.createElement('span',{className:'card-badge badge-ltd'},'LIMITED'),
      p.compare_price>p.price&&React.createElement('span',{className:'card-badge badge-sale',style:{top:'32px'}},'SALE'),
      React.createElement('button',{className:'wish-btn'+(wishlist.includes(p.id)?' active':''),onClick:e=>toggleWish(e,p.id)},wishlist.includes(p.id)?'♥':'♡')
    ),
    React.createElement('div',{className:'card-info'},
      React.createElement('div',{className:'card-name'},p.title),
      React.createElement('div',null,React.createElement('span',{className:'card-price'},fmt(p.price)),p.compare_price>p.price&&React.createElement('span',{className:'card-compare'},fmt(p.compare_price))),
      React.createElement('div',{className:'card-rating'},React.createElement('span',{style:{color:'#ffd600'}},'★★★★★'),' (4.8)'),
      React.createElement('button',{className:'atc',onClick:e=>handleATC(e,p)},'ADD TO CART')
    )
  );
  const newArrivals=products.filter(p=>p.tags?.includes('new-arrivals')||!p.tags?.length);
  const bestPicks=products.filter(p=>p.tags?.includes('best-picks'));
  const limited=products.filter(p=>p.tags?.includes('limited-edition'));
  const Section=({title,items,linkCat})=>items.length===0?null:React.createElement('div',{className:'section'},
    React.createElement('div',{className:'sec-header'},React.createElement('h2',{className:'sec-title'},title),React.createElement('button',{className:'sec-link',onClick:()=>handleCat(linkCat)},'See all →')),
    React.createElement('div',{className:'grid'},items.slice(0,4).map(p=>React.createElement(ProductCard,{key:p.id,product:p})))
  );
  return React.createElement('div',null,
    React.createElement('div',{className:'cat-strip'},CATS.map(c=>React.createElement('button',{key:c.cat,className:'cat-pill'+(cat===c.cat?' active':''),onClick:()=>handleCat(c.cat)},React.createElement('span',{style:{fontSize:'18px'}},c.icon),React.createElement('span',null,c.label)))),
    React.createElement('div',{className:'flash'},React.createElement('div',{style:{display:'flex',alignItems:'center',gap:'8px',flex:1}},React.createElement('span',{style:{fontSize:'18px'}},'⚡'),React.createElement('span',{className:'flash-title'},'FLASH SALE'),React.createElement('span',{style:{fontSize:'11px',opacity:0.8}},'Limited deals')),React.createElement('div',{className:'flash-timer'},timer),React.createElement('button',{className:'flash-cta',onClick:()=>handleCat('sale')},'SEE ALL →')),
    React.createElement('div',{className:'banner'},React.createElement('div',{className:'banner-content'},React.createElement('div',{className:'banner-eye'},banners[bIdx].eye),React.createElement('div',{className:'banner-h',style:{whiteSpace:'pre-line'}},banners[bIdx].h),React.createElement('div',{className:'banner-sub'},banners[bIdx].sub),React.createElement('button',{className:'banner-cta',onClick:()=>handleCat('t-shirts')},'SHOP T-SHIRTS'))),
    loading?React.createElement('div',{className:'spinner'},React.createElement('div',{className:'spin'})):
    cat!=='all'?React.createElement('div',{className:'section'},React.createElement('div',{className:'sec-header'},React.createElement('h2',{className:'sec-title'},CATS.find(c=>c.cat===cat)?.label||'Products')),React.createElement('div',{className:'grid'},products.length===0?React.createElement('div',{style:{gridColumn:'1/-1',textAlign:'center',padding:'40px',color:'rgba(255,255,255,0.4)'}},'No products yet'):products.map(p=>React.createElement(ProductCard,{key:p.id,product:p})))):
    React.createElement(React.Fragment,null,
      React.createElement(Section,{title:'JUST IN',items:newArrivals,linkCat:'new-arrivals'}),
      React.createElement(Section,{title:'BEST PICKS',items:bestPicks,linkCat:'best-picks'}),
      React.createElement(Section,{title:'LIMITED EDITION',items:limited,linkCat:'limited-edition'}),
      products.length===0&&React.createElement('div',{style:{textAlign:'center',padding:'60px 20px',color:'rgba(255,255,255,0.4)'}},React.createElement('div',{style:{fontSize:'48px',marginBottom:'12px'}},'👕'),React.createElement('div',{style:{fontSize:'16px',marginBottom:'6px',color:'#fff'}},'Products coming soon'),React.createElement('div',{style:{fontSize:'13px'}},'Admin: tap "+ Add" to upload your first product'))
    ),
    React.createElement('footer',null,React.createElement('div',{className:'foot-brand'},'100',React.createElement('span',null,'TH')),React.createElement('div',{style:{fontSize:'12px',color:'#888',marginBottom:'16px'}},'Dress Like It Matters'),React.createElement('div',{className:'foot-links'},React.createElement('a',{href:'/account'},'My Account'),React.createElement('a',{href:'/account'},'Orders'),React.createElement('a',{href:'mailto:hundredsdotshop@gmail.com'},'Contact')),React.createElement('div',{className:'foot-copy'},'© 2026 100TH Store'))
  );
}

// LOGIN
function Login(){
  const [email,setEmail]=useState('');const [pw,setPw]=useState('');const [err,setErr]=useState('');const [loading,setLoading]=useState(false);
  const {login}=useAuth();const nav=useNavigate();
  const submit=async(e)=>{e.preventDefault();setLoading(true);setErr('');try{await login(email,pw);nav('/account');}catch(e){setErr(e.response?.data?.error||'Login failed');}setLoading(false);};
  return React.createElement('div',{className:'auth-page'},
    React.createElement('div',{className:'auth-logo'},'100',React.createElement('span',null,'TH')),
    React.createElement('div',{className:'auth-card'},
      React.createElement('h1',{className:'auth-title'},'Sign In'),
      React.createElement('p',{className:'auth-sub'},'Welcome back! Sign in to track orders.'),
      err&&React.createElement('div',{className:'auth-err'},'❌ '+err),
      React.createElement('form',{onSubmit:submit},
        React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Email'),React.createElement('input',{className:'finput',type:'email',value:email,onChange:e=>setEmail(e.target.value),placeholder:'your@email.com',required:true})),
        React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Password'),React.createElement('input',{className:'finput',type:'password',value:pw,onChange:e=>setPw(e.target.value),placeholder:'Your password',required:true})),
        React.createElement('button',{className:'auth-btn',type:'submit',disabled:loading},loading?'SIGNING IN…':'SIGN IN')
      ),
      React.createElement('div',{className:'auth-div'},React.createElement('span',null,'OR')),
      React.createElement('button',{className:'auth-link-btn',onClick:()=>nav('/register')},'Create New Account')
    ),
    React.createElement('a',{href:'/',style:{marginTop:'16px',fontSize:'12px',color:'#888'}},'← Back to store')
  );
}

// REGISTER
function Register(){
  const [form,setForm]=useState({first_name:'',last_name:'',email:'',password:'',phone:''});
  const [err,setErr]=useState('');const [loading,setLoading]=useState(false);
  const {register}=useAuth();const nav=useNavigate();
  const submit=async(e)=>{e.preventDefault();setLoading(true);setErr('');try{await register(form);nav('/account');}catch(e){setErr(e.response?.data?.error||'Registration failed');}setLoading(false);};
  const set=(k,v)=>setForm(prev=>({...prev,[k]:v}));
  return React.createElement('div',{className:'auth-page'},
    React.createElement('div',{className:'auth-logo'},'100',React.createElement('span',null,'TH')),
    React.createElement('div',{className:'auth-card'},
      React.createElement('h1',{className:'auth-title'},'Create Account'),
      React.createElement('p',{className:'auth-sub'},'Join 100TH — track orders & save favourites.'),
      err&&React.createElement('div',{className:'auth-err'},'❌ '+err),
      React.createElement('form',{onSubmit:submit},
        React.createElement('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}},
          React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'First Name'),React.createElement('input',{className:'finput',value:form.first_name,onChange:e=>set('first_name',e.target.value),placeholder:'First name',required:true})),
          React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Last Name'),React.createElement('input',{className:'finput',value:form.last_name,onChange:e=>set('last_name',e.target.value),placeholder:'Last name',required:true}))
        ),
        React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Email'),React.createElement('input',{className:'finput',type:'email',value:form.email,onChange:e=>set('email',e.target.value),placeholder:'your@email.com',required:true})),
        React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Phone'),React.createElement('input',{className:'finput',type:'tel',value:form.phone,onChange:e=>set('phone',e.target.value),placeholder:'08012345678'})),
        React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Password'),React.createElement('input',{className:'finput',type:'password',value:form.password,onChange:e=>set('password',e.target.value),placeholder:'Min. 8 characters',required:true})),
        React.createElement('button',{className:'auth-btn',type:'submit',disabled:loading},loading?'CREATING…':'CREATE ACCOUNT')
      ),
      React.createElement('div',{className:'auth-div'},React.createElement('span',null,'OR')),
      React.createElement('button',{className:'auth-link-btn',onClick:()=>nav('/login')},'Sign In Instead')
    )
  );
}

// ACCOUNT
function Account(){
  const {user,logout}=useAuth();const [tab,setTab]=useState('orders');const [orders,setOrders]=useState([]);const [wishlist,setWishlist]=useState([]);const nav=useNavigate();
  useEffect(()=>{if(!user){nav('/login');return;}axios.get('/api/orders').then(r=>setOrders(r.data)).catch(()=>{});axios.get('/api/wishlist').then(r=>setWishlist(r.data)).catch(()=>{});},[user]);
  const removeWish=async(id)=>{await axios.delete('/api/wishlist/'+id);setWishlist(prev=>prev.filter(p=>p.id!==id));};
  if(!user)return null;
  return React.createElement('div',{className:'acct'},
    React.createElement('div',{className:'acct-hero'},React.createElement('div',{className:'acct-av'},user.first_name?.[0]?.toUpperCase()),React.createElement('div',null,React.createElement('div',{className:'acct-name'},user.first_name+' '+user.last_name),React.createElement('div',{className:'acct-email'},user.email))),
    React.createElement('div',{className:'stats'},[['ORDERS',orders.length],['PAID',orders.filter(o=>o.payment_status==='paid').length],['WISHLIST',wishlist.length]].map(([l,n])=>React.createElement('div',{key:l,className:'stat'},React.createElement('div',{className:'stat-n'},n),React.createElement('div',{className:'stat-l'},l)))),
    React.createElement('div',{className:'tabs'},[['orders','📦 Orders'],['wishlist','♥ Wishlist'],['profile','👤 Profile']].map(([k,l])=>React.createElement('button',{key:k,className:'tab'+(tab===k?' active':''),onClick:()=>setTab(k)},l))),
    React.createElement('div',{className:'panel'+(tab==='orders'?' active':'')},
      orders.length===0?React.createElement('div',{className:'empty'},React.createElement('div',{className:'empty-icon'},'📦'),React.createElement('div',{className:'empty-title'},'No orders yet'),React.createElement('div',{className:'empty-sub'},'Your orders will appear here'),React.createElement('a',{href:'/',className:'shop-btn'},'SHOP NOW')):
      orders.map(o=>React.createElement('div',{key:o.id,className:'ord-card'},
        React.createElement('div',{className:'ord-top'},React.createElement('div',null,React.createElement('div',{className:'ord-num'},'Order #'+o.order_ref),React.createElement('div',{className:'ord-date'},new Date(o.created_at).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}))),React.createElement('div',{className:'ord-status'},o.payment_status==='paid'?'✅ Paid':'⏳ Pending')),
        React.createElement('div',{className:'ord-foot'},React.createElement('div',{className:'ord-total'},'Total: ',React.createElement('strong',null,fmt(o.total))))
      ))
    ),
    React.createElement('div',{className:'panel'+(tab==='wishlist'?' active':'')},
      wishlist.length===0?React.createElement('div',{className:'empty'},React.createElement('div',{className:'empty-icon'},'♥'),React.createElement('div',{className:'empty-title'},'Wishlist is empty'),React.createElement('div',{className:'empty-sub'},'Tap ♡ on any product to save it'),React.createElement('a',{href:'/',className:'shop-btn'},'BROWSE')):
      wishlist.map(p=>React.createElement('div',{key:p.id,style:{display:'flex',gap:'12px',padding:'12px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)',marginBottom:'10px'}},
        p.images?.[0]?React.createElement('img',{src:p.images[0],style:{width:'80px',height:'80px',objectFit:'cover'}}):React.createElement('div',{style:{width:'80px',height:'80px',background:'rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'28px'}},'👕'),
        React.createElement('div',{style:{flex:1}},React.createElement('div',{style:{fontSize:'13px',marginBottom:'4px'}},p.title),React.createElement('div',{style:{fontSize:'14px',fontWeight:'700',color:'#08f7f7',marginBottom:'8px'}},fmt(p.price)),React.createElement('div',{style:{display:'flex',gap:'8px'}},React.createElement('a',{href:'/product/'+p.id,style:{padding:'6px 14px',background:'#08f7f7',color:'#000',fontSize:'11px',fontWeight:'600'}},'View'),React.createElement('button',{onClick:()=>removeWish(p.id),style:{padding:'6px 14px',background:'transparent',border:'1px solid rgba(255,255,255,0.15)',color:'rgba(255,255,255,0.4)',fontSize:'11px',cursor:'pointer'}},'Remove')))
      ))
    ),
    React.createElement('div',{className:'panel'+(tab==='profile'?' active':'')},
      React.createElement('div',{className:'prof-card'},[['Full Name',user.first_name+' '+user.last_name],['Email',user.email],['Phone',user.phone||'Not set']].map(([k,v])=>React.createElement('div',{key:k,className:'prof-row'},React.createElement('span',{className:'prof-key'},k),React.createElement('span',null,v)))),
      React.createElement('button',{className:'logout-btn',onClick:()=>{logout();nav('/');}},'Sign Out')
    )
  );
}

// CART
function Cart(){
  const {cart,removeFromCart,updateQty,cartTotal}=useAuth();const nav=useNavigate();
  if(cart.length===0)return React.createElement('div',{className:'cart-page'},React.createElement('div',{className:'empty'},React.createElement('div',{className:'empty-icon'},'🛒'),React.createElement('div',{className:'empty-title'},'Your cart is empty'),React.createElement('div',{className:'empty-sub'},'Add some products to get started'),React.createElement('a',{href:'/',className:'shop-btn'},'SHOP NOW')));
  return React.createElement('div',{className:'cart-page'},
    React.createElement('h1',{className:'cart-title'},'MY CART ('+cart.length+')'),
    cart.map(item=>React.createElement('div',{key:item.key,className:'cart-item'},
      item.product.images?.[0]?React.createElement('img',{className:'cart-img',src:item.product.images[0],alt:item.product.title}):React.createElement('div',{className:'cart-img-ph'},'👕'),
      React.createElement('div',{className:'cart-info'},
        React.createElement('div',{className:'cart-name'},item.product.title),
        React.createElement('div',{className:'cart-meta'},item.color+' · Size '+item.size),
        React.createElement('div',{className:'cart-price'},fmt(item.price*item.quantity)),
        React.createElement('div',{className:'qty-row'},
          React.createElement('button',{className:'qty-btn',onClick:()=>updateQty(item.key,item.quantity-1)},'−'),
          React.createElement('span',{className:'qty-n'},item.quantity),
          React.createElement('button',{className:'qty-btn',onClick:()=>updateQty(item.key,item.quantity+1)},'+'),
          React.createElement('button',{className:'rm-btn',onClick:()=>removeFromCart(item.key)},'Remove')
        )
      )
    )),
    React.createElement('div',{className:'summary'},
      React.createElement('div',{className:'sum-row'},React.createElement('span',null,'Subtotal'),React.createElement('span',null,fmt(cartTotal))),
      React.createElement('div',{className:'sum-row'},React.createElement('span',null,'Delivery'),React.createElement('span',null,'Calculated at checkout')),
      React.createElement('div',{className:'sum-total'},React.createElement('span',null,'Total'),React.createElement('span',{style:{color:'#08f7f7'}},fmt(cartTotal))),
      React.createElement('button',{className:'chk-btn',onClick:()=>nav('/checkout')},'PROCEED TO CHECKOUT')
    )
  );
}

// CHECKOUT
function Checkout(){
  const {user,cart,cartTotal,clearCart}=useAuth();const nav=useNavigate();
  const [addr,setAddr]=useState({full_name:'',email:user?.email||'',phone:user?.phone||'',address:'',city:'',state:'Lagos'});
  const [fee,setFee]=useState(1200);const [payMethod,setPayMethod]=useState('paystack');const [loading,setLoading]=useState(false);
  useEffect(()=>{if(!user)nav('/login');},[user]);
  useEffect(()=>{if(addr.state)axios.post('/api/delivery/estimate',{state:addr.state}).then(r=>setFee(r.data.fee)).catch(()=>{});},[addr.state]);
  const setA=(k,v)=>setAddr(prev=>({...prev,[k]:v}));
  const placeOrder=async()=>{
    if(!addr.full_name||!addr.address||!addr.phone){alert('Please fill in all delivery details');return;}
    setLoading(true);
    try{
      const items=cart.map(i=>({product:i.product,size:i.size,color:i.color,quantity:i.quantity,price:i.price}));
      const orderRes=await axios.post('/api/orders',{items,delivery_address:addr,delivery_fee:fee});
      const order=orderRes.data;
      const total=cartTotal+fee;
      const payRes=await axios.post('/api/payment/paystack/init',{amount:total,email:addr.email||user.email,order_ref:order.order_ref,callback_url:window.location.origin+'/order-success?ref='+order.order_ref});
      if(payRes.data.data?.authorization_url){clearCart();window.location.href=payRes.data.data.authorization_url;}
    }catch(err){alert('Error: '+(err.response?.data?.error||err.message));}
    setLoading(false);
  };
  const STATES=['Lagos','Abuja','Kano','Ibadan','Ogun','Oyo','Rivers','Kaduna','Enugu','Delta','Edo','Imo','Others'];
  return React.createElement('div',{className:'chk-page'},
    React.createElement('h1',{className:'chk-title'},'CHECKOUT'),
    React.createElement('div',{className:'sec-t'},'DELIVERY DETAILS'),
    React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Full Name'),React.createElement('input',{className:'finput',value:addr.full_name,onChange:e=>setA('full_name',e.target.value),placeholder:'John Doe',required:true})),
    React.createElement('div',{className:'f-row'},
      React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Phone'),React.createElement('input',{className:'finput',type:'tel',value:addr.phone,onChange:e=>setA('phone',e.target.value),placeholder:'08012345678'})),
      React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Email'),React.createElement('input',{className:'finput',type:'email',value:addr.email,onChange:e=>setA('email',e.target.value)}))
    ),
    React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'Address'),React.createElement('input',{className:'finput',value:addr.address,onChange:e=>setA('address',e.target.value),placeholder:'House number, street name',required:true})),
    React.createElement('div',{className:'f-row'},
      React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'City'),React.createElement('input',{className:'finput',value:addr.city,onChange:e=>setA('city',e.target.value),placeholder:'Lagos'})),
      React.createElement('div',{className:'field'},React.createElement('label',{className:'flabel'},'State'),React.createElement('select',{className:'finput',value:addr.state,onChange:e=>setA('state',e.target.value)},STATES.map(s=>React.createElement('option',{key:s},s))))
    ),
    React.createElement('div',{className:'deliv-info'},'🚚 Delivery fee: ',React.createElement('strong',null,fmt(fee)),' · '+(addr.state==='Lagos'?'1-2 days':'2-4 days')),
    React.createElement('div',{className:'sec-t'},'PAYMENT'),
    React.createElement('div',{className:'pay-methods'},
      [['paystack','💳 Paystack','Card, bank transfer, USSD']].map(([k,name,sub])=>React.createElement('div',{key:k,className:'pay-method'+(payMethod===k?' sel':''),onClick:()=>setPayMethod(k)},React.createElement('input',{type:'radio',readOnly:true,checked:payMethod===k}),React.createElement('div',null,React.createElement('div',{className:'pay-name'},name),React.createElement('div',{className:'pay-sub'},sub))))
    ),
    React.createElement('div',{className:'summary',style:{marginBottom:'16px'}},
      cart.map(item=>React.createElement('div',{key:item.key,className:'sum-row'},React.createElement('span',null,item.product.title+' × '+item.quantity),React.createElement('span',null,fmt(item.price*item.quantity)))),
      React.createElement('div',{className:'sum-row'},React.createElement('span',null,'Delivery'),React.createElement('span',null,fmt(fee))),
      React.createElement('div',{className:'sum-total'},React.createElement('span',null,'Total'),React.createElement('span',{style:{color:'#08f7f7'}},fmt(cartTotal+fee)))
    ),
    React.createElement('button',{className:'pay-btn',onClick:placeOrder,disabled:loading},loading?'PROCESSING…':'PAY '+fmt(cartTotal+fee))
  );
}

// PRODUCT DETAIL
function ProductDetail(){
  const {id}=useParams();const [product,setProduct]=useState(null);const [selSize,setSelSize]=useState('');const [selColor,setSelColor]=useState('');const [selImg,setSelImg]=useState(0);
  const {addToCart,user}=useAuth();const nav=useNavigate();
  useEffect(()=>{axios.get('/api/products/'+id).then(r=>{setProduct(r.data);setSelSize(r.data.sizes?.[1]||r.data.sizes?.[0]||'M');setSelColor(r.data.colors?.[0]||'Black');}).catch(()=>nav('/'));},[id]);
  if(!product)return React.createElement('div',{className:'spinner'},React.createElement('div',{className:'spin'}));
  const colorHex={Black:'#111',White:'#f5f5f0','Teal Green':'#08f7f7',Carton:'#bb8e51'};
  const handleATC=()=>{addToCart(product,selSize,selColor);toast('Added to cart! 🛒');};
  return React.createElement('div',{className:'pd-page'},
    React.createElement('div',{className:'gal-main'},product.images?.[selImg]?React.createElement('img',{src:product.images[selImg],alt:product.title}):'👕'),
    product.images?.length>1&&React.createElement('div',{className:'gal-thumbs'},product.images.map((img,i)=>React.createElement('img',{key:i,className:'gal-thumb'+(selImg===i?' active':''),src:img,alt:'',onClick:()=>setSelImg(i)}))),
    React.createElement('div',{className:'pd-info'},
      React.createElement('h1',{className:'pd-title'},product.title),
      React.createElement('div',{className:'pd-price'},fmt(product.price)),
      product.compare_price>product.price&&React.createElement('div',{style:{fontSize:'14px',color:'#888',textDecoration:'line-through',marginBottom:'12px'}},fmt(product.compare_price)),
      React.createElement('div',{style:{display:'flex',alignItems:'center',gap:'6px',marginBottom:'16px'}},React.createElement('span',{style:{color:'#ffd600',fontSize:'14px'}},'★★★★★'),React.createElement('span',{style:{fontSize:'12px',color:'#888'}},'(4.8)')),
      product.colors?.length>0&&React.createElement(React.Fragment,null,
        React.createElement('div',{className:'pd-label'},'COLOUR — ',React.createElement('span',{style:{color:'#f5f5f0'}},selColor)),
        React.createElement('div',{className:'swatches'},product.colors.map(c=>React.createElement('button',{key:c,className:'swatch'+(selColor===c?' active':''),style:{background:colorHex[c]||'#888'},onClick:()=>setSelColor(c),title:c})))
      ),
      product.sizes?.length>0&&React.createElement(React.Fragment,null,
        React.createElement('div',{className:'pd-label'},'SIZE — ',React.createElement('span',{style:{color:'#f5f5f0'}},selSize)),
        React.createElement('div',{className:'sizes'},product.sizes.map(s=>React.createElement('button',{key:s,className:'sz-btn'+(selSize===s?' active':''),onClick:()=>setSelSize(s)},s)))
      ),
      React.createElement('button',{className:'pd-add',onClick:handleATC},'ADD TO CART'),
      React.createElement('button',{className:'pd-wish',onClick:()=>!user&&nav('/login')},'♡ Add to Wishlist')
    ),
    product.description&&React.createElement('div',{className:'pd-desc'},React.createElement('div',{style:{fontFamily:'Bebas Neue',fontSize:'16px',letterSpacing:'0.1em',marginBottom:'8px',color:'rgba(255,255,255,0.5)'}},'DESCRIPTION'),product.description)
  );
}

// ORDER SUCCESS
function OrderSuccess(){
  const [searchParams]=useSearchParams();const ref=searchParams.get('ref');
  const paystackRef=searchParams.get('reference')||searchParams.get('trxref');
  useEffect(()=>{if(paystackRef)axios.get('/api/payment/paystack/verify/'+paystackRef).catch(()=>{});},[paystackRef]);
  return React.createElement('div',{className:'success-page'},
    React.createElement('div',{className:'success-icon'},'🎉'),
    React.createElement('h1',{className:'success-title'},'ORDER PLACED!'),
    React.createElement('p',{className:'success-sub'},'Thank you for shopping with 100TH! Your order is confirmed.'),
    ref&&React.createElement('div',{className:'success-ref'},'Order: ',React.createElement('strong',null,ref)),
    React.createElement('a',{href:'/account',className:'shop-btn'},'VIEW MY ORDERS')
  );
}

// APP
function App(){
  return React.createElement(AuthProvider,null,
    React.createElement(BrowserRouter,null,
      React.createElement(Header,null),
      React.createElement(Routes,null,
        React.createElement(Route,{path:'/',element:React.createElement(Home,null)}),
        React.createElement(Route,{path:'/login',element:React.createElement(Login,null)}),
        React.createElement(Route,{path:'/register',element:React.createElement(Register,null)}),
        React.createElement(Route,{path:'/account',element:React.createElement(Account,null)}),
        React.createElement(Route,{path:'/cart',element:React.createElement(Cart,null)}),
        React.createElement(Route,{path:'/checkout',element:React.createElement(Checkout,null)}),
        React.createElement(Route,{path:'/order-success',element:React.createElement(OrderSuccess,null)}),
        React.createElement(Route,{path:'/product/:id',element:React.createElement(ProductDetail,null)})
      )
    )
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App,null));
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  await initDB();
  console.log('100TH Store running on port ' + PORT);
});
