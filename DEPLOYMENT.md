# Production Deployment Guide

This guide covers deploying GeoIntelliSense to production with secure API key management.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Static Frontend (Vite Build)                   │
│  Hosted: Vercel/Netlify/S3+CloudFront          │
│  Port: 443 (HTTPS)                              │
└─────────────────┬───────────────────────────────┘
                  │
                  │ HTTPS Requests
                  │
┌─────────────────▼───────────────────────────────┐
│  Backend API Server (Express.js)                │
│  Hosted: Railway/Render/Heroku/AWS              │
│  Port: 3001 (Internal)                          │
│  Environment: GEMINI_API_KEY (Server-side only) │
└─────────────────┬───────────────────────────────┘
                  │
                  │ API Calls
                  │
┌─────────────────▼───────────────────────────────┐
│  Google Gemini API                              │
│  https://generativelanguage.googleapis.com      │
└─────────────────────────────────────────────────┘
```

## 📋 Pre-Deployment Checklist

### Required
- [ ] Gemini API key obtained from https://aistudio.google.com/app/apikey
- [ ] Backend hosting platform selected
- [ ] Frontend hosting platform selected
- [ ] Domain name (optional but recommended)
- [ ] SSL certificate (auto-provided by most platforms)

### Recommended
- [ ] Error monitoring service account (Sentry, LogRocket)
- [ ] Analytics platform setup (Google Analytics, Plausible)
- [ ] Uptime monitoring (UptimeRobot, Pingdom)
- [ ] Backup strategy for environment variables

---

## 🚀 Deployment Options

### Option 1: Vercel (Frontend) + Railway (Backend) ⭐ RECOMMENDED

**Best for:** Quick deployment, automatic scaling, generous free tier

#### Backend Deployment (Railway)

1. **Sign up at [Railway.app](https://railway.app)**

2. **Create New Project:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your GitHub repository

3. **Configure Environment Variables:**
   ```bash
   GEMINI_API_KEY=your_actual_gemini_api_key
   PORT=3001
   NODE_ENV=production
   ```

4. **Set Start Command:**
   - Railway auto-detects `npm start`
   - Verify in Settings → Deploy → Start Command

5. **Get Public URL:**
   - Railway provides: `https://your-app.railway.app`
   - Copy this URL for frontend configuration

#### Frontend Deployment (Vercel)

