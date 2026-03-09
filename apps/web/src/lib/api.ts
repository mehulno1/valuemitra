import axios, { type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth.store.js';

// ─────────────────────────────────────────────
// Axios instance — attaches JWT, handles 401 refresh
// ─────────────────────────────────────────────

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 — attempt token refresh, then retry original request once
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error: unknown) => {
    const err = error as { response?: { status: number }; config?: AxiosRequestConfig & { _retry?: boolean } };
    const originalRequest = err.config;

    // Skip refresh for auth endpoints — 401 from /auth/login means invalid credentials, not expired token
    const isAuthEndpoint = originalRequest?.url?.includes('/auth/login') ||
      originalRequest?.url?.includes('/auth/register');

    if (err.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            if (!originalRequest.headers) originalRequest.headers = {};
            (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post<{ data: { accessToken: string; refreshToken: string } }>(
          '/api/auth/refresh',
          { refreshToken },
        );

        const { accessToken, refreshToken: newRefreshToken } = data.data;
        useAuthStore.getState().setTokens(accessToken, newRefreshToken);

        refreshQueue.forEach((cb) => cb(accessToken));
        refreshQueue = [];

        if (!originalRequest.headers) originalRequest.headers = {};
        (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        useAuthStore.getState().logout();
        refreshQueue = [];
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);
