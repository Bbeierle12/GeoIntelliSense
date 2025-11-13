# Security Considerations

## Critical Security Issues

### 1. API Key Exposure (HIGH PRIORITY)

**Current Issue:**
The Gemini API key is currently embedded in the client-side JavaScript bundle through environment variables. This makes it accessible to anyone who inspects the browser's network traffic, DevTools, or JavaScript bundle.

**Location:**
- `vite.config.ts` lines 14-15: API key embedded in build output
- `components/MapView.tsx` line 327: API key in URL string
- `services/geminiService.ts` line 10: API key passed directly to client

**Why This Is Dangerous:**
- API keys in client-side code can be extracted by anyone
- Attackers can use your API key to make unauthorized requests
- This can lead to unexpected charges on your Google Cloud account
- API quota abuse
- Potential service disruption

**Recommended Solution: Backend API Proxy**

To properly secure your API keys, you should implement a backend server that acts as a proxy between your frontend and the Gemini API.

#### Option 1: Node.js/Express Backend

1. **Create a simple Express server:**

```bash
npm install express cors dotenv
```

```javascript
// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Kept server-side only

// Proxy endpoint for Gemini API
app.post('/api/gemini/chat', async (req, res) => {
  try {
    const { message } = req.body;

    // Validate input
    if (!message || message.length > 5000) {
      return res.status(400).json({ error: 'Invalid message' });
    }

    // Forward request to Gemini API with server-side API key
    const response = await fetch('https://generativelanguage.googleapis.com/...', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Your Gemini API request
        // Include API key in URL or headers (server-side only)
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
```

2. **Update your frontend to call the proxy instead:**

```typescript
// services/geminiService.ts (Updated)
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const getChatResponse = async (message: string): Promise<string> => {
  const response = await fetch(`${API_BASE_URL}/api/gemini/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    throw new Error('Failed to get response from API');
  }

  const data = await response.json();
  return data.text;
};
```

3. **Update your environment variables:**

```bash
# .env.local (Frontend - no API key!)
VITE_API_URL=http://localhost:3001

# .env (Backend - API key stored here)
GEMINI_API_KEY=your_actual_api_key_here
PORT=3001
```

4. **Update vite.config.ts to remove API key:**

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  define: {
    // Remove the API key definition
    // 'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY) // DELETE THIS
  }
});
```

#### Option 2: Serverless Functions (Vercel, Netlify, AWS Lambda)

If you're deploying to a platform like Vercel or Netlify, you can use serverless functions:

**Example for Vercel:**

```typescript
// api/gemini.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message } = req.body;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Server-side only

  try {
    // Call Gemini API with server-side key
    const response = await fetch('https://generativelanguage.googleapis.com/...', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Include API key here
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
```

### 2. Input Validation

**Status:** ✅ FIXED

Input validation has been added to:
- MapView search functionality (2-100 characters)
- AnalysisView prompt inputs (2-5000 characters)
- AnalysisView custom factors (max 2000 characters)

### 3. XSS Prevention

**Status:** ✅ FIXED

The `dangerouslySetInnerHTML` usage in `AnalysisView.tsx` has been replaced with safe text rendering using `<pre>` tags.

## Additional Security Recommendations

### 1. Content Security Policy (CSP)

Add CSP headers to prevent XSS attacks:

```html
<!-- index.html -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self' 'unsafe-inline' https://maps.googleapis.com;
               style-src 'self' 'unsafe-inline';
               img-src 'self' data: https:;
               connect-src 'self' https://maps.googleapis.com https://generativelanguage.googleapis.com;">
```

### 2. Rate Limiting

Implement rate limiting on your backend proxy to prevent abuse:

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### 3. Authentication (Future Enhancement)

For production deployment, consider adding user authentication:
- OAuth 2.0 (Google, GitHub)
- JWT tokens
- Session management

### 4. HTTPS Only

Always use HTTPS in production:
- Prevents man-in-the-middle attacks
- Required for geolocation API
- Protects data in transit

### 5. Dependency Security

Regularly audit dependencies for vulnerabilities:

```bash
npm audit
npm audit fix
```

Consider using:
- Snyk (https://snyk.io/)
- Dependabot (GitHub)

## Incident Response

If you suspect your API key has been compromised:

1. **Immediately revoke the compromised key** in Google Cloud Console
2. **Generate a new API key**
3. **Review API usage logs** for unauthorized access
4. **Update all services** with the new key
5. **Monitor for unusual activity**

## Security Checklist

- [ ] Move API key to backend proxy server
- [ ] Remove API key from client-side code
- [ ] Implement rate limiting
- [ ] Add authentication for production
- [ ] Enable HTTPS for production deployment
- [ ] Set up Content Security Policy
- [ ] Regular dependency audits
- [ ] Monitor API usage and costs
- [ ] Implement error tracking (Sentry)
- [ ] Set up logging and monitoring

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Google Cloud API Security Best Practices](https://cloud.google.com/docs/security/best-practices-for-securing-apis)
- [React Security Best Practices](https://react.dev/learn/security)

## Reporting Security Issues

If you discover a security vulnerability, please email security@[yourdomain].com. Do not open a public issue.
