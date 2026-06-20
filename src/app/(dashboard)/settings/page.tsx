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
import { Plus, Trash2, Loader2, Users, Shield } from 'lucide-react';

interface PlatformUser {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

interface AdminIdentity {
  id: number;
  name: string;
  tinyid: string;
  avatar?: string;
  createdAt: string;
}

export default function SettingsPage() {
  // Platform users
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Admin identities
  const [identities, setIdentities] = useState<AdminIdentity[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [addIdentityOpen, setAddIdentityOpen] = useState(false);
  const [newIdentityName, setNewIdentityName] = useState('');
  const [newIdentityTinyid, setNewIdentityTinyid] = useState('');

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

  useEffect(() => {
    fetchUsers();
    fetchIdentities();
  }, [fetchUsers, fetchIdentities]);

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

  const handleAddIdentity = async () => {
    if (!newIdentityName.trim() || !newIdentityTinyid.trim()) {
      toast.error('请填写名称和 tinyid');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin-identities', {
        name: newIdentityName.trim(),
        tinyid: newIdentityTinyid.trim(),
      });
      toast.success('管理身份已添加');
      setAddIdentityOpen(false);
      setNewIdentityName('');
      setNewIdentityTinyid('');
      fetchIdentities();
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
                    <span className="font-mono text-xs text-gray-400">{identity.tinyid}</span>
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
            <div className="space-y-2">
              <Label>tinyid</Label>
              <Input
                value={newIdentityTinyid}
                onChange={(e) => setNewIdentityTinyid(e.target.value)}
                placeholder="频道账号 tinyid"
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
