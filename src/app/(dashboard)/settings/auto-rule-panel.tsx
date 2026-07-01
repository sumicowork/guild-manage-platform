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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, Bot, Pencil, Hash } from 'lucide-react';

interface AutoRule {
  id: number;
  name: string;
  targetAuthorId: string;
  targetAuthorName: string | null;
  action: 'delete' | 'move';
  targetChannelId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Channel {
  id: string;
  name: string;
}

export default function AutoRulePanel() {
  const [rules, setRules] = useState<AutoRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoRule | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formAuthorId, setFormAuthorId] = useState('144115220736883034');
  const [formAction, setFormAction] = useState<'delete' | 'move'>('delete');
  const [formChannelId, setFormChannelId] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);

  // Channel name map: id → name
  const channelNameMap = new Map(channels.map((c) => [c.id, c.name]));

  const fetchRules = useCallback(async () => {
    try {
      const data = await api.get<AutoRule[]>('/auto-rules');
      setRules(data);
    } catch {
      toast.error('获取自动规则失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const data = await api.get<Channel[]>('/channels');
      setChannels(data);
    } catch {
      // channels fetch failure is non-critical
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchChannels();
  }, [fetchRules, fetchChannels]);

  const openCreateDialog = () => {
    setEditingRule(null);
    setFormName('');
    setFormAuthorId('144115220736883034');
    setFormAction('delete');
    setFormChannelId('');
    setFormEnabled(true);
    setDialogOpen(true);
  };

  const openEditDialog = (rule: AutoRule) => {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormAuthorId(rule.targetAuthorId);
    setFormAction(rule.action);
    setFormChannelId(rule.targetChannelId || '');
    setFormEnabled(rule.enabled);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !formAuthorId.trim()) {
      toast.error('请填写规则名称和目标作者ID');
      return;
    }
    if (formAction === 'move' && !formChannelId.trim()) {
      toast.error('移帖操作必须选择目标版块');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: formName.trim(),
        targetAuthorId: formAuthorId.trim(),
        action: formAction,
        targetChannelId: formAction === 'move' ? formChannelId.trim() : null,
        enabled: formEnabled,
      };

      if (editingRule) {
        await api.put(`/auto-rules/${editingRule.id}`, body);
        toast.success('规则已更新');
      } else {
        await api.post('/auto-rules', body);
        toast.success('规则已创建');
      }

      setDialogOpen(false);
      fetchRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (rule: AutoRule) => {
    if (!confirm(`确定删除规则 "${rule.name}" 吗？`)) return;
    try {
      await api.delete(`/auto-rules/${rule.id}`);
      toast.success('规则已删除');
      fetchRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggle = async (rule: AutoRule) => {
    try {
      await api.put(`/auto-rules/${rule.id}`, { enabled: !rule.enabled });
      fetchRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败');
    }
  };

  const actionLabel = (action: string) => (action === 'delete' ? '删除帖子' : '移帖');
  const actionColor = (action: string) =>
    action === 'delete'
      ? 'bg-red-50 text-red-600 border-red-200'
      : 'bg-blue-50 text-blue-600 border-blue-200';

  // Human-readable author display
  const authorDisplay = (rule: AutoRule) => {
    if (rule.targetAuthorName) {
      return rule.targetAuthorName;
    }
    return rule.targetAuthorId;
  };

  return (
    <>
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-gray-500" />
              <div>
                <CardTitle className="text-sm">自动规则</CardTitle>
                <CardDescription>
                  增量爬取时自动处理指定 bot 的帖子（删除或移帖）
                </CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="size-3.5" />
              添加规则
            </Button>
          </div>
        </CardHeader>
        <Separator className="bg-gray-200" />
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg bg-gray-200" />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <p className="text-sm text-gray-400">
              暂无自动规则。添加一条规则，指定特定作者ID的帖子在增量爬取时自动删帖或移帖。
            </p>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{rule.name}</span>
                        <Badge className={`text-xs ${actionColor(rule.action)}`}>
                          {actionLabel(rule.action)}
                        </Badge>
                        {rule.action === 'move' && rule.targetChannelId && (
                          <Badge variant="outline" className="text-xs">
                            移至「{channelNameMap.get(rule.targetChannelId) ?? rule.targetChannelId}」
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">
                        作者: {authorDisplay(rule)}
                        {rule.targetAuthorName && (
                          <span className="text-gray-300 ml-1">({rule.targetAuthorId})</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={() => handleToggle(rule)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => openEditDialog(rule)}
                      title="编辑"
                    >
                      <Pencil className="size-3.5 text-gray-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDelete(rule)}
                      title="删除"
                    >
                      <Trash2 className="size-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingRule ? '编辑自动规则' : '添加自动规则'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>规则名称</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder='例如: "自动处理频道助手发帖"'
              />
            </div>
            <div className="space-y-2">
              <Label>目标作者</Label>
              <Input
                value={formAuthorId}
                onChange={(e) => setFormAuthorId(e.target.value)}
                placeholder="tinyid，如 144115220736883034"
              />
              <p className="text-xs text-gray-400">
                与此 tinyid 匹配的帖子将被自动处理
              </p>
            </div>
            <div className="space-y-2">
              <Label>处置动作</Label>
              <Select
                value={formAction}
                onValueChange={(v) => setFormAction(v as 'delete' | 'move')}
              >
                <SelectTrigger>
                  <span className="text-sm">{{ delete: '删除帖子', move: '移帖' }[formAction]}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="delete">删除帖子</SelectItem>
                  <SelectItem value="move">移帖</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formAction === 'move' && (
              <div className="space-y-2">
                <Label>目标版块</Label>
                {channels.length > 0 ? (
                  <Select value={formChannelId} onValueChange={(v) => setFormChannelId(v ?? '')}>
                    <SelectTrigger>
                      <span className="text-sm">{channelNameMap.get(formChannelId) || '选择目标版块...'}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>
                          <span className="flex items-center gap-2">
                            <Hash className="size-3 text-gray-400" />
                            {ch.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={formChannelId}
                    onChange={(e) => setFormChannelId(e.target.value)}
                    placeholder="版块ID（暂无法加载版块列表）"
                  />
                )}
                <p className="text-xs text-gray-400">
                  帖子将被移动到此版块
                </p>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <Label className="text-sm cursor-pointer">启用规则</Label>
              <Switch
                checked={formEnabled}
                onCheckedChange={setFormEnabled}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} type="button">
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} type="button">
              {submitting && <Loader2 className="size-4 animate-spin mr-1" />}
              {editingRule ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
