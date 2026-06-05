import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AdminModal from './AdminModal';

export default function Header() {
  const { user, cartCount } = useAuth();
  const [showAdmin, setShowAdmin] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <div className="announcement-bar">
        Free delivery on orders over ₦15,000 · New drops daily · 100% authentic
      </div>
      <header className="site-header">
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <button className="header-menu-btn" onClick={() => setShowMenu(!showMenu)}>
            <span/><span/><span/>
          </button>
          <Link to="/" className="header-logo">100<span>TH</span></Link>
        </div>
        <div className="header-right">
          {user?.is_admin && (
            <button className="admin-add-btn" onClick={() => setShowAdmin(true)}>＋ Add</button>
          )}
          <Link to="/account" className="header-icon">
            <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </Link>
          <Link to="/cart" className="header-icon">
            <svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            {cartCount > 0 && <span className="badge">{cartCount}</span>}
          </Link>
          <Link to="/account" className="header-icon">
            <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span style={{fontSize:'9px'}}>{user ? user.first_name : 'Sign In'}</span>
          </Link>
        </div>
      </header>

      {/* Side Menu */}
      {showMenu && (
        <div style={{position:'fixed',inset:0,zIndex:9998}} onClick={() => setShowMenu(false)}>
          <div style={{position:'absolute',top:0,left:0,width:'75%',maxWidth:'280px',height:'100vh',background:'#0a0a0a',borderRight:'1px solid rgba(255,255,255,0.1)',padding:'20px 0',overflowY:'auto'}} onClick={e => e.stopPropagation()}>
            <div style={{padding:'0 18px 20px',borderBottom:'1px solid rgba(255,255,255,0.08)',fontFamily:'Bebas Neue',fontSize:'24px'}}>100<span style={{color:'#08f7f7'}}>TH</span></div>
            {[['🏠','Home','/'],['👕','T-Shirts','/?cat=t-shirts'],['⭐','Limited Edition','/?cat=limited-edition'],['🆕','New Arrivals','/?cat=new-arrivals'],['🏆','Best Picks','/?cat=best-picks']].map(([icon,label,path]) => (
              <button key={label} onClick={() => { navigate(path); setShowMenu(false); }} style={{display:'flex',alignItems:'center',gap:'12px',width:'100%',padding:'14px 18px',background:'none',border:'none',color:'rgba(255,255,255,0.7)',fontSize:'14px',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                <span>{icon}</span>{label}
              </button>
            ))}
            <div style={{padding:'12px 18px',fontSize:'11px',color:'rgba(255,255,255,0.3)',letterSpacing:'0.1em',marginTop:'8px'}}>MY ACCOUNT</div>
            {user ? <>
              <button onClick={() => { navigate('/account'); setShowMenu(false); }} style={{display:'flex',alignItems:'center',gap:'12px',width:'100%',padding:'14px 18px',background:'none',border:'none',color:'rgba(255,255,255,0.7)',fontSize:'14px'}}>👤 My Account</button>
              <button onClick={() => { navigate('/account?tab=orders'); setShowMenu(false); }} style={{display:'flex',alignItems:'center',gap:'12px',width:'100%',padding:'14px 18px',background:'none',border:'none',color:'rgba(255,255,255,0.7)',fontSize:'14px'}}>📦 My Orders</button>
            </> : <>
              <button onClick={() => { navigate('/login'); setShowMenu(false); }} style={{display:'flex',alignItems:'center',gap:'12px',width:'100%',padding:'14px 18px',background:'none',border:'none',color:'rgba(255,255,255,0.7)',fontSize:'14px'}}>🔑 Sign In</button>
              <button onClick={() => { navigate('/register'); setShowMenu(false); }} style={{display:'flex',alignItems:'center',gap:'12px',width:'100%',padding:'14px 18px',background:'none',border:'none',color:'rgba(255,255,255,0.7)',fontSize:'14px'}}>✍️ Create Account</button>
            </>}
          </div>
        </div>
      )}

      {showAdmin && <AdminModal onClose={() => setShowAdmin(false)} />}
    </>
  );
}
