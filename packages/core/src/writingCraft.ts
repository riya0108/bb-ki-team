// Platform writing craft — HOW the best writers on each platform actually write, as
// opposed to brandBrain.ts (WHO Bull or Bear is) and the editorial brief (WHAT is
// true). Distilled from the creator's own reference set: X posts by Raj Shamani and
// Vaibhav Sisinty (plus Nikhil Kamath, Kunal Shah, Naval), LinkedIn founder/operator
// voices, and the Substack publications the creator reads (Raj Shamani, Nishant
// Chahar, App Economy Insights, The Economist's Off the Charts, The Free Press) with
// Finshots and Hacker News-grade plain writing.
//
// These are techniques, never templates: no reference writer's wording, signature
// phrases or posts may be reproduced. Every rule sits UNDER the brand's accuracy rules
// (truth > meaning > voice > craft > engagement) — a technique that would need an
// invented fact, a fake personal story or an upgraded certainty is simply not used.

export type CraftPlatform = 'x' | 'linkedin' | 'blog';

export interface CraftExample {
  weak: string;
  strong: string;
  why: string;
}

export interface CraftPlaybook {
  standard: string;
  // What each reference voice is good at, stated as a transferable technique.
  voiceModels: readonly string[];
  formats: readonly string[];
  techniques: readonly string[];
  antiPatterns: readonly string[];
  // Before/after rewrites. Placeholders in [brackets] are filled only from verified
  // claims; the examples teach shape, never facts.
  examples: readonly CraftExample[];
  selfEdit: readonly string[];
}

