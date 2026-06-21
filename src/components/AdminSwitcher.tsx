'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown, Shield } from 'lucide-react';
import { toast } from 'sonner';

interface AdminIdentity {
  id: number;
  name: string;
}

interface AdminSwitcherProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function AdminSwitcher({ selectedId, onSelect }: AdminSwitcherProps) {
  const [identities, setIdentities] = useState<AdminIdentity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIdentities();
  }, []);

  const fetchIdentities = async () => {
    try {
      const data = await api.get<AdminIdentity[]>('/admin-identities');
      setIdentities(data);
      if (data.length > 0 && !selectedId) {
        onSelect(data[0].id);
      }
    } catch (err) {
      toast.error('获取管理身份失败');
    } finally {
      setLoading(false);
    }
  };

  const selected = identities.find((i) => i.id === selectedId);

  if (loading) {
    return (
      <Button variant="outline" size="sm" disabled>
        加载中...
      </Button>
    );
  }

  if (identities.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Shield className="size-3.5" />
        <span>无管理身份</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <Button variant="outline" size="sm" className="gap-1.5" {...props}>
            <Shield className="size-3.5" />
            <span className="max-w-[120px] truncate">{selected?.name || '选择身份'}</span>
            <ChevronDown className="size-3.5" />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" side="bottom">
        <DropdownMenuLabel>管理身份</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {identities.map((identity) => (
          <DropdownMenuItem
            key={identity.id}
            onClick={() => onSelect(identity.id)}
            className={selectedId === identity.id ? 'bg-accent' : ''}
          >
            <span className="truncate">{identity.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
