const API_BASE = '/api';

/**
 * ApiClient — uses httpOnly cookies for auth (set by /api/auth/login).
 *
 * No token is stored in JS memory or localStorage. The browser
 * automatically attaches cookies to same-origin requests.
 *
 * On 401 (access token expired), the client transparently attempts
 * a single /api/auth/refresh call to obtain a new access token via
 * the refresh cookie. If that also fails, the user is redirected to /login.
 */
class ApiClient {
  private refreshing: Promise<boolean> | null = null;

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) ?? {}),
    };

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include', // send httpOnly cookies
    });

    if (res.status === 401) {
      // Try to refresh once. If concurrent requests all hit 401,
      // they share the same refresh promise to avoid stampeding /refresh.
      const refreshed = await this.ensureRefreshing();
      if (refreshed) {
        // Retry the original request with fresh cookies
        const retryRes = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers,
          credentials: 'include',
        });
        return this.parseResponse<T>(retryRes, path);
      }
      // Refresh failed — go to login
      if (typeof window !== 'undefined' && path !== '/auth/login' && path !== '/auth/refresh' && path !== '/auth/session') {
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    return this.parseResponse<T>(res, path);
  }

  private async parseResponse<T>(res: Response, path: string): Promise<T> {
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(e.error || 'Request failed');
    }

    const json = await res.json();

    // Unwrap server success() envelope: { success: true, data: ... }
    if (json && json.success === true && 'data' in json) {
      // Paginated array response — keep structure
      if (Array.isArray(json.data) && ('page' in json || 'total' in json)) {
        const { success: _omit, ...rest } = json;
        return rest as T;
      }
      return json.data as T;
    }

    return json as T;
  }

  /**
   * Coalesces concurrent refresh attempts into a single /auth/refresh call.
   * Returns true if a refresh succeeded (cookies updated), false otherwise.
   */
  private async ensureRefreshing(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        return res.ok;
      } catch {
        return false;
      } finally {
        // Allow future refresh attempts after this one completes
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