const X_PLAYBOOK: CraftPlaybook = {
  standard:
    'Write like the sharpest Indian voices on X: a person with a point of view, thinking clearly in public. Every post should be worth a screenshot, a bookmark or a reply. If it reads like a press release, a news ticker or a LinkedIn post chopped into lines, rewrite it. Hard limit: 280 characters per post. When a story needs more room, make it a thread, never a cramped post.',
  voiceModels: [
    'Raj Shamani (the compact insight): one dense paragraph of 2-4 sentences, no line breaks needed. Sentence 1 is a bold universal claim about how people or their brains work. The middle sentences explain the mechanism ("when X happens, your brain starts doing Y"). The last sentence is the reframe or the instruction. Talks to "you" the whole time. Uses three concrete everyday examples in one sentence to make an abstract point land. Often ends on a short maxim that works alone.',
    'Raj Shamani (the diagnosis): "You don\'t have an X problem. You have a Y problem." Renames what the reader thinks is wrong, then explains the real cause in one or two sentences.',
    'Vaibhav Sisinty (the news reframe): line 1 is the twist on the headline, not the headline itself. Often two short lines that collide (what they say it is, then what it really is). Then one fact per line, with blank lines between: who, what, exact specifics (named people, places, levels, prices, dates), and the source named plainly ("X says", "Reuters reports"). Quote-posts the primary source instead of retelling it.',
    'Vaibhav Sisinty (the mini-story): tells news as a sequence of beats. Setup ("The task was simple: ..."), turn ("Instead, ..."), escalation ("Then ..."). A colon reveal pays off a setup ("His definition in three words: ..."). Arrow lines (→) for a run of facts. The last line is a punchy closer or a short comparison.',
    'Nikhil Kamath: understated and curious. Thinks out loud about money, India and how people behave. Calm, never shouts. Often ends on an honest open question instead of a call to action.',
    'Kunal Shah / Naval: one-line observations that name something everyone has seen but nobody has put into words. No wasted words.',
  ],
  formats: [
    'THE COMPACT INSIGHT (single post): claim, then mechanism, then reframe, in 2-4 sentences in one paragraph. Best for behaviour, money psychology and "why people do this" angles.',
    'THE DIAGNOSIS (single post): "You don\'t have an X problem. You have a Y problem." Then one or two sentences on why.',
    'THE NEWS REFRAME (single post or short thread): the twist in line 1, the verified specifics one per line, attribution named, then the so-what or a sharp closer.',
    'THE MINI-STORY THREAD: post 1 is the hook plus the first beat; each later post is one beat (setup, turn, escalation, consequence); the last post is what it means for the reader.',
    'THE NUMBER WITH A PUNCHLINE: one verified number, then what it means for the reader\'s money, job or choices.',
    'WHO REALLY PAYS: something looks free, cheap or generous. Follow the money until the reader sees who pays.',
    'BULL VS BEAR: the case for, the case against, then a short honest read (clearly a view, not a verdict).',
    'THE ONE-LINER: a single sentence observation that needs no explanation.',
  ],
  techniques: [
    'First sentence: a complete, confident claim, ideally under 15 words. Put the most specific or surprising thing in it. The first line must make sense with nothing after it.',
    'News: open on the twist or the stakes, not on the institution. "Company X announced..." is a weak opener; what the announcement really means is a strong one.',
    'One fact per line in news posts, blank line between. Name the specifics: people, places, ₹ figures, dates, levels, counts. Specifics are what make a post feel informed rather than generic.',
    'Attribute plainly inside the post ("RBI says", "per the filing", "Reuters reports"). Attribution makes a bold claim safe and credible at the same time.',
    'Reflection and insight posts: a single paragraph is fine. Keep sentences short and declarative. Build momentum with a list of three concrete examples, then land on the point.',
    'Explain the mechanism in plain words ("your brain stops noticing what stays constant", "the bank earns when you pay late"). The mechanism is what makes a post feel smart instead of preachy.',
    'Use contrast pivots: "Instead, ...", "But ...", "Then ...", "Not X. Y." One per post is enough.',
    'Colon reveals: set something up, then pay it off after a colon. Use one at most.',
    'Talk to "you". Make the reader the subject of the sentence.',
    'Strong verbs, no adverbs. Cut "really", "very", "basically", "actually", "literally".',
    'Numbers as digits with units. Use ₹ and lakh/crore for Indian money.',
    'End on the strongest line: a maxim, a reframe, an uncomfortable implication or a real question. Never add a sentence after the punchline to explain it.',
    'Threads: post 1 works on its own and makes a specific promise. Every later post opens with its own strong line. The last post is the so-what, not "follow for more".',
    'Opinions are welcome when they are signposted honestly ("My read:", "The bear case:", "I think"). Never dress an opinion up as a fact.',
  ],
  antiPatterns: [
    'Hype openers that oversell, even though some big accounts use them: "has shocked everyone", "What\'s happening here is unreal", "This is insane", "something scary". Let the facts carry the weight. If the story is remarkable, the specifics will show it.',
    'Engagement bait: "Let that sink in", "Read that again", "This is huge", "You won\'t believe", "Agree?", "Thoughts?", "RT if", "Follow for more", "Bookmark this".',
    'Thread clichés: "A thread", "Thread:", the thread emoji, "Here\'s why", "Here\'s what you need to know", "Buckle up", "Let\'s dive in".',
    'Throat-clearing openers: "So,", "Well,", "Interestingly,", "In a recent development", "Did you know", "Have you ever wondered".',
    'Corporate nouns: stakeholders, ecosystem, landscape, solutions, synergy, paradigm.',
    'Self-help sermon: a lecture with no mechanism and no specifics. Every claim about people needs a why.',
    'Repeating the "Not X. It\'s Y." construction more than once in one post.',
    'Hashtags inside the post, emoji bullets, ALL CAPS shouting, or more than one emoji.',
    'Fake experience: "I spent 100 hours...", "I asked 50 founders..." unless the Content DNA records it as true.',
  ],
  examples: [
    {
      weak: 'In a recent development, [Company] has announced a voluntary exit programme for employees, which could impact many workers across several countries.',
      strong: '[Company] is not calling it a layoff.\n\nIt is calling it [their term].\n\n[Who is eligible], in [countries], can [what they get].\n\n[Outlet] reports [verified figure].',
      why: 'Opens on the twist (the name vs. the reality), then one verified specific per line with the source named. Same facts, far more pull.',
    },
    {
      weak: 'Many people struggle to save money because of various psychological and social factors that make it difficult to stay disciplined.',
      strong: 'You don\'t have a savings problem. You have a visibility problem. Money you can see in your account feels like money you are allowed to spend.',
      why: 'The diagnosis format: renames the problem, then gives the mechanism in one plain sentence. No statistic needed, and no fact is invented.',
    },
    {
      weak: 'Here are 7 lessons I learned about investing that everyone should know! 🧵👇',
      strong: '[Verified surprising fact about investors].\n\nMost people read that as [common interpretation].\n\nThe data says something else:',
      why: 'Swaps a generic listicle and a fake personal angle for a specific, checkable tension.',
    },
  ],
  selfEdit: [
    'Does the first sentence work as a screenshot on its own?',
    'News: is line 1 the twist, and is every specific named and attributed?',
    'Insight: is there a mechanism (the why), not just advice?',
    'Delete every line you can lose without losing meaning.',
    'Is the last line the strongest one? Is every post under 280 characters?',
  ],
};

