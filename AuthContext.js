import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';
const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('100th_cart') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    const token = localStorage.getItem('100th_token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get(`${API}/api/auth/me`).then(r => setUser(r.data)).catch(() => {
        localStorage.removeItem('100th_token');
      }).finally(() => setLoading(false));
    } else { setLoading(false); }
  }, []);

  useEffect(() => {
    localStorage.setItem('100th_cart', JSON.stringify(cart));
  }, [cart]);

  const login = async (email, password) => {
    const r = await axios.post(`${API}/api/auth/login`, { email, password });
    localStorage.setItem('100th_token', r.data.token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${r.data.token}`;
    setUser(r.data.user);
    return r.data;
  };

  const register = async (data) => {
    const r = await axios.post(`${API}/api/auth/register`, data);
    localStorage.setItem('100th_token', r.data.token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${r.data.token}`;
    setUser(r.data.user);
    return r.data;
  };

  const logout = () => {
    localStorage.removeItem('100th_token');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const addToCart = (product, size, color, quantity = 1) => {
    setCart(prev => {
      const key = `${product.id}-${size}-${color}`;
      const existing = prev.find(i => i.key === key);
      if (existing) return prev.map(i => i.key === key ? { ...i, quantity: i.quantity + quantity } : i);
      return [...prev, { key, product, size, color, quantity, price: product.price }];
    });
  };

  const removeFromCart = (key) => setCart(prev => prev.filter(i => i.key !== key));

  const updateCartQty = (key, quantity) => {
    if (quantity <= 0) return removeFromCart(key);
    setCart(prev => prev.map(i => i.key === key ? { ...i, quantity } : i));
  };

  const clearCart = () => setCart([]);

  const cartTotal = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, cart, addToCart, removeFromCart, updateCartQty, clearCart, cartTotal, cartCount }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
export const API_URL = API;
