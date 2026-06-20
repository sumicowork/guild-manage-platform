const API_BASE = '/api';

class ApiClient {
  private token: string | null = null;

  setToken(t: string) {
    this.token = t;
    localStorage.setItem('token', t);
  }

  getToken(): string | null {
    return this.token || (typeof window !== 'undefined' ? localStorage.getItem('token') : null);
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') localStorage.removeItem('token');
  }

  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    if (res.status === 401) {
      this.clearToken();
      if (typeof window !== 'undefined') window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(e.error || 'Request failed');
    }

    const json = await res.json();

    // 解包服务端 success() 的 { success: true, data: ... } 包装
    if (json && json.success === true && 'data' in json) {
      // 数组 data + 有分页字段 → 分页响应，保留结构
      if (Array.isArray(json.data) && ('page' in json || 'total' in json)) {
        const { success, ...rest } = json;
        return rest as T;
      }
      // 其他情况（对象 data 或纯数组）：直接解包
      return json.data as T;
    }

    return json as T;
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