const LINKEDIN_PLAYBOOK: CraftPlaybook = {
  standard:
    'Write like the best Indian founder and operator voices on LinkedIn: insight-dense, story-led, skimmable, and useful to a working professional. Smart and human, never cringe, never corporate.',
  voiceModels: [
    'Nikhil Kamath: candid, curious reflection. Asks the question others skip and admits what is not known.',
    'Kunal Shah: names a pattern in Indian behaviour so precisely that readers want to share it.',
    'Raj Shamani: a clear lesson pulled out of a real story, delivered in short beats.',
    'Ankur Warikoo: relatable money and career lessons in plain language, written straight to "you".',
    'Lenny Rachitsky: frameworks backed by evidence; practical enough to use on Monday.',
  ],
  formats: [
    'THE INSIGHT POST: hook, what happened, the non-obvious detail, why it matters to the reader, implication, takeaway.',
    'THE BREAKDOWN: how a company, policy or product actually makes money or works, step by step.',
    'THE BULL VS BEAR: both cases laid out fairly, then a clearly signposted view.',
    'THE FRAMEWORK: a messy decision turned into 3-5 clear steps or questions, each with a concrete example.',
    'THE MYTH VS REALITY: what most people believe, what the evidence shows, what to do with that.',
  ],
  techniques: [
    'The first two lines (about 200 characters) are all most people see before "see more". Line 1 is the hook; line 2 opens a gap that makes clicking feel necessary.',
    'Paragraphs of one or two sentences. Vary the rhythm: a short punch line after a longer explanatory one.',
    'One pattern interrupt in the middle (a short list, a before/after, or a two-line contrast) so skimmers find the core.',
    'Every abstract point gets a concrete example: a ₹ figure, a company, a city, a salary, a real decision.',
    'Write to one reader ("you"), not an audience ("professionals", "leaders").',
    'Aim for roughly 1,000-1,800 characters. Long enough to teach, short enough to finish.',
    'Close with a takeaway line the reader could repeat to a colleague, then (optionally) one specific question tied to the post, never a generic "Thoughts?".',
  ],
  antiPatterns: [
    'Announcement cringe: "I\'m thrilled to share", "I\'m humbled", "Excited to announce".',
    'Corporate filler: "In today\'s fast-paced world", "As we navigate", "This is a reminder that", "Businesses must adapt".',
    'Broetry: forty single-line sentences with no substance between them.',
    'Invented parables: "A janitor taught me...", "My driver said..." unless the Content DNA records it as true.',
    '"Unpopular opinion:" for an opinion that is not unpopular. "Agree?" or "Thoughts?" as the ending.',
    'Emoji bullet walls, hashtag walls, and "Let that sink in" / "Read that again".',
  ],
  examples: [
    {
      weak: 'In today\'s rapidly evolving financial landscape, it is crucial for professionals to understand how credit card rewards work.',
      strong: 'Your credit card rewards are not free.\n\nSomeone pays for every point you earn. It\'s usually not the bank.',
      why: 'Two lines, a clear tension, and a reason to click "see more". No landscape, no "crucial".',
    },
  ],
  selfEdit: [
    'Do the first two lines alone make you want to click "see more"?',
    'Is there at least one concrete example a reader could picture?',
    'Could a skimmer get the point from the hook, the middle list and the last line?',
    'Remove any sentence that sounds like a corporate memo.',
  ],
};

