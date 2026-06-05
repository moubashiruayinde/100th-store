import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth, API_URL } from '../context/AuthContext';

function showToast(msg) {
  let t = document.getElementById('global-toast');
  if (!t) { t = document.createElement('div'); t.id='global-toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

const CATS = [
  {label:'All', icon:'🏠', cat:'all'},
  {label:'T-Shirts', icon:'👕', cat:'t-shirts'},
  {label:'Limited', icon:'⭐', cat:'limited-edition'},
  {label:'New In', icon:'🆕', cat:'new-arrivals'},
  {label:'Best Picks', icon:'🏆', cat:'best-picks'},
];

export default function Home() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState('all');
  const [bannerIdx, setBannerIdx] = useState(0);
  const [timer, setTimer] = useState('00:00:00');
  const [wishlist, setWishlist] = useState([]);
  const { user, addToCart } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const banners = [
    { headline:'DRESS\nLIKE IT\nMATTERS', sub:'Premium Nigerian streetwear', eyebrow:'NEW COLLECTION 2026', bg:'#0a0a0a' },
    { headline:'LIMITED\nEDITION', sub:'Only a few left — grab yours', eyebrow:'EXCLUSIVE DROP', bg:'#0a0a2a' },
    { headline:'EXPRESS\nYOURSELF', sub:'Custom designs available', eyebrow:'CUSTOM DESIGN', bg:'#0a1a0a' },
  ];

  useEffect(() => {
    const cat = searchParams.get('cat') || 'all';
    setActiveCat(cat);
    loadProducts(cat);
  }, [searchParams]);

  useEffect(() => {
    const interval = setInterval(() => setBannerIdx(i => (i+1) % banners.length), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const end = new Date(now); end.setHours(23,59,59,999);
      const diff = end - now;
      const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000), s = Math.floor((diff%60000)/1000);
      setTimer(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick(); const id = setInterval(tick,1000); return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (user) {
      axios.get(`${API_URL}/api/wishlist`).then(r => setWishlist(r.data.map(p=>p.id))).catch(()=>{});
    }
  }, [user]);

  const loadProducts = async (cat) => {
    setLoading(true);
    try {
      const params = cat && cat !== 'all' ? { tag: cat } : {};
      const r = await axios.get(`${API_URL}/api/products`, { params });
      setProducts(r.data);
    } catch { }
    setLoading(false);
  };

  const handleCat = (cat) => {
    setActiveCat(cat);
    loadProducts(cat);
  };

  const toggleWishlist = async (e, productId) => {
    e.stopPropagation();
    if (!user) { navigate('/login'); return; }
    const inList = wishlist.includes(productId);
    try {
      if (inList) {
        await axios.delete(`${API_URL}/api/wishlist/${productId}`);
        setWishlist(prev => prev.filter(id => id !== productId));
        showToast('Removed from wishlist');
      } else {
        await axios.post(`${API_URL}/api/wishlist/${productId}`);
        setWishlist(prev => [...prev, productId]);
        showToast('Added to wishlist ♥');
      }
    } catch { showToast('Sign in to use wishlist'); }
  };

  const handleAddToCart = (e, product) => {
    e.stopPropagation();
    const size = product.sizes?.[1] || product.sizes?.[0] || 'M';
    const color = product.colors?.[0] || 'Black';
    addToCart(product, size, color);
    showToast(`${product.title} added to cart!`);
  };

  const formatPrice = p => '₦' + Number(p).toLocaleString();

  // Group products by section
  const newArrivals = products.filter(p => p.tags?.includes('new-arrivals') || (!p.tags?.length));
  const bestPicks   = products.filter(p => p.tags?.includes('best-picks'));
  const limited     = products.filter(p => p.tags?.includes('limited-edition'));
  const allProducts = products;

  const ProductCard = ({ product }) => (
    <div className="product-card" onClick={() => navigate(`/product/${product.id}`)}>
      <div className="product-img-wrap">
        {product.images?.[0]
          ? <img src={product.images[0]} alt={product.title} loading="lazy" />
          : <div className="product-placeholder">👕</div>}
        {product.tags?.includes('new-arrivals') && <span className="product-badge badge-new">NEW</span>}
        {product.tags?.includes('limited-edition') && <span className="product-badge badge-limited">LIMITED</span>}
        {product.compare_price > product.price && <span className="product-badge badge-sale" style={{top:'32px'}}>SALE</span>}
        <button className={`product-wishlist-btn ${wishlist.includes(product.id)?'active':''}`} onClick={e=>toggleWishlist(e,product.id)}>
          {wishlist.includes(product.id) ? '♥' : '♡'}
        </button>
      </div>
      <div className="product-info">
        <div className="product-name">{product.title}</div>
        <div className="product-price-row">
          <span className="product-price">{formatPrice(product.price)}</span>
          {product.compare_price > product.price && <span className="product-compare">{formatPrice(product.compare_price)}</span>}
        </div>
        <div className="product-rating">
          <span className="rating-stars">★★★★★</span>
          <span className="rating-count">(4.8)</span>
        </div>
        <button className="add-to-cart-btn" onClick={e=>handleAddToCart(e,product)}>ADD TO CART</button>
      </div>
    </div>
  );

  const Section = ({ title, items, linkCat }) => items.length === 0 ? null : (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">{title}</h2>
        <button className="section-link" onClick={()=>handleCat(linkCat)}>See all →</button>
      </div>
      <div className="products-grid">
        {items.slice(0,4).map(p => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );

  return (
    <div>
      {/* Category Strip */}
      <div className="cat-strip">
        {CATS.map(c => (
          <button key={c.cat} className={`cat-pill ${activeCat===c.cat?'active':''}`} onClick={()=>handleCat(c.cat)}>
            <span className="cat-pill-icon">{c.icon}</span>
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      {/* Flash Sale */}
      <div className="flash-bar">
        <div className="flash-left">
          <span style={{fontSize:'18px'}}>⚡</span>
          <span className="flash-title">FLASH SALE</span>
          <span className="flash-sub">Limited deals</span>
        </div>
        <div className="flash-timer">{timer}</div>
        <button className="flash-cta" onClick={()=>handleCat('sale')}>SEE ALL →</button>
      </div>

      {/* Banner */}
      <div className="banner-wrap">
        {banners.map((b, i) => (
          <div key={i} className={`banner-slide ${bannerIdx===i?'active':''}`} style={{background:b.bg}}>
            <div className="banner-content">
              <div className="banner-eyebrow">{b.eyebrow}</div>
              <div className="banner-headline">{b.headline}</div>
              <div className="banner-sub">{b.sub}</div>
              <button className="banner-cta" onClick={()=>handleCat('t-shirts')}>SHOP T-SHIRTS</button>
            </div>
          </div>
        ))}
        <div className="banner-dots">
          {banners.map((_,i) => <button key={i} className={`banner-dot ${bannerIdx===i?'active':''}`} onClick={()=>setBannerIdx(i)} />)}
        </div>
      </div>

      {/* Product Sections */}
      {loading ? (
        <div className="loading-spinner"><div className="spinner"/></div>
      ) : activeCat !== 'all' ? (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">{CATS.find(c=>c.cat===activeCat)?.label || 'Products'}</h2>
          </div>
          <div className="products-grid">
            {allProducts.length === 0
              ? <div style={{gridColumn:'1/-1',textAlign:'center',padding:'40px',color:'rgba(255,255,255,0.4)'}}>No products yet</div>
              : allProducts.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </div>
      ) : <>
        <Section title="JUST IN" items={newArrivals} linkCat="new-arrivals" />
        <Section title="BEST PICKS" items={bestPicks} linkCat="best-picks" />
        <Section title="LIMITED EDITION" items={limited} linkCat="limited-edition" />
        {products.length === 0 && (
          <div style={{textAlign:'center',padding:'60px 20px',color:'rgba(255,255,255,0.4)'}}>
            <div style={{fontSize:'48px',marginBottom:'12px'}}>👕</div>
            <div style={{fontSize:'16px',marginBottom:'6px',color:'#fff'}}>Products coming soon</div>
            <div style={{fontSize:'13px'}}>Admin: tap "+ Add" to upload your first product</div>
          </div>
        )}
      </>}

      <footer>
        <div className="footer-brand">100<span>TH</span></div>
        <div className="footer-tagline">Dress Like It Matters</div>
        <div className="footer-links">
          <a href="/account">My Account</a>
          <a href="/account?tab=orders">Orders</a>
          <a href="mailto:hundredsdotshop@gmail.com">Contact</a>
        </div>
        <div className="footer-copy">© 2026 100TH Store. All rights reserved.</div>
      </footer>
    </div>
  );
}
