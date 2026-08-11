import {
  BarChart3,
  Building2,
  Compass,
  FileText,
  FlaskConical,
  Handshake,
  Megaphone,
  Microscope,
  Palette,
  Rocket,
  Search,
  Settings2,
  Share2,
  Sparkles,
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
    description: 'Tracks competitors, hooks, and emerging trends before they peak — feeds Research with ranked opportunity signals.',
    status: 'active',
    color: '#d946ef',
    icon: TrendingUp,
  },
  {
    id: 'content-intelligence',
    name: 'Content Intelligence',
    description:
      '4 independent search engines — Blog Topic, YouTube Viral, Instagram Viral, and Content Strategy — run on demand, one at a time; only the search you run gives results. Content Strategy is the richer front door into the Blog pipeline.',
    status: 'active',
    color: '#f472b6',
    icon: Sparkles,
  },
  {
    id: 'blog',
    name: 'Topic Finder',
    description:
      'Stage 1 of the blog pipeline: searches for and scores a batch of topic candidates for your approval, then hands the approved one to the Research Agent.',
    status: 'active',
    color: '#fb923c',
    icon: Compass,
  },
  {
    id: 'research-agent',
    name: 'Research Agent',
    description:
      'Stage 2: deep-dives the approved topic — facts, statistics, expert quotes, counterargument, and a recommended structure — then hands it to the Content Agent. Runs automatically, no approval needed.',
    status: 'active',
    color: '#8b5cf6',
    icon: FlaskConical,
  },
  {
    id: 'content',
    name: 'Content',
    description:
      "Stage 3: writes the hook-first draft from the Research Agent's pack. Your approval here sends it on to the Blog Agent.",
    status: 'active',
    color: '#f59e0b',
    icon: FileText,
  },
  {
    id: 'blog-agent',
    name: 'Blog Agent',
    description:
      'Stage 4: renders the approved draft as a final page preview, then commits and pushes it live to bullorbear.in.',
    status: 'active',
    color: '#22c55e',
    icon: Rocket,
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
