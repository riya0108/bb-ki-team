import {
  BarChart3,
  Building2,
  FileText,
  Handshake,
  Megaphone,
  Microscope,
  Newspaper,
  Palette,
  Search,
  Settings2,
  Share2,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export type DepartmentStatus = 'active' | 'planned';

export interface Department {
  id: string;
  name: string;
  description: string;
  status: DepartmentStatus;
  color: string;
  icon: LucideIcon;
}

export const departments: Department[] = [
  {
    id: 'executive',
    name: 'Executive',
    description: 'Company-wide strategy, priorities, and oversight.',
    status: 'planned',
    color: '#94a3b8',
    icon: Building2,
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Finds, clusters, scores, and fact-checks topics on any subject.',
    status: 'active',
    color: '#8b5cf6',
    icon: Microscope,
  },
  {
    id: 'trend-research',
    name: 'Trend Research',
    description: 'Tracks emerging trends across channels and platforms.',
    status: 'planned',
    color: '#d946ef',
    icon: TrendingUp,
  },
  {
    id: 'seo',
    name: 'SEO',
    description: 'Keyword research and search-visibility analysis.',
    status: 'planned',
    color: '#10b981',
    icon: Search,
  },
  {
    id: 'content',
    name: 'Content',
    description: 'Drafts and structures long-form content.',
    status: 'planned',
    color: '#f59e0b',
    icon: FileText,
  },
  {
    id: 'blog',
    name: 'Blog',
    description: 'Publishes blog posts end-to-end.',
    status: 'planned',
    color: '#fb923c',
    icon: Newspaper,
  },
  {
    id: 'social',
    name: 'Social',
    description: 'Plans and schedules social content.',
    status: 'planned',
    color: '#38bdf8',
    icon: Share2,
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Campaign planning and positioning.',
    status: 'planned',
    color: '#fb7185',
    icon: Megaphone,
  },
  {
    id: 'sales',
    name: 'Sales',
    description: 'Pipeline and outreach support.',
    status: 'planned',
    color: '#22d3ee',
    icon: Handshake,
  },
  {
    id: 'design',
    name: 'Design',
    description: 'Visual assets and brand design.',
    status: 'planned',
    color: '#818cf8',
    icon: Palette,
  },
  {
    id: 'operations',
    name: 'Operations',
    description: 'Internal process and workflow operations.',
    status: 'planned',
    color: '#a3e635',
    icon: Settings2,
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Cross-department reporting and metrics.',
    status: 'planned',
    color: '#2dd4bf',
    icon: BarChart3,
  },
];

export function getDepartment(id: string): Department | undefined {
  return departments.find((department) => department.id === id);
}
