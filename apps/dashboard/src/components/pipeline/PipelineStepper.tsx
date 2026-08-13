import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface StepperNode {
	id: string;
	label: string;
	href?: string;
}

/**
 * blog and content-intelligence are two independent front doors that both
 * feed the SAME downstream chain (see [[project-blog-pipeline-v01]]'s
 * 2026-08-11 restructure) — shown side by side as two entry points rather
 * than picking one, since this stepper doesn't know which workflow produced
 * whatever run the current page is looking at.
 */
const ENTRY_NODES: StepperNode[] = [
	{ id: 'blog', label: 'Topic Finder', href: '/departments/blog' },
	{ id: 'content-intelligence', label: 'Content Intelligence', href: '/departments/content-intelligence' },
];

const DOWNSTREAM_NODES: StepperNode[] = [
	{ id: 'research-agent', label: 'Research Agent', href: '/departments/research-agent' },
	{ id: 'content', label: 'Content', href: '/departments/content' },
	{ id: 'blog-agent', label: 'Blog Agent', href: '/departments/blog-agent' },
	{ id: 'live', label: 'Live on bullorbear.in' },
];

function StepChip({ node, active }: { node: StepperNode; active: boolean }) {
	const classes = active
		? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
		: 'bg-white/60 text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900/40 dark:text-neutral-400 dark:hover:bg-neutral-800';

	if (!node.href) {
		return (
			<span className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${classes}`}>{node.label}</span>
		);
	}
	return (
		<Link href={node.href} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${classes}`}>
			{node.label}
		</Link>
	);
}

/**
 * Shown at the top of every pipeline-stage department page so it's always
 * visible that a run doesn't stop after topic approval — it keeps moving
 * through Research -> Content -> Blog Agent -> live, automatically, with
 * only two human approval gates (topic, draft) along the way.
 */
export function PipelineStepper({ currentId }: { currentId: string }) {
	return (
		<div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-neutral-200 bg-white/60 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
			<span className="px-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Pipeline</span>
			{ENTRY_NODES.map((node, i) => (
				<span key={node.id} className="flex items-center gap-1.5">
					<StepChip node={node} active={node.id === currentId} />
					{i === ENTRY_NODES.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-700" />}
					{i < ENTRY_NODES.length - 1 && <span className="text-[10px] text-neutral-400">or</span>}
				</span>
			))}
			{DOWNSTREAM_NODES.map((node, i) => (
				<span key={node.id} className="flex items-center gap-1.5">
					<StepChip node={node} active={node.id === currentId} />
					{i < DOWNSTREAM_NODES.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-700" />}
				</span>
			))}
		</div>
	);
}
