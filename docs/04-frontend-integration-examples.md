# Frontend Integration Examples

Complete React + TypeScript examples for integrating with the auth service.

## 1. Auth Context Provider

```typescript
// src/contexts/AuthContext.tsx
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import api, { setTokens } from '../lib/api';

interface User {
  id: string;
  email: string;
  role: 'user' | 'provider' | 'admin';
  permissions: string[];
  emailVerified: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Decode JWT to get user info
  const decodeAndSetUser = useCallback((accessToken: string, refreshToken: string) => {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    setTokens(accessToken, refreshToken);
    setUser({
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions || [],
      emailVerified: true, // If they got a token, they logged in
    });
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    const refresh = localStorage.getItem('refreshToken');
    if (refresh) {
      api.post('/auth/refresh', { refreshToken: refresh })
        .then(({ data }) => {
          localStorage.setItem('refreshToken', data.data.refreshToken);
          decodeAndSetUser(data.data.accessToken, data.data.refreshToken);
        })
        .catch(() => {
          localStorage.removeItem('refreshToken');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [decodeAndSetUser]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('refreshToken', data.data.refreshToken);
    decodeAndSetUser(data.data.accessToken, data.data.refreshToken);
  }, [decodeAndSetUser]);

  const register = useCallback(async (registerData: RegisterData) => {
    const { data } = await api.post('/auth/register', registerData);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    decodeAndSetUser(data.data.accessToken, data.data.refreshToken);
  }, [decodeAndSetUser]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch { /* ignore */ }
    localStorage.removeItem('refreshToken');
    setTokens('', '');
    setUser(null);
  }, []);

  const hasPermission = useCallback((permission: string) => {
    return user?.permissions.includes(permission) ?? false;
  }, [user]);

  const hasRole = useCallback((role: string) => {
    return user?.role === role;
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      register,
      logout,
      hasPermission,
      hasRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
```

## 2. Login Page

```typescript
// src/pages/LoginPage.tsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 423) {
        setError('Account locked. Try again in 15 minutes.');
      } else if (status === 429) {
        setError('Too many attempts. Please wait.');
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
```

## 3. Registration Page

```typescript
// src/pages/RegisterPage.tsx
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    email: '', password: '', firstName: '', lastName: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      await register(form);
      // Navigate to email verification page
    } catch (err: any) {
      const data = err.response?.data;

      // Handle validation errors
      if (data?.type === 'validation') {
        const fieldErrors: Record<string, string> = {};
        for (const error of data.errors) {
          fieldErrors[error.path[0]] = error.message;
        }
        setErrors(fieldErrors);
        return;
      }

      // Handle duplicate email
      if (err.response?.status === 409) {
        setErrors({ email: 'An account with this email already exists' });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <input
          type="text" placeholder="First Name"
          value={form.firstName}
          onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))}
        />
        {errors.firstName && <span className="error">{errors.firstName}</span>}
      </div>
      <div>
        <input
          type="text" placeholder="Last Name"
          value={form.lastName}
          onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))}
        />
      </div>
      <div>
        <input
          type="email" placeholder="Email"
          value={form.email}
          onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
        />
        {errors.email && <span className="error">{errors.email}</span>}
      </div>
      <div>
        <input
          type="password" placeholder="Password"
          value={form.password}
          onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
        />
        {errors.password && <span className="error">{errors.password}</span>}
        <small>
          Min 8 chars, uppercase, lowercase, number, special character
        </small>
      </div>
      <button type="submit">Create Account</button>
    </form>
  );
}
```

## 4. Protected Route Component

```typescript
// src/components/ProtectedRoute.tsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  children: React.ReactNode;
  requiredRole?: 'user' | 'provider' | 'admin';
  requiredPermission?: string;
}

export function ProtectedRoute({ children, requiredRole, requiredPermission }: Props) {
  const { isAuthenticated, isLoading, hasRole, hasPermission } = useAuth();

  if (isLoading) return <div>Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (requiredRole && !hasRole(requiredRole)) return <Navigate to="/unauthorized" />;
  if (requiredPermission && !hasPermission(requiredPermission)) return <Navigate to="/unauthorized" />;

  return <>{children}</>;
}

// Usage in router:
// <Route path="/admin" element={
//   <ProtectedRoute requiredRole="admin">
//     <AdminDashboard />
//   </ProtectedRoute>
// } />
```

## 5. GDPR Consent Banner

```typescript
// src/components/ConsentBanner.tsx
import { useEffect, useState } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const REQUIRED_CONSENTS = ['terms_of_service', 'privacy_policy'];

export function ConsentBanner() {
  const { isAuthenticated } = useAuth();
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    if (!isAuthenticated) return;

    api.get('/auth/consents').then(({ data }) => {
      const granted = data.data
        .filter((c: any) => c.granted)
        .map((c: any) => c.consent_type);

      const notGranted = REQUIRED_CONSENTS.filter(t => !granted.includes(t));
      setMissing(notGranted);
    });
  }, [isAuthenticated]);

  if (missing.length === 0) return null;

  const handleAccept = async () => {
    for (const type of missing) {
      await api.post('/auth/consents', {
        consentType: type,
        granted: true,
        version: '1.0',
      });
    }
    setMissing([]);
  };

  return (
    <div className="consent-banner">
      <p>Please accept our Terms of Service and Privacy Policy to continue.</p>
      <button onClick={handleAccept}>Accept All</button>
    </div>
  );
}
```

## 6. Session Manager (Settings Page)

```typescript
// src/components/SessionManager.tsx
import { useEffect, useState } from 'react';
import api from '../lib/api';

interface Session {
  id: string;
  ip_address: string;
  user_agent: string;
  last_used_at: string;
  created_at: string;
}

export function SessionManager() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    api.get('/auth/sessions').then(({ data }) => setSessions(data.data));
  }, []);

  const revokeSession = async (id: string) => {
    await api.delete(`/auth/sessions/${id}`);
    setSessions(s => s.filter(session => session.id !== id));
  };

  const revokeAll = async () => {
    await api.post('/auth/logout-all');
    // User will be logged out — redirect to login
    window.location.href = '/login';
  };

  return (
    <div>
      <h3>Active Sessions ({sessions.length})</h3>
      {sessions.map(s => (
        <div key={s.id}>
          <span>{s.ip_address} — {s.user_agent?.slice(0, 50)}</span>
          <span>Last active: {new Date(s.last_used_at).toLocaleString()}</span>
          <button onClick={() => revokeSession(s.id)}>Revoke</button>
        </div>
      ))}
      <button onClick={revokeAll}>Sign Out All Devices</button>
    </div>
  );
}
```
