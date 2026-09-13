-- X/Twitter Head Agent modes (spec section 6.1). single_topic/source_discovery/
-- repurpose/edit are reused as-is; thread and quote are the two genuinely new
-- concepts X's spec introduces.
ALTER TYPE agent_mode ADD VALUE 'thread';
ALTER TYPE agent_mode ADD VALUE 'quote';
