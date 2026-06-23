'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { DataTable, Column } from '@/components/DataTable';
import { MemberDetailDialog } from '@/components/MemberDetailDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
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
  const [sortField, setSortField] = useState('joinedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const pageSize = 20;

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort: sortField,
        direction: sortDir,
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
  }, [page, search, statusFilter, tagFilter, sortField, sortDir]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleRowClick = (member: Member) => {
    setSelectedMember(member);
    setDetailOpen(true);
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
            <span className="text-sm">{{ '': '全部状态', active: '活跃', left: '已离开' }[statusFilter] || '全部状态'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="active">活跃</SelectItem>
            <SelectItem value="left">已离开</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={(v) => { setTagFilter(v ?? ''); setPage(1); }}>
          <SelectTrigger>
            <span className="text-sm">{tagFilter || '全部标签'}</span>
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
        <Select value={sortField} onValueChange={(v) => { setSortField(v ?? 'joinedAt'); setPage(1); }}>
          <SelectTrigger className="w-[120px]">
            <span className="text-sm">{{ joinedAt: '按加入时间', feedCount: '按发帖', commentCount: '按评论' }[sortField] || '排序'}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="joinedAt">按加入时间</SelectItem>
            <SelectItem value="feedCount">按发帖</SelectItem>
            <SelectItem value="commentCount">按评论</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); }}
          className="text-xs"
        >
          {sortDir === 'desc' ? '↓ 降序' : '↑ 升序'}
        </Button>
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
      <MemberDetailDialog
        tinyid={selectedMember?.tinyid ?? null}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
