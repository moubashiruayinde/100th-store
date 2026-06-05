// Login.js
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await login(email, password);
      navigate('/account');
    } catch(err) {
      setError(err.response?.data?.error || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-logo">100<span style={{color:'#08f7f7'}}>TH</span></div>
      <div className="auth-card">
        <h1 className="auth-title">Sign In</h1>
        <p className="auth-sub">Welcome back! Sign in to track orders & manage your account.</p>
        {error && <div className="auth-error">❌ {error}</div>}
        <form onSubmit={submit}>
          <div className="field-group">
            <label className="field-label">Email Address</label>
            <input className="field-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" required />
          </div>
          <div className="field-group">
            <label className="field-label">Password</label>
            <input className="field-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your password" required />
          </div>
          <button className="auth-btn" type="submit" disabled={loading}>{loading?'SIGNING IN…':'SIGN IN'}</button>
        </form>
        <a href="#" className="auth-forgot">Forgot password?</a>
        <div className="auth-divider"><span>OR</span></div>
        <Link to="/register" className="auth-link">Create New Account</Link>
      </div>
      <Link to="/" className="auth-back">← Back to store</Link>
    </div>
  );
}

// Register.js
export function Register() {
  const [form, setForm] = useState({ first_name:'', last_name:'', email:'', password:'', phone:'' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await register(form);
      navigate('/account');
    } catch(err) {
      setError(err.response?.data?.error || 'Registration failed');
    }
    setLoading(false);
  };

  const set = (k,v) => setForm(prev=>({...prev,[k]:v}));

  return (
    <div className="auth-page">
      <div className="auth-logo">100<span style={{color:'#08f7f7'}}>TH</span></div>
      <div className="auth-card">
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-sub">Join 100TH — track orders, save favourites & get exclusive deals.</p>
        {error && <div className="auth-error">❌ {error}</div>}
        <form onSubmit={submit}>
          <div className="field-row">
            <div className="field-group">
              <label className="field-label">First Name</label>
              <input className="field-input" value={form.first_name} onChange={e=>set('first_name',e.target.value)} placeholder="First name" required />
            </div>
            <div className="field-group">
              <label className="field-label">Last Name</label>
              <input className="field-input" value={form.last_name} onChange={e=>set('last_name',e.target.value)} placeholder="Last name" required />
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">Email Address</label>
            <input className="field-input" type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="your@email.com" required />
          </div>
          <div className="field-group">
            <label className="field-label">Phone Number</label>
            <input className="field-input" type="tel" value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="08012345678" />
          </div>
          <div className="field-group">
            <label className="field-label">Password</label>
            <input className="field-input" type="password" value={form.password} onChange={e=>set('password',e.target.value)} placeholder="Min. 8 characters" required />
          </div>
          <button className="auth-btn" type="submit" disabled={loading}>{loading?'CREATING…':'CREATE ACCOUNT'}</button>
        </form>
        <div className="auth-divider"><span>OR</span></div>
        <Link to="/login" className="auth-link">Sign In Instead</Link>
      </div>
      <Link to="/" className="auth-back">← Back to store</Link>
    </div>
  );
}
