# 100TH Store — Free Deployment Guide

## Deploy to Render (FREE)

1. Go to render.com → Sign up free
2. Click "New" → "Blueprint"
3. Connect your GitHub repo (upload this folder first)
4. Render reads render.yaml and deploys everything automatically

## Manual Deploy Steps

### 1. Create GitHub repo
- Go to github.com → New repository → "100th-store"
- Upload all files

### 2. Deploy on Render
- render.com → New → Web Service → Connect GitHub repo
- Root Directory: server
- Build: npm install
- Start: node index.js
- Add all env vars from render.yaml

### 3. Deploy Frontend
- render.com → New → Static Site → same repo
- Root: client
- Build: npm install && npm run build
- Publish: build

### 4. Add Database
- render.com → New → PostgreSQL → Free plan
- Copy connection string to server env vars

## Admin Login
Email: hundredsdotshop@gmail.com
Password: Admin@100th2026

## Features
- Upload clothes photos → live instantly
- Customer login/register
- Cart & checkout
- Paystack payment
- Sendbox delivery (manual booking)
- Order tracking
- Wishlist
