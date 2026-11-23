import type { BlogChatDeps } from '@bb/agent-blog';

import type { AppDeps } from './deps.js';

// The Blog agent's view of the app's dependencies: its own Claude-first LLM client
// and Claude research (when configured) in place of the shared free-tier client.
// Shared by the blog routes and the Mac-side Blog worker (blogWorker.ts) so a
// queued message runs with exactly the same setup as an inline one.
export type BlogAgentDeps = AppDeps & BlogChatDeps & { research: NonNullable<BlogChatDeps['research']> };

export function blogAgentDeps(appDeps: AppDeps): BlogAgentDeps {
  const research = { discoveryResearcher: appDeps.blog?.discoveryResearcher, contextBudget: appDeps.blog?.contextBudget };
  return { ...appDeps, llm: appDeps.blog?.llm ?? appDeps.llm, research };
}
