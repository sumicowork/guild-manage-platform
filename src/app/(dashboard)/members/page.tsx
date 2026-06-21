'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { DataTable, Column } from '@/components/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Search, Tag, MoreHorizontal, Plus, X } from 'lucide-react';

interface Member {
  tinyid: string;
  nickname: string;
  role: string;
  joinedAt: string;
  status: string;
  feedCount: number;
  commentCount: number;
  likeCount: number;
  tags: string[];
  avatar?: string;
}

interface MemberListResponse {
  data: Member[];
  total: number;
  page: number;
  pageSize: number;
}

interface MemberHistory {
  feeds: Array<{ id: string; title: string; createdAt: string; status: string }>;
  comments: Array<{ id: string; content: string; createdAt: string; feedTitle: string }>;
  violations: Array<{ id: number; reason: string; actionType: string; createdAt: string }>;
}

const availableTags = ['活跃', '优质创作者', '需注意', '高风险', '版主推荐'];

const statusColors: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  left: 'bg-blue-50 text-blue-600',
};

const statusLabels: Record<string, string> = {
  active: '活跃',
  left: '已离开',
};

const roleLabels: Record<string, string> = {
  owner: '频道主',
  admin: '管理员',
  moderator: '版主',
  member: '成员',
};

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [history, setHistory] = useState<MemberHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const pageSize = 20;

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (tagFilter) params.set('tag', tagFilter);

      const result = await api.get<MemberListResponse>(`/members?${params}`);
      setMembers(result.data);
      setTotal(result.total);
    } catch {
      toast.error('获取成员列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, tagFilter]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleRowClick = async (member: Member) => {
    setSelectedMember(member);
    setDetailOpen(true);
    setHistoryLoading(true);
    try {
      const data = await api.get<MemberHistory>(`/members/${member.tinyid}/history`);
      setHistory(data);
    } catch {
      toast.error('获取成员历史失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleAddTag = async (tinyid: string, tag: string) => {
    try {
      await api.post(`/members/${tinyid}/tags`, { tag });
      toast.success(`已添加标签: ${tag}`);
      fetchMembers();
    } catch {
      toast.error('添加标签失败');
    }
  };

  const handleRemoveTag = async (tinyid: string, tag: string) => {
    try {
      await api.delete(`/members/${tinyid}/tags/${encodeURIComponent(tag)}`);
      toast.success(`已移除标签: ${tag}`);
      fetchMembers();
    } catch {
      toast.error('移除标签失败');
    }
  };

  const columns: Column<Member>[] = [
    { key: 'nickname', header: '昵称', width: '120px' },
    {
      key: 'tinyid',
      header: 'tinyid',
      width: '120px',
      render: (m) => <span className="font-mono text-xs text-gray-500">{m.tinyid}</span>,
    },
    {
      key: 'role',
      header: '角色',
      width: '80px',
      render: (m) => (
        <Badge variant="outline" className="text-xs">
          {roleLabels[m.role] || m.role}
        </Badge>
      ),
    },
    {
      key: 'joinedAt',
      header: '加入时间',
      width: '120px',
      render: (m) => (
        <span className="text-xs text-gray-500">
          {new Date(m.joinedAt).toLocaleDateString('zh-CN')}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      width: '80px',
      render: (m) => (
        <Badge className={statusColors[m.status] || 'bg-gray-200 text-gray-700'}>
          {statusLabels[m.status] || m.status}
        </Badge>
      ),
    },
    {
      key: 'feedCount',
      header: '发帖数',
      width: '70px',
      align: 'center',
      render: (m) => <span className="text-gray-700">{m.feedCount}</span>,
    },
    {
      key: 'commentCount',
      header: '评论数',
      width: '70px',
      align: 'center',
      render: (m) => <span className="text-gray-700">{m.commentCount}</span>,
    },
    {
      key: 'likeCount',
      header: '获赞',
      width: '70px',
      align: 'center',
      render: (m) => <span className="text-gray-700">{m.likeCount}</span>,
    },
    {
      key: 'tags',
      header: '标签',
      width: '160px',
      render: (m) => (
        <div className="flex flex-wrap items-center gap-1">
          {m.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1">
              {tag}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTag(m.tinyid, tag);
                }}
                className="hover:text-red-400"
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <Button {...props} variant="ghost" size="icon-xs" onClick={(e) => e.stopPropagation()}>
                  <Plus className="size-3" />
                </Button>
              )}
            />
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>添加标签</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableTags
                .filter((t) => !m.tags.includes(t))
                .map((tag) => (
                  <DropdownMenuItem
                    key={tag}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddTag(m.tinyid, tag);
                    }}
                  >
                    <Tag className="size-3" />
                    {tag}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: '60px',
      align: 'center',
      render: () => (
        <Button variant="ghost" size="icon-xs">
          <MoreHorizontal className="size-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">成员管理</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="搜索昵称/tinyid..."
            className="w-60 pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="active">活跃</SelectItem>
            <SelectItem value="left">已离开</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={(v) => { setTagFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <SelectValue placeholder="全部标签" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部标签</SelectItem>
            {availableTags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={members}
        loading={loading}
        rowKey={(m) => m.tinyid}
        onRowClick={handleRowClick}
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
        }}
      />

      {/* Member Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{selectedMember?.nickname}</DialogTitle>
            <DialogDescription>
              tinyid: {selectedMember?.tinyid} · {roleLabels[selectedMember?.role || ''] || selectedMember?.role}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1">
            {historyLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-48 bg-gray-200" />
                <Skeleton className="h-20 rounded-lg bg-gray-200" />
                <Skeleton className="h-4 w-48 bg-gray-200" />
                <Skeleton className="h-20 rounded-lg bg-gray-200" />
              </div>
            ) : history ? (
              <div className="space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: '发帖', value: selectedMember?.feedCount },
                    { label: '评论', value: selectedMember?.commentCount },
                    { label: '获赞', value: selectedMember?.likeCount },
                    { label: '违规', value: history.violations.length },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg bg-gray-100 p-3 text-center">
                      <div className="text-lg font-bold text-gray-900">{stat.value}</div>
                      <div className="text-xs text-gray-500">{stat.label}</div>
                    </div>
                  ))}
                </div>

                <Separator className="bg-gray-200" />

                {/* Feed history */}
                <div>
                  <h3 className="mb-2 text-sm font-medium text-gray-700">发帖记录</h3>
                  {history.feeds.length > 0 ? (
                    <div className="space-y-1.5">
                      {history.feeds.slice(0, 10).map((feed) => (
                        <div key={feed.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                          <span className="truncate text-gray-700">{feed.title}</span>
                          <span className="ml-2 shrink-0 text-xs text-gray-400">
                            {new Date(feed.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">暂无发帖</p>
                  )}
                </div>

                {/* Comment history */}
                <div>
                  <h3 className="mb-2 text-sm font-medium text-gray-700">评论记录</h3>
                  {history.comments.length > 0 ? (
                    <div className="space-y-1.5">
                      {history.comments.slice(0, 10).map((comment) => (
                        <div key={comment.id} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                          <p className="truncate text-gray-700">{comment.content}</p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                            <span>帖子: {comment.feedTitle}</span>
                            <span>{new Date(comment.createdAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">暂无评论</p>
                  )}
                </div>

                {/* Violation history */}
                {history.violations.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-red-600">违规记录</h3>
                    <div className="space-y-1.5">
                      {history.violations.map((v) => (
                        <div key={v.id} className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm">
                          <div>
                            <span className="text-gray-700">{v.reason}</span>
                            <span className="ml-2 text-xs text-gray-400">({v.actionType})</span>
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(v.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400">加载失败</p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
