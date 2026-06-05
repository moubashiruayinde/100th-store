import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth, API_URL } from '../context/AuthContext';

// ══ ACCOUNT PAGE ══
export function Account() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    axios.get(`${API_URL}/api/orders`).then(r=>setOrders(r.data)).catch(()=>{});
    axios.get(`${API_URL}/api/wishlist`).then(r=>setWishlist(r.data)).catch(()=>{});
  }, [user]);

  const removeWish = async (id) => {
    await axios.delete(`${API_URL}/api/wishlist/${id}`);
    setWishlist(prev=>prev.filter(p=>p.id!==id));
  };

  if (!user) return null;

  return (
    <div className="account-page">
      <div className="account-hero">
        <div className="account-avatar">{user.first_name?.[0]?.toUpperCase()}</div>
        <div>
          <div className="account-name">{user.first_name} {user.last_name}</div>
          <div className="account-email">{user.email}</div>
        </div>
      </div>
      <div className="account-stats">
        <div className="stat-card"><div className="stat-num">{orders.length}</div><div className="stat-label">ORDERS</div></div>
        <div className="stat-card"><div className="stat-num">{orders.filter(o=>o.payment_status==='paid').length}</div><div className="stat-label">DELIVERED</div></div>
        <div className="stat-card"><div className="stat-num">{wishlist.length}</div><div className="stat-label">WISHLIST</div></div>
      </div>
      <div className="account-tabs">
        {[['orders','📦 Orders'],['wishlist','♥ Wishlist'],['profile','👤 Profile']].map(([k,l])=>(
          <button key={k} className={`account-tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* Orders */}
      <div className={`tab-panel ${tab==='orders'?'active':''}`}>
        {orders.length===0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-title">No orders yet</div>
            <div className="empty-state-sub">Your orders will appear here</div>
            <Link to="/" className="shop-btn">SHOP NOW</Link>
          </div>
        ) : orders.map(o=>(
          <div key={o.id} className="order-card">
            <div className="order-top">
              <div>
                <div className="order-num">Order #{o.order_ref}</div>
                <div className="order-date">{new Date(o.created_at).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}</div>
              </div>
              <div className={`order-status ${o.payment_status}`}>
                {o.payment_status==='paid'?'✅ Paid':o.status==='processing'?'🚚 Processing':'⏳ Pending'}
              </div>
            </div>
            <div className="order-items">
              {(JSON.parse(o.items||'[]')).slice(0,2).map((item,i)=>(
                <div key={i} className="order-item">
                  {item.product?.images?.[0]
                    ? <img src={item.product.images[0]} alt={item.product?.title} />
                    : <div style={{width:'50px',height:'50px',background:'rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px'}}>👕</div>}
                  <div>
                    <div className="order-item-name">{item.product?.title}</div>
                    <div className="order-item-meta">{item.color} · {item.size} · Qty {item.quantity}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="order-footer">
              <div className="order-total">Total: <strong>₦{Number(o.total).toLocaleString()}</strong></div>
              {o.delivery_tracking && (
                <button className="order-track-btn">Track Order →</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Wishlist */}
      <div className={`tab-panel ${tab==='wishlist'?'active':''}`}>
        {wishlist.length===0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">♥</div>
            <div className="empty-state-title">Wishlist is empty</div>
            <div className="empty-state-sub">Tap ♡ on any product to save it</div>
            <Link to="/" className="shop-btn">BROWSE PRODUCTS</Link>
          </div>
        ) : wishlist.map(p=>(
          <div key={p.id} className="wish-card">
            {p.images?.[0] ? <img className="wish-img" src={p.images[0]} alt={p.title} /> : <div className="wish-img" style={{background:'rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'28px'}}>👕</div>}
            <div className="wish-info">
              <div className="wish-name">{p.title}</div>
              <div className="wish-price">₦{Number(p.price).toLocaleString()}</div>
              <div className="wish-actions">
                <Link to={`/product/${p.id}`} className="wish-view">View</Link>
                <button className="wish-remove" onClick={()=>removeWish(p.id)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Profile */}
      <div className={`tab-panel ${tab==='profile'?'active':''}`}>
        <div className="profile-card">
          {[['Full Name',`${user.first_name} ${user.last_name}`],['Email',user.email],['Phone',user.phone||'Not set'],['Member Since',new Date(user.created_at||Date.now()).toLocaleDateString('en-NG',{month:'long',year:'numeric'})]].map(([k,v])=>(
            <div key={k} className="profile-row"><span className="profile-key">{k}</span><span>{v}</span></div>
          ))}
        </div>
        <button className="logout-btn" onClick={()=>{logout();navigate('/');}}>Sign Out</button>
      </div>
    </div>
  );
}

// ══ CART PAGE ══
export function Cart() {
  const { cart, removeFromCart, updateCartQty, cartTotal } = useAuth();
  const navigate = useNavigate();

  if (cart.length===0) return (
    <div className="cart-page">
      <div className="empty-cart">
        <div className="empty-icon">🛒</div>
        <div className="empty-title">Your cart is empty</div>
        <div className="empty-sub">Add some products to get started</div>
        <Link to="/" className="shop-btn">SHOP NOW</Link>
      </div>
    </div>
  );

  return (
    <div className="cart-page">
      <h1 className="cart-title">MY CART ({cart.length})</h1>
      {cart.map(item=>(
        <div key={item.key} className="cart-item">
          {item.product.images?.[0]
            ? <img className="cart-item-img" src={item.product.images[0]} alt={item.product.title} />
            : <div className="cart-item-img-ph">👕</div>}
          <div className="cart-item-info">
            <div className="cart-item-name">{item.product.title}</div>
            <div className="cart-item-meta">{item.color} · Size {item.size}</div>
            <div className="cart-item-price">₦{(item.price*item.quantity).toLocaleString()}</div>
            <div className="qty-row">
              <button className="qty-btn" onClick={()=>updateCartQty(item.key,item.quantity-1)}>−</button>
              <span className="qty-num">{item.quantity}</span>
              <button className="qty-btn" onClick={()=>updateCartQty(item.key,item.quantity+1)}>+</button>
              <button className="remove-btn" onClick={()=>removeFromCart(item.key)}>Remove</button>
            </div>
          </div>
        </div>
      ))}
      <div className="cart-summary">
        <div className="cart-row"><span>Subtotal</span><span>₦{cartTotal.toLocaleString()}</span></div>
        <div className="cart-row"><span>Delivery</span><span>Calculated at checkout</span></div>
        <div className="cart-total-row"><span>Total</span><span style={{color:'#08f7f7'}}>₦{cartTotal.toLocaleString()}</span></div>
        <button className="checkout-btn" onClick={()=>navigate('/checkout')}>PROCEED TO CHECKOUT</button>
      </div>
    </div>
  );
}

// ══ CHECKOUT PAGE ══
export function Checkout() {
  const { user, cart, cartTotal, clearCart } = useAuth();
  const navigate = useNavigate();
  const [addr, setAddr] = useState({ full_name:'', email: user?.email||'', phone: user?.phone||'', address:'', city:'', state:'Lagos' });
  const [deliveryFee, setDeliveryFee] = useState(1200);
  const [payMethod, setPayMethod] = useState('paystack');
  const [loading, setLoading] = useState(false);

  useEffect(()=>{
    if(!user){navigate('/login');}
  },[user]);

  useEffect(()=>{
    if(addr.state){
      axios.post(`${API_URL}/api/delivery/estimate`,{state:addr.state}).then(r=>setDeliveryFee(r.data.fee)).catch(()=>{});
    }
  },[addr.state]);

  const setA = (k,v) => setAddr(prev=>({...prev,[k]:v}));

  const placeOrder = async () => {
    if(!addr.full_name||!addr.address||!addr.phone){alert('Please fill in all delivery details');return;}
    setLoading(true);
    try {
      const items = cart.map(i=>({product:i.product, size:i.size, color:i.color, quantity:i.quantity, price:i.price}));
      const orderRes = await axios.post(`${API_URL}/api/orders`,{items, delivery_address:addr, delivery_fee:deliveryFee});
      const order = orderRes.data;
      const total = cartTotal + deliveryFee;

      if(payMethod==='paystack'){
        const payRes = await axios.post(`${API_URL}/api/payment/paystack/init`,{
          amount: total, email: addr.email||user.email,
          order_ref: order.order_ref,
          callback_url: window.location.origin + '/order-success?ref=' + order.order_ref
        });
        if(payRes.data.data?.authorization_url){
          clearCart();
          window.location.href = payRes.data.data.authorization_url;
        }
      }
    } catch(err){
      alert('Error: ' + (err.response?.data?.error||err.message));
    }
    setLoading(false);
  };

  const STATES = ['Lagos','Abuja','Kano','Ibadan','Ogun','Oyo','Rivers','Kaduna','Enugu','Anambra','Delta','Edo','Imo','Kogi','Kwara','Nasarawa','Niger','Ondo','Osun','Ogun','Plateau','Sokoto','Taraba','Yobe','Zamfara','Others'];

  return (
    <div className="checkout-page">
      <h1 className="checkout-title">CHECKOUT</h1>

      <div className="form-section">
        <div className="form-section-title">DELIVERY DETAILS</div>
        <div className="field-group">
          <label className="field-label">Full Name</label>
          <input className="field-input" value={addr.full_name} onChange={e=>setA('full_name',e.target.value)} placeholder="John Doe" required />
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Phone</label>
            <input className="field-input" type="tel" value={addr.phone} onChange={e=>setA('phone',e.target.value)} placeholder="08012345678" required />
          </div>
          <div className="field-group">
            <label className="field-label">Email</label>
            <input className="field-input" type="email" value={addr.email} onChange={e=>setA('email',e.target.value)} placeholder="email@example.com" />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">Delivery Address</label>
          <input className="field-input" value={addr.address} onChange={e=>setA('address',e.target.value)} placeholder="House number, street name" required />
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">City</label>
            <input className="field-input" value={addr.city} onChange={e=>setA('city',e.target.value)} placeholder="Lagos" required />
          </div>
          <div className="field-group">
            <label className="field-label">State</label>
            <select className="field-input" value={addr.state} onChange={e=>setA('state',e.target.value)}>
              {STATES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="delivery-info">
          🚚 Estimated delivery fee: <strong>₦{deliveryFee.toLocaleString()}</strong> · {addr.state==='Lagos'?'1-2 days':'2-4 days'}
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">PAYMENT METHOD</div>
        <div className="payment-methods">
          {[['paystack','💳 Paystack','Card, bank transfer, USSD'],['opay','💚 OPay','Pay with OPay wallet or transfer']].map(([k,name,sub])=>(
            <div key={k} className={`payment-method ${payMethod===k?'selected':''}`} onClick={()=>setPayMethod(k)}>
              <input type="radio" readOnly checked={payMethod===k} />
              <div className="payment-method-info">
                <div className="payment-method-name">{name}</div>
                <div className="payment-method-sub">{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cart-summary" style={{marginBottom:'16px'}}>
        {cart.map(item=>(
          <div key={item.key} className="cart-row" style={{fontSize:'12px'}}>
            <span>{item.product.title} × {item.quantity}</span>
            <span>₦{(item.price*item.quantity).toLocaleString()}</span>
          </div>
        ))}
        <div className="cart-row"><span>Delivery</span><span>₦{deliveryFee.toLocaleString()}</span></div>
        <div className="cart-total-row"><span>Total</span><span style={{color:'#08f7f7'}}>₦{(cartTotal+deliveryFee).toLocaleString()}</span></div>
      </div>

      <button className="pay-btn" onClick={placeOrder} disabled={loading}>
        {loading ? 'PROCESSING…' : `PAY ₦${(cartTotal+deliveryFee).toLocaleString()}`}
      </button>
    </div>
  );
}

// ══ PRODUCT DETAIL PAGE ══
export function ProductDetail() {
  const { id } = require('react-router-dom').useParams();
  const [product, setProduct] = useState(null);
  const [selSize, setSelSize] = useState('');
  const [selColor, setSelColor] = useState('');
  const [selImg, setSelImg] = useState(0);
  const { addToCart, user } = useAuth();
  const navigate = useNavigate();

  useEffect(()=>{
    axios.get(`${API_URL}/api/products/${id}`).then(r=>{
      setProduct(r.data);
      setSelSize(r.data.sizes?.[1]||r.data.sizes?.[0]||'M');
      setSelColor(r.data.colors?.[0]||'Black');
    }).catch(()=>navigate('/'));
  },[id]);

  if(!product) return <div className="loading-spinner"><div className="spinner"/></div>;

  const handleAddToCart = () => {
    addToCart(product, selSize, selColor);
    let t = document.getElementById('global-toast');
    if(!t){t=document.createElement('div');t.id='global-toast';t.className='toast';document.body.appendChild(t);}
    t.textContent='Added to cart! 🛒';t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'),3000);
  };

  const colorHexMap = {Black:'#111',White:'#f5f5f0','Teal Green':'#08f7f7',Carton:'#bb8e51'};

  return (
    <div className="product-detail">
      <div className="product-gallery">
        <div className="gallery-main">
          {product.images?.[selImg]
            ? <img src={product.images[selImg]} alt={product.title} />
            : <div className="product-placeholder" style={{height:'100%'}}>👕</div>}
        </div>
        {product.images?.length > 1 && (
          <div className="gallery-thumbs">
            {product.images.map((img,i)=>(
              <img key={i} className={`gallery-thumb ${selImg===i?'active':''}`} src={img} alt="" onClick={()=>setSelImg(i)} />
            ))}
          </div>
        )}
      </div>
      <div className="pd-info">
        <h1 className="pd-title">{product.title}</h1>
        <div className="pd-price">₦{Number(product.price).toLocaleString()}</div>
        {product.compare_price>product.price && <div className="pd-compare">₦{Number(product.compare_price).toLocaleString()}</div>}
        <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'16px'}}>
          <span style={{color:'#ffd600',fontSize:'14px'}}>★★★★★</span>
          <span style={{fontSize:'12px',color:'#888'}}>(4.8 · 124 reviews)</span>
        </div>
        {product.colors?.length > 0 && <>
          <div className="pd-label">COLOUR — <span style={{color:'#f5f5f0'}}>{selColor}</span></div>
          <div className="color-swatches">
            {product.colors.map(c=>(
              <button key={c} className={`color-swatch ${selColor===c?'active':''}`}
                style={{background: product.color_images?.[c.toLowerCase().replace(' ','')]
                  ? `url(${product.color_images[c.toLowerCase().replace(' ','')]}) center/cover`
                  : colorHexMap[c]||'#888'}}
                onClick={()=>{
                  setSelColor(c);
                  const key = c.toLowerCase().replace(' ','');
                  if(product.color_images?.[key]) {
                    const idx = product.images?.indexOf(product.color_images[key]);
                    if(idx>=0) setSelImg(idx);
                  }
                }}
                title={c}
              />
            ))}
          </div>
        </>}
        {product.sizes?.length > 0 && <>
          <div className="pd-label">SIZE — <span style={{color:'#f5f5f0'}}>{selSize}</span></div>
          <div className="size-grid">
            {product.sizes.map(s=>(
              <button key={s} className={`size-btn ${selSize===s?'active':''}`} onClick={()=>setSelSize(s)}>{s}</button>
            ))}
          </div>
        </>}
        <button className="pd-add-btn" onClick={handleAddToCart}>ADD TO CART</button>
        <button className="pd-wish-btn" onClick={()=>!user?navigate('/login'):null}>♡ Add to Wishlist</button>
      </div>
      {product.description && (
        <div className="pd-desc">
          <div style={{fontFamily:'Bebas Neue',fontSize:'16px',letterSpacing:'0.1em',marginBottom:'8px',color:'rgba(255,255,255,0.5)'}}>DESCRIPTION</div>
          {product.description}
        </div>
      )}
    </div>
  );
}

// ══ ORDER SUCCESS PAGE ══
export function OrderSuccess() {
  const [searchParams] = require('react-router-dom').useSearchParams();
  const ref = searchParams.get('ref');
  const [order, setOrder] = useState(null);

  useEffect(()=>{
    if(ref) {
      // Verify payment
      const paystackRef = searchParams.get('reference') || searchParams.get('trxref');
      if(paystackRef) {
        axios.get(`${API_URL}/api/payment/paystack/verify/${paystackRef}`).then(()=>{}).catch(()=>{});
      }
      axios.get(`${API_URL}/api/orders/${ref}`).then(r=>setOrder(r.data)).catch(()=>{});
    }
  },[ref]);

  return (
    <div className="order-success-page">
      <div className="order-success-icon">🎉</div>
      <h1 className="order-success-title">ORDER PLACED!</h1>
      <p className="order-success-sub">
        Thank you for shopping with 100TH!<br/>
        Your order is confirmed and will be delivered soon.
      </p>
      {ref && <div className="order-success-ref">Order Reference: <strong>{ref}</strong></div>}
      {order?.delivery_tracking && (
        <div style={{marginBottom:'16px',fontSize:'13px',color:'rgba(255,255,255,0.6)'}}>
          Tracking: <span style={{color:'#08f7f7'}}>{order.delivery_tracking}</span>
        </div>
      )}
      <Link to="/account" className="order-success-btn">VIEW MY ORDERS</Link>
    </div>
  );
}
