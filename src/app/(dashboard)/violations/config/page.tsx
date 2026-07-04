'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';

interface ViolationReason {
  id: number;
  name: string;
  builtin: boolean;
  notificationTemplate: string;
  createdAt: string;
}

export default function ViolationConfigPage() {
  const [reasons, setReasons] = useState<ViolationReason[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editingReason, setEditingReason] = useState<ViolationReason | null>(null);
  const [formName, setFormName] = useState('');
  const [formTemplate, setFormTemplate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchReasons = useCallback(async () => {
    try {
      const data = await api.get<ViolationReason[]>('/violation-reasons');
      setReasons(data);
    } catch {
      toast.error('获取违规原因列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReasons();
  }, [fetchReasons]);

  const openAdd = () => {
    setEditingReason(null);
    setFormName('');
    setFormTemplate('');
    setEditOpen(true);
  };

  const openEdit = (reason: ViolationReason) => {
    setEditingReason(reason);
    setFormName(reason.name);
    setFormTemplate(reason.notificationTemplate || '');
    setEditOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error('请输入原因名称');
      return;
    }

    setSubmitting(true);
    try {
      if (editingReason) {
        await api.put(`/violation-reasons/${editingReason.id}`, {
          name: formName.trim(),
          notificationTemplate: formTemplate,
        });
        toast.success('已更新');
      } else {
        await api.post('/violation-reasons', {
          name: formName.trim(),
          notificationTemplate: formTemplate,
        });
        toast.success('已添加');
      }
      setEditOpen(false);
      fetchReasons();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (reason: ViolationReason) => {
    if (!confirm(`确定删除 "${reason.name}" 吗？`)) return;

    try {
      await api.delete(`/violation-reasons/${reason.id}`);
      toast.success('已删除');
      fetchReasons();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">违规配置</h2>
        <Button size="sm" onClick={openAdd}>
          <Plus className="size-3.5" />
          添加原因
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : reasons.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400">
          暂无违规原因配置
        </div>
      ) : (
        <div className="space-y-3">
          {reasons.map((reason) => (
            <Card key={reason.id} className="bg-white border-gray-200">
              <CardContent className="flex items-start justify-between pt-4">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{reason.name}</span>
                    {reason.builtin && (
                      <Badge variant="outline" className="text-xs">
                        内置
                      </Badge>
                    )}
                  </div>
                  {reason.notificationTemplate && (
                    <p className="text-xs text-gray-500 line-clamp-2">
                      通知模板: {reason.notificationTemplate}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => openEdit(reason)}>
                    <Pencil className="size-3.5 text-gray-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(reason)}
                  >
                    <Trash2 className="size-3.5 text-red-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Add Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingReason ? '编辑违规原因' : '添加违规原因'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>原因名称</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如: 发布广告"
              />
            </div>
            <div className="space-y-2">
              <Label>通知模板</Label>
              <Textarea
                value={formTemplate}
                onChange={(e) => setFormTemplate(e.target.value)}
                rows={4}
                placeholder="留空则使用默认模板..."
              />
              <p className="text-xs text-gray-400">
                支持变量: {'{用户昵称}'}, {'{帖子标题}'}, {'{帖子链接}'}, {'{违规原因}'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} type="button">
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} type="button">
              {submitting && <Loader2 className="animate-spin" />}
              {submitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