const BLOG_PLAYBOOK: CraftPlaybook = {
  standard:
    'Write at the level of the best independent writing online: the reader-first essays of Raj Shamani\'s Substack, the practical, specific builds of creator newsletters like Nishant Chahar\'s, the metric-by-metric analysis of App Economy Insights, the plain explanations of numbers in The Economist\'s Off the Charts, the even-handed framing of The Free Press, the clear Indian explainers of Finshots, and the plain-word precision Hacker News readers respect. A reader should finish smarter and want to forward it.',
  voiceModels: [
    'Raj Shamani (Substack essay): the headline names a familiar complaint, then reframes it as a diagnosis ("You don\'t hate X, you hate Y"). It opens on a belief the reader holds and then turns it over. Paragraphs of one to three sentences. Fragments and groups of three build rhythm. Short claim-style section headings separated by dividers. The arc runs claim, counter-evidence, mechanism, reframe, cost. Research comes in with a line that expects doubt ("If that sounds dramatic..."), then names the institution and the finding, then gives one line on what it means for "you". It ends by returning to the opening image with an open question or a closing maxim, not a list of steps.',
    'Creator utility newsletters (Nishant Chahar): the headline pairs a concrete outcome and cost with an honest question. It opens on a striking specific number before explaining anything. Early on, a numbered preview of what the piece covers. Hard concepts are scoped ("three ideas"). Reader objections appear as quoted questions and get answered. Short recap callouts after dense sections. Sections for different readers (students, engineers, founders). The verdict is qualified, not hype.',
    'App Economy Insights (company analysis): each section has the same shape: a one-line summary, the key metrics in bold, each compared with something (vs last year, vs last quarter, vs expectations), then the drivers behind the number, then a "Takeaway" that weighs the strength against the risk and ends on an open question. Figures are stated flatly; interpretation is clearly hedged.',
    'The Economist\'s Off the Charts (explaining numbers): a bold term as each heading, a plain definition, a worked example (often historical or hypothetical), then a practical tip. Each section stands on its own. Dry, understated wit. The data is explained in words, so the reader never needs the chart.',
    'The Free Press (contested topics): shows its even-handedness openly by laying out opposing views next to each other. Attributes every contested claim ("X says", "Y disputes"). Brief paragraphs, and a rhetorical question that names the central tension.',
    'Finshots / Hacker News: Indian everyday analogies for complicated money topics, and plain words with no hype. Precise claims beat adjectives.',
  ],
  formats: [
    'REFRAME ESSAY (behaviour, money psychology, culture): headline reframes a familiar belief; arc is claim, counter-evidence, mechanism, reframe, cost; ends on an open question or a maxim.',
    'EXPLAINER: a scene or striking number, "here\'s how it actually works", the mechanism, a worked example, what it means for you.',
    'COMPANY / MARKET ANALYSIS: one-line summary, bold metrics each with a comparison, the drivers, then a Takeaway that weighs bull against bear and ends on a question.',
    'CONCEPT GLOSSARY (how numbers mislead, mental models): bold term, plain definition, worked example, practical tip, each section standalone.',
    'PRACTICAL BUILD / GUIDE: concrete outcome up front, numbered preview, scoped steps, reader objections answered, role-based takeaways, qualified verdict.',
    'NEWS BRIEF / BOTH SIDES: what happened, the strongest view on each side with attribution, what the data does and does not show, what to watch.',
  ],
  techniques: [
    'Headline: specific and tense, with a promise the article keeps. Strong patterns: a reframe ("You don\'t X, you Y"), a concrete outcome plus a question, or "Why [familiar thing] [surprising behaviour]". Never "Everything you need to know about".',
    'Subtitle (deck): carries the promise forward with one more specific detail or a question about the reader.',
    'Lede: open on a belief the reader holds, a striking specific number, or a scene, then pivot within two or three paragraphs. State the thesis by paragraph three at the latest.',
    'Paragraphs mostly one to three sentences. Mix longer sentences that pile up detail with short fragments that land the point. A one-line paragraph marks a turn.',
    'Headings are short claims or images, not labels: a reader who only skims the H2s should still get the argument.',
    'Bring in evidence like a sceptic expecting doubt: anticipate the objection, name the source and the specific finding, then one line on what it means for the reader.',
    'Every key number gets a comparison (vs last year, vs the average, vs what people assume) and a reason it moved.',
    'Give a reader\'s objection in their own voice ("But isn\'t this just...?") and answer it honestly.',
    'Analogies from Indian everyday life (the kirana store, EMIs, cricket, a wedding budget, the office canteen) when they genuinely clarify, never forced.',
    'Transitions are short and carry logic ("But", "Which leaves", "None of this means", "And yet"). Never reuse the same one.',
    'Steelman before you rebut: state the opposing view so well its holders would agree with it.',
    'Wit comes from dry understatement and precision, at most one light line per section, never at the reader\'s expense.',
    'Ending: return to the opening image or belief and leave the reader with an open question, a maxim, or a balanced takeaway that ends on a question. Not a summary, and not "In conclusion".',
  ],
  antiPatterns: [
    'Unsourced sweeping claims ("history is full of them") standing in for evidence. Big Substack essays sometimes get away with this; Bull or Bear does not.',
    'A listicle pretending to be an essay: every section the same length and shape.',
    'Each section ending with a sentence that just repeats the section.',
    '"In this article, we will", textbook definitions as an opening, or SEO headings ("What is X?", "Benefits of X").',
    'Hedging every sentence until nothing is said, or certainty the evidence does not support.',
    'A paragraph that only tells the reader something they already knew.',
    'Subscribe/share asks scattered through the body. The writing earns the forward on its own.',
  ],
  examples: [
    {
      weak: 'Credit cards are financial instruments that allow consumers to borrow money. In this article, we will explore how credit card rewards work.',
      strong: 'You think the points are free. Every swipe says otherwise.\n\nWhen you pay ₹[amount] for dinner, [the parties from verified claims] quietly split a fee. You are the only one at the table who thinks the reward cost nothing.',
      why: 'Opens on the reader\'s belief, then turns it with a scene. The reader now has a question the article answers.',
    },
    {
      weak: '[Company] reported strong results this quarter with revenue growth and improved margins.',
      strong: 'Revenue: ₹[figure], up [x]% from a year ago and ahead of what analysts expected.\n\nThe driver was not more customers. It was [driver from verified claims].\n\nTakeaway: [strength]. But [risk]. Can [open question]?',
      why: 'Every number gets a comparison and a cause, and the takeaway weighs the strength against the risk, then ends on a real question.',
    },
  ],
  selfEdit: [
    'Does the headline reframe or promise something the article keeps?',
    'Is the thesis clear by paragraph three?',
    'Could a skimmer get the argument from the headings alone?',
    'Does every key number have a comparison and a reason?',
    'Does the ending return to the opening and leave a real question or maxim?',
  ],
};

export const CRAFT_PLAYBOOKS: Record<CraftPlatform, CraftPlaybook> = {
  x: X_PLAYBOOK,
  linkedin: LINKEDIN_PLAYBOOK,
  blog: BLOG_PLAYBOOK,
};

const list = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n');

// The one rendering every writer/editor prompt receives, so drafting and editing are
// held to the same craft bar.
export function renderCraftPlaybook(platform: CraftPlatform): string {
  const p = CRAFT_PLAYBOOKS[platform];
  const examples = p.examples
    .map((e) => `WEAK: ${e.weak}\nSTRONG: ${e.strong}\nWHY: ${e.why}`)
    .join('\n\n');
  return `WRITING CRAFT (how to write, never what is true; the accuracy rules above always win)
The standard: ${p.standard}

Techniques to learn from reference voices (borrow the technique, never their wording, signature
phrases or posts):
${list(p.voiceModels)}

Formats that work (pick the one the story and the facts actually support):
${list(p.formats)}

Line-level craft:
${list(p.techniques)}

Never:
${list(p.antiPatterns)}

Before/after (placeholders in [brackets] are filled only from verified claims; copy the shape,
never the words or facts):
${examples}

Self-edit before you answer:
${list(p.selfEdit)}`;
}
