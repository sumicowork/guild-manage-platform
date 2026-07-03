'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, Users, Shield, Terminal, RefreshCw, ExternalLink } from 'lucide-react';
import AutoRulePanel from './auto-rule-panel';

interface PlatformUser {
  id: number;
  username: string;
  role: string;
  status?: string;
  createdAt: string;
}

interface PendingUser {
  id: number;
  username: string;
  created_at: string;
}

interface AdminIdentity {
  id: number;
  name: string;
  createdAt: string;
}

interface IdentityStatusItem {
  id: number;
  name: string;
  status: 'valid' | 'expired' | 'no_token' | 'error';
  tokenSource: string | null;
  error?: string;
}

interface IdentityStatusResponse {
  identities: IdentityStatusItem[];
  summary: { valid: number; expired: number; noToken: number; error: number };
}

interface CliCheck {
  name: string;
  pass: boolean;
  detail: string;
  hint?: string;
}

interface CliStatus {
  checks: CliCheck[];
  version: string | null;
  loggedIn: boolean;
  loginStatus: { valid?: boolean; tokenSource?: string; message?: string } | null;
  identityName: string | null;
  environment: {
    cliPath: string;
    cliRequestDelayMs: string;
    guildId: string;
  };
}

export default function SettingsPage() {
  // Platform users
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pending approvals
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  // Admin identities
  const [identities, setIdentities] = useState<AdminIdentity[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [addIdentityOpen, setAddIdentityOpen] = useState(false);
  const [newIdentityName, setNewIdentityName] = useState('');

  // CLI status
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);
  const [cliLoading, setCliLoading] = useState(true);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginQrData, setLoginQrData] = useState<{ authUrl: string | null; qrcodeBase64: string | null } | null>(null);
  const [loginPolling, setLoginPolling] = useState(false);
  const [loginTargetIdentityId, setLoginTargetIdentityId] = useState<number | null>(null);

  // Identity status
  const [identityStatuses, setIdentityStatuses] = useState<IdentityStatusItem[]>([]);
  const [identitySummary, setIdentitySummary] = useState({ valid: 0, expired: 0, noToken: 0, error: 0 });
  const [identityStatusLoading, setIdentityStatusLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.get<PlatformUser[]>('/users');
      setUsers(data);
    } catch {
      toast.error('获取用户列表失败');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchIdentities = useCallback(async () => {
    try {
      const data = await api.get<AdminIdentity[]>('/admin-identities');
      setIdentities(data);
    } catch {
      toast.error('获取管理身份失败');
    } finally {
      setIdentitiesLoading(false);
    }
  }, []);

  const fetchCliStatus = useCallback(async () => {
    setCliLoading(true);
    try {
      const data = await api.get<CliStatus>('/cli/status');
      setCliStatus(data);
    } catch {
      toast.error('获取 CLI 状态失败');
    } finally {
      setCliLoading(false);
    }
  }, []);

  const fetchIdentityStatus = useCallback(async () => {
    setIdentityStatusLoading(true);
    try {
      const data = await api.get<IdentityStatusResponse>('/cli/identities/status');
      setIdentityStatuses(data.identities);
      setIdentitySummary(data.summary);
    } catch {
      toast.error('获取身份状态失败');
    } finally {
      setIdentityStatusLoading(false);
    }
  }, []);

  const fetchPendingUsers = useCallback(async () => {
    setPendingLoading(true);
    try {
      const data = await api.get<PendingUser[]>('/auth/register/pending');
      setPendingUsers(data);
    } catch {
      // ignore
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchIdentities();
    fetchCliStatus();
    fetchIdentityStatus();
    fetchPendingUsers();
  }, [fetchUsers, fetchIdentities, fetchCliStatus, fetchIdentityStatus, fetchPendingUsers]);

  const handleAddUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      toast.error('请填写用户名和密码');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/users', { username: newUsername.trim(), password: newPassword });
      toast.success('用户已添加');
      setAddUserOpen(false);
      setNewUsername('');
      setNewPassword('');
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (user: PlatformUser) => {
    if (!confirm(`确定删除用户 "${user.username}" 吗？`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('用户已删除');
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleApprove = async (user: PendingUser) => {
    try {
      await api.post('/auth/register/approve', { userId: user.id });
      toast.success(`已通过 "${user.username}" 的注册申请`);
      fetchPendingUsers();
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '审批失败');
    }
  };

  const handleReject = async (user: PendingUser) => {
    if (!confirm(`确定拒绝 "${user.username}" 的注册申请吗？`)) return;
    try {
      await api.post('/auth/register/reject', { userId: user.id });
      toast.success(`已拒绝 "${user.username}" 的注册申请`);
      fetchPendingUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '拒绝失败');
    }
  };

  const handleAddIdentity = async () => {
    if (!newIdentityName.trim()) {
      toast.error('请填写身份名称');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin-identities', {
        name: newIdentityName.trim(),
      });
      toast.success('管理身份已添加');
      setAddIdentityOpen(false);
      setNewIdentityName('');
      fetchIdentities();
      // 刷新身份状态
      fetchIdentityStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveIdentity = async (identity: AdminIdentity) => {
    if (!confirm(`确定移除身份 "${identity.name}" 吗？`)) return;
    try {
      await api.delete(`/admin-identities/${identity.id}`);
      toast.success('身份已移除');
      fetchIdentities();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除失败');
    }
  };

  // Start CLI login: get QR code data
  // If forIdentityId is provided, the token will be saved to that identity after scan
  const handleStartCliLogin = async (forIdentityId?: number | null) => {
    try {
      const data = await api.post<{
        authUrl: string | null;
        qrcodeBase64: string | null;
        message?: string | null;
        expiresIn?: number | null;
      }>('/cli/login', {});
      setLoginQrData(data);
      setLoginDialogOpen(true);
      // Start polling in background (pass identity explicitly to avoid stale closure)
      handlePollCliLogin(forIdentityId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动 CLI 登录失败');
    }
  };

  // Poll for CLI login completion (blocks until scan or timeout)
  const handlePollCliLogin = async (forIdentityId?: number | null) => {
    setLoginPolling(true);
    try {
      // Use the explicitly passed identity; if none, token stays in default credentials
      const targetId = forIdentityId ?? null;
      const identityParam = targetId ? `?identityId=${targetId}` : '';
      const result = await api.get<{ message: string }>('/cli/login' + identityParam);
      toast.success(result.message || 'CLI 登录成功');
      setLoginDialogOpen(false);
      setLoginQrData(null);
      setLoginTargetIdentityId(null);
      fetchCliStatus();
      fetchIdentityStatus();
    } catch (err) {
      setLoginTargetIdentityId(null);
      if (err instanceof Error && err.message.includes('超时')) {
        toast.error('扫码超时，请重新登录');
      } else {
        toast.error(err instanceof Error ? err.message : '登录未完成');
      }
    } finally {
      setLoginPolling(false);
    }
  };

  // Start login for a specific identity (pass ID directly, no state dependency)
  const handleIdentityLogin = async (identityId: number) => {
    setLoginTargetIdentityId(identityId);
    await handleStartCliLogin(identityId);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">系统设置</h2>

      {/* Platform Users */}
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-gray-500" />
              <div>
                <CardTitle className="text-sm">平台用户</CardTitle>
                <CardDescription>管理平台登录账户</CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={() => setAddUserOpen(true)}>
              <Plus className="size-3.5" />
              添加用户
            </Button>
          </div>
        </CardHeader>
        <Separator className="bg-gray-200" />
        <CardContent className="pt-4">
          {usersLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg bg-gray-200" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-400">暂无用户</p>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">{user.username}</span>
                    <Badge variant="outline" className="text-xs">
                      {user.role}
                    </Badge>
                    {user.status === 'pending' && (
                      <Badge className="text-xs bg-amber-50 text-amber-600 border-amber-200">
                        待审批
                      </Badge>
                    )}
                    {user.status === 'disabled' && (
                      <Badge className="text-xs bg-red-50 text-red-600 border-red-200">
                        已禁用
                      </Badge>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDeleteUser(user)}
                  >
                    <Trash2 className="size-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Approvals */}
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-gray-500" />
            <div>
              <CardTitle className="text-sm">待审批注册</CardTitle>
              <CardDescription>审核用户注册申请</CardDescription>
            </div>
          </div>
        </CardHeader>
        <Separator className="bg-gray-200" />
        <CardContent className="pt-4">
          {pendingLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 rounded-lg bg-gray-200" />
            </div>
          ) : pendingUsers.length === 0 ? (
            <p className="text-sm text-gray-400">暂无待审批的注册申请</p>
          ) : (
            <div className="space-y-2">
              {pendingUsers.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-900">{u.username}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(u.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs text-green-600 border-green-200 hover:bg-green-50"
                        onClick={() => handleApprove(u)}
                      >
                        通过
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs text-red-500 border-red-200 hover:bg-red-50"
                        onClick={() => handleReject(u)}
                      >
                        拒绝
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      {/* Admin Identities */}
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-gray-500" />
              <div>
                <CardTitle className="text-sm">管理身份</CardTitle>
                <CardDescription>管理执行操作时使用的频道身份</CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={() => setAddIdentityOpen(true)}>
              <Plus className="size-3.5" />
              添加身份
            </Button>
          </div>
        </CardHeader>
        <Separator className="bg-gray-200" />
        <CardContent className="pt-4">
          {identitiesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg bg-gray-200" />
              ))}
            </div>
          ) : identities.length === 0 ? (
            <p className="text-sm text-gray-400">暂无管理身份</p>
          ) : (
            <div className="space-y-2">
              {identities.map((identity) => (
                <div
                  key={identity.id}
                  className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-900">{identity.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleRemoveIdentity(identity)}
                  >
                    <Trash2 className="size-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Identity Status */}
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-gray-500" />
              <div>
                <CardTitle className="text-sm">身份有效状态</CardTitle>
                <CardDescription>逐一验证各管理员凭证是否可用</CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchIdentityStatus}
              disabled={identityStatusLoading}
            >
              {identityStatusLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              验证全部
            </Button>
          </div>
        </CardHeader>
        <Separator className="bg-gray-200" />
        <CardContent className="pt-4">
          {identityStatusLoading && identityStatuses.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg bg-gray-200" />
              ))}
            </div>
          ) : identityStatuses.length === 0 ? (
            <p className="text-sm text-gray-400">暂无管理身份，请先添加</p>
          ) : (
            <div className="space-y-2">
              {identityStatuses.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        item.status === 'valid' ? 'bg-green-500' :
                        item.status === 'expired' || item.status === 'no_token' ? 'bg-red-500' :
                        'bg-yellow-500'
                      }`}
                    />
                    <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'valid' && (
                      <Badge className="text-xs bg-green-50 text-green-600 border-green-200">
                        {item.tokenSource === 'dotenv' ? '凭证文件' : '已认证'}
                      </Badge>
                    )}
                    {item.status === 'expired' && (
                      <>
                        <Badge className="text-xs bg-red-50 text-red-600 border-red-200">
                          已过期
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleIdentityLogin(item.id)}
                        >
                          <ExternalLink className="size-3 mr-1" />
                          重新登录
                        </Button>
                      </>
                    )}
                    {item.status === 'no_token' && (
                      <>
                        <Badge className="text-xs bg-gray-100 text-gray-500 border-gray-200">
                          未登录
                        </Badge>
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          onClick={() => handleIdentityLogin(item.id)}
                        >
                          <ExternalLink className="size-3 mr-1" />
                          扫码登录
                        </Button>
                      </>
                    )}
                    {item.status === 'error' && (
                      <>
                        <span className="text-xs text-yellow-600 truncate max-w-[160px]" title={item.error}>
                          {item.error || '验证异常'}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleIdentityLogin(item.id)}
                        >
                          <ExternalLink className="size-3 mr-1" />
                          重新登录
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {/* Summary row */}
              <div className="pt-2 flex items-center gap-3 text-xs text-gray-400">
                <span>有效 <strong className="text-green-600">{identitySummary.valid}</strong></span>
                <span>过期 <strong className="text-red-600">{identitySummary.expired}</strong></span>
                <span>未登录 <strong className="text-gray-500">{identitySummary.noToken}</strong></span>
                {identitySummary.error > 0 && (
                  <span>异常 <strong className="text-yellow-600">{identitySummary.error}</strong></span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Auto Rules */}
      <AutoRulePanel />

      {/* CLI Tool Status */}
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-gray-500" />
              <div>
                <CardTitle className="text-sm">CLI 工具</CardTitle>
                <CardDescription>检查 CLI 运行环境与频道认证状态</CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCliStatus}
              disabled={cliLoading}
            >
              {cliLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              刷新
            </Button>
          </div>
        </CardHeader>
        <Separator className="bg-gray-200" />
        <CardContent className="pt-4">
          {cliLoading && !cliStatus ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 rounded-lg bg-gray-200" />
              ))}
            </div>
          ) : cliStatus ? (
            <div className="space-y-4">
              {/* Diagnostic checks */}
              <div className="space-y-1.5">
                {cliStatus.checks.length > 0 ? (
                  cliStatus.checks.map((check, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2.5 rounded-lg bg-gray-100 px-3 py-2"
                    >
                      <span
                        className={`mt-1 inline-block size-2 shrink-0 rounded-full ${
                          check.pass ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {check.name}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              check.pass
                                ? 'text-green-600 border-green-200 bg-green-50'
                                : 'text-red-600 border-red-200 bg-red-50'
                            }`}
                          >
                            {check.pass ? '通过' : '异常'}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500">{check.detail}</p>
                        {check.hint && (
                          <p className="text-xs text-gray-400 italic">{check.hint}</p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-400">无法获取诊断信息</p>
                )}
              </div>

              <Separator className="bg-gray-200" />

              {/* Login status + action */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block size-2 rounded-full ${
                      cliStatus.loggedIn ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-sm text-gray-700">
                    {cliStatus.loggedIn ? '已认证' : '未认证'}
                  </span>
                  {cliStatus.identityName && (
                    <span className="text-xs text-gray-400">
                      (身份: {cliStatus.identityName})
                    </span>
                  )}
                  {cliStatus.loginStatus?.tokenSource && (
                    <span className="text-xs text-gray-400">
                      ({cliStatus.loginStatus.tokenSource})
                    </span>
                  )}
                  {cliStatus.version && (
                    <Badge variant="outline" className="text-xs text-gray-500">
                      v{cliStatus.version}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={cliStatus.loggedIn ? 'outline' : 'default'}
                  onClick={() => handleStartCliLogin()}
                >
                  {cliStatus.loggedIn ? '重新登录' : '扫码登录'}
                </Button>
              </div>

              <Separator className="bg-gray-200" />

              {/* Environment info */}
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-gray-400">CLI_PATH</span>
                  <p className="font-mono text-gray-600">{cliStatus.environment.cliPath}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-gray-400">GUILD_ID</span>
                  <p className="font-mono text-gray-600">{cliStatus.environment.guildId}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-gray-400">REQUEST_DELAY</span>
                  <p className="font-mono text-gray-600">{cliStatus.environment.cliRequestDelayMs}ms</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">获取状态失败</p>
          )}
        </CardContent>
      </Card>

      {/* CLI Login QR Dialog */}
      <Dialog
        open={loginDialogOpen}
        onOpenChange={(open) => {
          setLoginDialogOpen(open);
          if (!open) {
            setLoginQrData(null);
            setLoginPolling(false);
            setLoginTargetIdentityId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>扫码登录 CLI</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center space-y-4">
            {loginQrData?.qrcodeBase64 ? (
              <img
                src={
                  loginQrData.qrcodeBase64.startsWith('data:')
                    ? loginQrData.qrcodeBase64
                    : `data:image/png;base64,${loginQrData.qrcodeBase64}`
                }
                alt="登录二维码"
                className="size-48 rounded-lg border border-gray-200"
              />
            ) : (
              <div className="flex size-48 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                <span className="text-xs text-gray-400">二维码加载中...</span>
              </div>
            )}
            {loginQrData?.authUrl && (
              <a
                href={loginQrData.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <ExternalLink className="size-3" />
                在浏览器中打开授权链接
              </a>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {loginPolling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  等待扫码...
                </>
              ) : (
                <span className="text-gray-400">请使用手机 QQ 扫描二维码完成登录</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLoginDialogOpen(false);
                setLoginQrData(null);
                setLoginPolling(false);
                setLoginTargetIdentityId(null);
              }}
              type="button"
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>添加平台用户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>用户名</Label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="请输入用户名"
              />
            </div>
            <div className="space-y-2">
              <Label>密码</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入密码"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddUserOpen(false)} type="button">
              取消
            </Button>
            <Button onClick={handleAddUser} disabled={submitting} type="button">
              {submitting && <Loader2 className="animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Identity Dialog */}
      <Dialog open={addIdentityOpen} onOpenChange={setAddIdentityOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>添加管理身份</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={newIdentityName}
                onChange={(e) => setNewIdentityName(e.target.value)}
                placeholder="身份名称"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddIdentityOpen(false)} type="button">
              取消
            </Button>
            <Button onClick={handleAddIdentity} disabled={submitting} type="button">
              {submitting && <Loader2 className="animate-spin" />}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
