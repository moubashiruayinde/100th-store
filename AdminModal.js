import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../context/AuthContext';

const COLORS = [
  { key:'black', label:'Black', hex:'#111111' },
  { key:'white', label:'White', hex:'#f5f5f0' },
  { key:'teal',  label:'Teal Green', hex:'#08f7f7' },
  { key:'carton',label:'Carton', hex:'#bb8e51' },
];
const SIZES = ['XS','S','M','L','XL','XXL'];
const TAGS  = ['new-arrivals','limited-edition','best-picks','t-shirts','sale'];

function showToast(msg) {
  let t = document.getElementById('global-toast');
  if (!t) { t = document.createElement('div'); t.id='global-toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

export default function AdminModal({ onClose }) {
  const [tab, setTab] = useState(0);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [compare, setCompare] = useState('');
  const [desc, setDesc] = useState('');
  const [tags, setTags] = useState([]);
  const [sizes, setSizes] = useState(['S','M','L','XL']);
  const [photos, setPhotos] = useState(Array(8).fill(null));
  const [colorImgs, setColorImgs] = useState({});
  const [bannerSlot, setBannerSlot] = useState('');
  const [bannerImg, setBannerImg] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);

  const toggleTag = t => setTags(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev,t]);
  const toggleSize = s => setSizes(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev,s]);

  const readFile = file => new Promise(res => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.readAsDataURL(file);
  });

  const handlePhoto = async (e, idx) => {
    const file = e.target.files[0]; if (!file) return;
    const dataUrl = await readFile(file);
    setPhotos(prev => { const a=[...prev]; a[idx]={dataUrl,name:file.name}; return a; });
  };

  const handleColorImg = async (e, key) => {
    const file = e.target.files[0]; if (!file) return;
    const dataUrl = await readFile(file);
    setColorImgs(prev => ({...prev, [key]:{dataUrl,name:file.name}}));
  };

  const handleBanner = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const dataUrl = await readFile(file);
    setBannerImg({dataUrl,name:file.name});
  };

  const publish = async () => {
    if (!title || !price) { showToast('Fill in title and price!'); return; }
    setPublishing(true);
    try {
      // Upload product photos to Cloudinary via server
      const uploadedPhotos = [];
      for (const p of photos) {
        if (!p) continue;
        const res = await axios.post(`${API_URL}/api/upload`, { image: p.dataUrl, folder:'100th-products' });
        uploadedPhotos.push(res.data.url);
      }

      // Upload color images
      const uploadedColorImgs = {};
      for (const [key, ci] of Object.entries(colorImgs)) {
        const res = await axios.post(`${API_URL}/api/upload`, { image: ci.dataUrl, folder:'100th-colors' });
        uploadedColorImgs[key] = res.data.url;
      }

      // Upload banner
      let bannerUrl = null;
      if (bannerImg) {
        const res = await axios.post(`${API_URL}/api/upload`, { image: bannerImg.dataUrl, folder:'100th-banners' });
        bannerUrl = res.data.url;
      }

      // Create product
      await axios.post(`${API_URL}/api/products`, {
        title, description: desc, price: parseFloat(price),
        compare_price: compare ? parseFloat(compare) : null,
        tags, sizes,
        colors: COLORS.map(c=>c.label),
        images: uploadedPhotos,
        color_images: uploadedColorImgs,
        banner_slot: bannerSlot ? parseInt(bannerSlot) : null,
        banner_image: bannerUrl,
      });

      setDone(true);
      showToast('✅ Product published live!');
    } catch(err) {
      showToast('Error: ' + (err.response?.data?.error || err.message));
    }
    setPublishing(false);
  };

  if (done) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <div className="modal-body">
          <div className="success-box">
            <div className="success-icon">✅</div>
            <div className="success-title">LIVE ON YOUR STORE!</div>
            <div className="success-sub">{title} is now published and visible to customers.</div>
            <button className="publish-btn" style={{marginTop:'20px'}} onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{width:'32px',height:'32px',background:'#08f7f7',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:'700',fontSize:'18px'}}>＋</div>
            <div>
              <div className="modal-title">ADD PRODUCT</div>
              <div style={{fontSize:'10px',color:'rgba(255,255,255,0.4)'}}>Upload → Goes live instantly</div>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-tabs">
          {['📋 Details','🖼 Photos','🎨 Colours','🚀 Publish'].map((t,i) => (
            <button key={i} className={`modal-tab ${tab===i?'active':''}`} onClick={()=>setTab(i)}>{t}</button>
          ))}
        </div>

        <div className="modal-body">
          {/* TAB 0: Details */}
          <div className={`modal-panel ${tab===0?'active':''}`}>
            <div className="field-group">
              <label className="field-label">Product Title *</label>
              <input className="field-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Classic 100TH Tee — Black" />
            </div>
            <div className="field-row">
              <div className="field-group">
                <label className="field-label">Price (₦) *</label>
                <input className="field-input" type="number" value={price} onChange={e=>setPrice(e.target.value)} placeholder="8500" />
              </div>
              <div className="field-group">
                <label className="field-label">Compare-at Price (₦)</label>
                <input className="field-input" type="number" value={compare} onChange={e=>setCompare(e.target.value)} placeholder="14000" />
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">Description</label>
              <textarea className="field-input field-textarea" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Premium quality 100TH tee..." rows={3} />
            </div>
            <div className="field-group">
              <label className="field-label">Tags / Collection</label>
              <div className="tag-row">
                {TAGS.map(t => (
                  <button key={t} type="button" className={`tag-btn ${tags.includes(t)?'active':''}`} onClick={()=>toggleTag(t)}>{t}</button>
                ))}
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">Sizes Available</label>
              <div className="size-row">
                {SIZES.map(s => (
                  <button key={s} type="button" className={`size-toggle ${sizes.includes(s)?'active':''}`} onClick={()=>toggleSize(s)}>{s}</button>
                ))}
              </div>
            </div>
            <button className="next-btn" onClick={()=>setTab(1)}>Next: Photos →</button>
          </div>

          {/* TAB 1: Photos */}
          <div className={`modal-panel ${tab===1?'active':''}`}>
            <p className="hint-text">Upload up to 8 photos. First photo = cover image shown in listings.</p>
            <div className="photo-grid">
              {photos.map((p,i) => (
                <label key={i} className="photo-slot">
                  <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>handlePhoto(e,i)} />
                  {p ? <img src={p.dataUrl} alt="" /> : (i===0 ? '⭐' : '＋')}
                </label>
              ))}
            </div>
            <div style={{marginTop:'8px'}}>
              <label className="field-label">Banner Slide (optional)</label>
              <div style={{display:'flex',gap:'10px',alignItems:'flex-start'}}>
                <select className="field-input" style={{flex:'0 0 120px'}} value={bannerSlot} onChange={e=>setBannerSlot(e.target.value)}>
                  <option value="">No banner</option>
                  <option value="1">Slide 1</option>
                  <option value="2">Slide 2</option>
                  <option value="3">Slide 3</option>
                </select>
                <label style={{flex:1,height:'70px',background:'rgba(255,255,255,0.04)',border:'1px dashed rgba(255,255,255,0.15)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',position:'relative',overflow:'hidden'}}>
                  <input type="file" accept="image/*" style={{display:'none'}} onChange={handleBanner} />
                  {bannerImg ? <img src={bannerImg.dataUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} /> : <span style={{fontSize:'11px',color:'rgba(255,255,255,0.3)'}}>Upload banner image</span>}
                </label>
              </div>
            </div>
            <button className="next-btn" onClick={()=>setTab(2)}>Next: Colour Images →</button>
          </div>

          {/* TAB 2: Colour Images */}
          <div className={`modal-panel ${tab===2?'active':''}`}>
            <p className="hint-text">Upload a photo for each colour. When a customer taps a colour swatch it shows this image.</p>
            <div className="color-img-grid">
              {COLORS.map(c => (
                <div key={c.key} className="color-img-card">
                  <div className="color-dot" style={{background:c.hex}} />
                  <div className="color-img-label">{c.label}</div>
                  <label className="color-img-zone">
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>handleColorImg(e,c.key)} />
                    {colorImgs[c.key] ? <img src={colorImgs[c.key].dataUrl} alt="" /> : '＋'}
                  </label>
                </div>
              ))}
            </div>
            <button className="next-btn" onClick={()=>setTab(3)}>Next: Publish →</button>
          </div>

          {/* TAB 3: Publish */}
          <div className={`modal-panel ${tab===3?'active':''}`}>
            <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.08)',padding:'14px',marginBottom:'16px'}}>
              {[['Title', title||'—'],['Price',price?`₦${price}${compare?` (was ₦${compare})`:''}`:'—'],['Sizes',sizes.join(', ')||'—'],['Tags',tags.join(', ')||'none'],['Photos',photos.filter(Boolean).length+' uploaded'],['Colour images',Object.keys(colorImgs).join(', ')||'none']].map(([k,v]) => (
                <div key={k} style={{display:'flex',gap:'10px',padding:'6px 0',borderBottom:'1px solid rgba(255,255,255,0.05)',fontSize:'12px'}}>
                  <span style={{color:'rgba(255,255,255,0.4)',minWidth:'110px'}}>{k}</span>
                  <span style={{color:'#f5f5f0'}}>{v}</span>
                </div>
              ))}
            </div>
            <button className="publish-btn" onClick={publish} disabled={publishing}>
              {publishing ? 'PUBLISHING…' : '🚀 PUBLISH LIVE TO YOUR STORE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
