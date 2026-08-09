import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ResearchAgentOutputSchema, type ResearchAgentOutput } from '@ai-company/shared-types';

const MAX_STORED_RUNS = 50;

const dataDir = path.join(process.cwd(), 'data');
const runsFile = path.join(dataDir, 'research-runs.json');

const StoredRunsSchema = z.array(ResearchAgentOutputSchema);

async function readRuns(): Promise<ResearchAgentOutput[]> {
  let raw: string;
  try {
    raw = await fs.readFile(runsFile, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return StoredRunsSchema.parse(JSON.parse(raw));
}

export async function listResearchRuns(): Promise<ResearchAgentOutput[]> {
  const runs = await readRuns();
  return [...runs].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function saveResearchRun(run: ResearchAgentOutput): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const runs = await readRuns();
  runs.push(run);
  const trimmed = runs.slice(-MAX_STORED_RUNS);
  await fs.writeFile(runsFile, JSON.stringify(trimmed, null, 2), 'utf-8');
}