1. **Sign up at [Vercel.com](https://vercel.com)**

2. **Import GitHub Repository:**
   - Click "New Project"
   - Import your GitHub repository

3. **Configure Build Settings:**
   - Framework Preset: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

4. **Add Environment Variable:**
   ```bash
   VITE_API_URL=https://your-app.railway.app
   ```

5. **Deploy:**
   - Click "Deploy"
   - Vercel provides: `https://your-app.vercel.app`

6. **Add Custom Domain (Optional):**
   - Go to Settings → Domains
   - Add your custom domain
   - Follow DNS configuration instructions

✅ **Done!** Your app is live at `https://your-app.vercel.app`

---

### Option 2: Netlify (Frontend) + Render (Backend)

**Best for:** Continuous deployment, form handling, serverless functions

#### Backend Deployment (Render)

1. **Sign up at [Render.com](https://render.com)**

2. **Create Web Service:**
   - New → Web Service
   - Connect GitHub repository
   - Select branch: `main`

3. **Configure Service:**
   ```
   Name: geointellisense-backend
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   ```

4. **Add Environment Variables:**
   ```bash
   GEMINI_API_KEY=your_actual_gemini_api_key
   NODE_ENV=production
   ```

5. **Deploy:**
   - Click "Create Web Service"
   - Copy public URL: `https://geointellisense-backend.onrender.com`

#### Frontend Deployment (Netlify)

1. **Sign up at [Netlify.com](https://netlify.com)**

2. **Import Project:**
   - Add new site → Import an existing project
   - Connect to GitHub

3. **Configure Build:**
   ```
   Build command: npm run build
   Publish directory: dist
   ```

4. **Environment Variables:**
   ```bash
   VITE_API_URL=https://geointellisense-backend.onrender.com
   ```

5. **Deploy:**
   - Click "Deploy site"
   - Site URL: `https://your-site.netlify.app`

---

### Option 3: AWS (Full Control)

**Best for:** Enterprise deployments, custom infrastructure, compliance requirements

#### Backend (AWS Elastic Beanstalk or ECS)

1. **Create Elastic Beanstalk Application:**
   ```bash
   # Install EB CLI
   pip install awsebcli

   # Initialize
   eb init -p node.js geointellisense-backend

   # Create environment
   eb create production

   # Set environment variables
   eb setenv GEMINI_API_KEY=your_key NODE_ENV=production

   # Deploy
   eb deploy
   ```

2. **Get Endpoint:**
   - URL: `http://geointellisense-backend.us-east-1.elasticbeanstalk.com`

#### Frontend (S3 + CloudFront)

1. **Build Frontend:**
   ```bash
   VITE_API_URL=http://backend-url npm run build
   ```

2. **Create S3 Bucket:**
   ```bash
   aws s3 mb s3://geointellisense-frontend
   aws s3 website s3://geointellisense-frontend --index-document index.html
   ```

3. **Upload Build:**
   ```bash
   aws s3 sync dist/ s3://geointellisense-frontend --delete
   ```

4. **Create CloudFront Distribution:**
   - Origin: S3 bucket
   - Viewer Protocol Policy: Redirect HTTP to HTTPS
   - Default Root Object: index.html

---

### Option 4: Docker + Any Cloud Provider

**Best for:** Containerized deployments, Kubernetes, multi-cloud

See [Docker Configuration](#docker-configuration) section below.

---

## 🔧 Environment Variables Reference

### Backend (.env)
```bash
# REQUIRED
GEMINI_API_KEY=your_actual_gemini_api_key_here

# OPTIONAL
PORT=3001                    # Default: 3001
NODE_ENV=production          # development | production
```

### Frontend (.env.local or Platform Environment Variables)
```bash
# Backend API URL (REQUIRED in production)
VITE_API_URL=https://your-backend-url.com
```

---

## 🐳 Docker Configuration

### Backend Dockerfile

See `Dockerfile` in the repository root.

### Build and Run

```bash
# Build
docker build -t geointellisense-backend .

# Run
docker run -p 3001:3001 \
  -e GEMINI_API_KEY=your_key \
  -e NODE_ENV=production \
  geointellisense-backend
```

### Docker Compose

```bash
# Run everything
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## 🔒 Security Considerations

### Required Security Measures ✅

1. **HTTPS Only**
   - All platforms provide free SSL certificates
   - Redirect HTTP to HTTPS automatically

2. **Environment Variables**
   - Never commit `.env` files to Git
   - Use platform environment variable settings
   - Rotate API keys regularly

3. **Rate Limiting**
   - Backend has built-in rate limiting (50 req/min per IP)
   - Monitor usage in production

4. **CORS**
   - Backend CORS is enabled
   - Consider restricting to your frontend domain in production:
   ```javascript
   // server/index.js
   app.use(cors({
     origin: 'https://your-frontend-domain.com'
   }));
   ```

### Recommended Security Enhancements

1. **Add Helmet.js** (Security headers):
   ```bash
   npm install helmet
   ```
   ```javascript
   // server/index.js
   import helmet from 'helmet';
   app.use(helmet());
   ```

2. **Add Request Logging:**
   ```bash
   npm install morgan
   ```
   ```javascript
   import morgan from 'morgan';
   app.use(morgan('combined'));
   ```

3. **Add Error Monitoring** (Sentry):
   - See Phase 6 in main plan

---

## 📊 Monitoring

### Health Check Endpoint

The backend includes a health check endpoint:
```bash
GET https://your-backend-url.com/api/health

Response:
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### Recommended Monitoring Services

1. **Uptime Monitoring:**
   - [UptimeRobot](https://uptimerobot.com) - Free
   - [Pingdom](https://www.pingdom.com) - Paid
   - Ping `/api/health` every 5 minutes

2. **Error Tracking:**
   - [Sentry](https://sentry.io) - Free tier available
   - [LogRocket](https://logrocket.com) - Paid

3. **Analytics:**
   - [Google Analytics](https://analytics.google.com) - Free
   - [Plausible](https://plausible.io) - Privacy-focused, paid

---

## 🚨 Troubleshooting

### Common Issues

**1. "Failed to fetch" errors in frontend**
- ✅ Check VITE_API_URL is set correctly
- ✅ Verify backend is running and accessible
- ✅ Check CORS settings in backend
- ✅ Verify HTTPS is used for both frontend and backend

**2. Backend returns 500 errors**
- ✅ Check GEMINI_API_KEY is set in backend environment
- ✅ Verify API key has Gemini API access enabled
- ✅ Check backend logs for specific error messages

**3. Rate limit errors (429)**
- ✅ Current limit: 50 requests/minute per IP
- ✅ Consider increasing limit in production
- ✅ Implement exponential backoff on client

**4. Slow API responses**
- ✅ Gemini API can be slow for complex queries
- ✅ Consider adding loading indicators
- ✅ Implement request caching for common queries

---

## 🔄 Continuous Deployment

### GitHub Actions (Example)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test  # If tests exist
      # Deploy to Railway/Render/AWS automatically

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run build
      # Deploy to Vercel/Netlify automatically
```

---

## 📈 Performance Optimization

### Frontend

1. **Enable Gzip/Brotli** (automatic on Vercel/Netlify)

2. **Add CDN** (automatic on Vercel/Netlify/CloudFront)

3. **Implement Code Splitting:**
   ```typescript
   const MapView = lazy(() => import('./components/MapView'));
   ```

### Backend

1. **Add Response Caching:**
   ```javascript
   import NodeCache from 'node-cache';
   const cache = new NodeCache({ stdTTL: 300 }); // 5 min
   ```

2. **Implement Database** (if scaling):
   - Store chat history in Redis/MongoDB
   - Cache frequent queries

3. **Horizontal Scaling:**
   - Most platforms auto-scale
   - Railway: Auto-scales on Pro plan
   - AWS: Configure auto-scaling groups

---

## 💰 Cost Estimation

### Free Tier (Hobby Projects)

| Service | Free Tier | Cost After |
|---------|-----------|------------|
| **Vercel** | 100 GB bandwidth/month | $20/month (Pro) |
| **Railway** | $5 credit/month | Pay-as-you-go |
| **Netlify** | 100 GB bandwidth/month | $19/month (Pro) |
| **Render** | Free tier available | $7/month (Starter) |
| **Gemini API** | 15 req/min free | ~$0.0001/req |

**Estimated Monthly Cost (Low Traffic):**
- Free tier: $0
- With moderate traffic: $10-30/month

---

## 📞 Support

**Deployment Issues:**
- Check platform-specific documentation
- Review deployment logs carefully
- Verify all environment variables are set

**Application Issues:**
- Check backend logs for API errors
- Verify frontend console for client errors
- Test health check endpoint

**Security Concerns:**
- Review [SECURITY.md](SECURITY.md)
- Report issues via GitHub Issues
- Never expose API keys

---

## ✅ Post-Deployment Checklist

After successful deployment:

- [ ] Test all features in production
- [ ] Verify API key is not exposed (check browser DevTools)
- [ ] Set up uptime monitoring
- [ ] Configure custom domain (if applicable)
- [ ] Add SSL certificate (usually automatic)
- [ ] Test on multiple devices/browsers
- [ ] Monitor initial usage and errors
- [ ] Set up analytics tracking
- [ ] Document your deployment configuration
- [ ] Create backup of environment variables
- [ ] Test error scenarios (invalid inputs, network errors)
- [ ] Verify rate limiting works correctly

---

## 🎉 Deployment Complete!

Your GeoIntelliSense application is now live and secure. Monitor your application and gather user feedback to guide future improvements.

**Next Steps:**
1. Share your deployment URL
2. Gather user feedback
3. Monitor error rates and performance
4. Plan future enhancements based on usage

For questions or issues, create a GitHub issue or consult the platform-specific documentation.
